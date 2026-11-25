import { DatabaseSync } from 'node:sqlite'
import { applyChange, initialRecords, RecordError, summarize, upgradeRecords } from './domain.mjs'

function snapshot(row) {
  const records = JSON.parse(row.contents)
  return { revision: row.revision, records, balances: summarize(records) }
}

function readLegacy(database) {
  const row = database.prepare('SELECT revision, contents FROM records WHERE id = 1').get()
  if (!Number.isSafeInteger(row?.revision) || row.revision < 0) throw new Error('Invalid records revision')

  const records = JSON.parse(row.contents)
  const { workers, groups, periods, vacations, settings } = records
  const name = item => typeof item.name === 'string'
  const limit = item => item.limit === null || (Number.isSafeInteger(item.limit) && item.limit >= 0)
  const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value))
  const dates = item => date(item.start) && date(item.end)
  const ids = items => new Set(items.map(item => item.id))
  const valid = (items, fields) => Array.isArray(items) && items.every(item =>
    item && typeof item.id === 'string' && fields(item)) && ids(items).size === items.length
  const dateList = values => Array.isArray(values) && values.every(date)

  if (!valid(groups, item => name(item) && limit(item)) || !valid(periods, item => name(item) && dates(item))) {
    throw new Error('Invalid groups or periods')
  }
  const groupIds = ids(groups)
  if (!valid(workers, item => name(item) && limit(item) &&
      Array.isArray(item.groups) && item.groups.every(id => groupIds.has(id)))) {
    throw new Error('Invalid workers')
  }
  const workerIds = ids(workers)
  const periodIds = ids(periods)
  if (!valid(vacations, item => dates(item) && workerIds.has(item.workerId) && periodIds.has(item.periodId) &&
      Number.isSafeInteger(item.days) && item.days >= 0) ||
      !['calendar', 'weekdays', 'working'].includes(settings?.counting) ||
      !dateList(settings.holidays) || !dateList(settings.deductible)) {
    throw new Error('Invalid vacations or settings')
  }
  return row
}

function version(database) {
  return database.prepare('PRAGMA user_version').get().user_version
}

const migrations = [
  database => {
    const tables = database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT GLOB 'sqlite_*'").all()
    let row = { revision: 0, contents: JSON.stringify(initialRecords()) }
    if (tables.length) {
      if (tables.length !== 1 || tables[0].name !== 'records') throw new Error('Unknown database schema')
      row = readLegacy(database)
      database.exec('DROP TABLE records')
    }
    database.exec(`
      CREATE TABLE records (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        revision INTEGER NOT NULL CHECK (revision >= 0),
        contents TEXT NOT NULL CHECK (json_valid(contents))
      ) STRICT;
    `)
    database.prepare('INSERT INTO records VALUES (1, ?, ?)').run(row.revision, row.contents)
  },
  database => {
    const row = database.prepare('SELECT contents FROM records WHERE id = 1').get()
    const records = upgradeRecords(JSON.parse(row.contents))
    database.prepare('UPDATE records SET contents = ? WHERE id = 1').run(JSON.stringify(records))
  },
]

function migrate(database) {
  database.exec('BEGIN IMMEDIATE')
  try {
    const current = version(database)
    if (current < 0 || current > migrations.length) throw new RecordError('databaseVersion')
    for (let index = current; index < migrations.length; index++) {
      migrations[index](database)
      database.exec(`PRAGMA user_version = ${index + 1}`)
    }
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

function legacyContents(file) {
  try {
    const source = new DatabaseSync(file, { readOnly: true })
    try {
      if (version(source) !== 0) throw new Error('Unknown legacy database version')
      return JSON.stringify(upgradeRecords(JSON.parse(readLegacy(source).contents)))
    } finally {
      source.close()
    }
  } catch {
    throw new RecordError('invalidDatabaseImport')
  }
}

export function openRecords(file) {
  const database = new DatabaseSync(file)
  try {
    database.exec('PRAGMA busy_timeout = 5000')
    if (version(database) !== migrations.length) migrate(database)
    const read = database.prepare('SELECT revision, contents FROM records WHERE id = 1')
    const store = database.prepare('UPDATE records SET revision = revision + 1, contents = ? WHERE id = 1 AND revision = ?')

    function save(contents, revision, next) {
      if (!store.run(contents, revision).changes) throw new RecordError('conflict')
      return next
    }

    return {
      read: () => snapshot(read.get()),
      change(command) {
        if (!Number.isSafeInteger(command?.revision)) throw new RecordError('invalidRequest')
        const row = read.get()
        if (command.revision !== row.revision) throw new RecordError('conflict')
        const records = applyChange(JSON.parse(row.contents), command.change)
        const balances = summarize(records)
        return save(JSON.stringify(records), row.revision, { revision: row.revision + 1, records, balances })
      },
      importLegacy(file) {
        if (read.get().revision !== 0) throw new RecordError('databaseImportUnavailable')
        const contents = legacyContents(file)
        return save(contents, 0, snapshot({ revision: 1, contents }))
      },
      close: () => database.close(),
    }
  } catch (error) {
    database.close()
    throw error
  }
}
