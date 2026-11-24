import { createHash, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'
import { applyChange, initialRecords, RecordError, summarize } from './domain.mjs'

function hash(text) {
  return createHash('sha256').update(text).digest()
}

async function readChange(request) {
  let size = 0
  const chunks = []
  for await (const chunk of request) {
    size += chunk.length
    if (size > 4 * 1024 * 1024) throw new RecordError('invalidRequest')
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new RecordError('invalidRequest')
  }
}

export function recordsService({ file, key }) {
  if (!key || key.length < 24) throw new Error('RVACATION_KEY must have at least 24 characters.')
  const credential = hash('Bearer ' + key)
  const database = new DatabaseSync(file)
  database.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS records (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      revision INTEGER NOT NULL,
      contents TEXT NOT NULL
    );
  `)
  database.prepare('INSERT OR IGNORE INTO records VALUES (1, 0, ?)').run(JSON.stringify(initialRecords()))
  const read = database.prepare('SELECT revision, contents FROM records WHERE id = 1')
  const store = database.prepare('UPDATE records SET revision = revision + 1, contents = ? WHERE id = 1 AND revision = ?')

  function snapshot(row) {
    const records = JSON.parse(row.contents)
    return { revision: row.revision, records, balances: summarize(records) }
  }

  const server = createServer(async (request, response) => {
    function json(status, body) {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      response.end(JSON.stringify(body))
    }

    if (request.url !== '/v1/records') return json(404, { error: 'notFound' })
    if (!timingSafeEqual(hash(request.headers.authorization ?? ''), credential)) {
      return json(401, { error: 'unauthorized' })
    }

    try {
      if (request.method === 'GET') return json(200, snapshot(read.get()))
      if (request.method !== 'POST') return json(405, { error: 'invalidRequest' })
      const body = await readChange(request)
      if (!body || !Number.isSafeInteger(body.revision)) throw new RecordError('invalidRequest')
      const row = read.get()
      if (body.revision !== row.revision) return json(409, { error: 'conflict' })
      const records = applyChange(JSON.parse(row.contents), body.change)
      if (!store.run(JSON.stringify(records), row.revision).changes) return json(409, { error: 'conflict' })
      return json(200, snapshot(read.get()))
    } catch (error) {
      if (error instanceof RecordError) return json(400, { error: error.message })
      console.error(error)
      return json(500, { error: 'serverError' })
    }
  })
  server.on('close', () => database.close())
  return server
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.RVACATION_PORT ?? 8787)
  const host = process.env.RVACATION_HOST ?? '127.0.0.1'
  const key = process.env.RVACATION_KEY
  const file = process.env.RVACATION_DB ?? 'rvacation.sqlite'
  recordsService({ file, key }).listen(port, host, () => {
    console.log(`rVacation records service listening on ${host}:${port}`)
  })
}
