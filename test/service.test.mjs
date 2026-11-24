import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { recordsService } from '../server/index.mjs'

test('shared service authenticates, persists records, and rejects stale writes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rvacation-test-'))
  const file = join(directory, 'records.sqlite')
  const key = 'reference-key-for-this-test-only'
  let service
  async function open() {
    service = recordsService({ file, key }).listen(0, '127.0.0.1')
    await once(service, 'listening')
    return `http://127.0.0.1:${service.address().port}/v1/records`
  }
  async function close() {
    if (service?.listening) {
      const closed = once(service, 'close')
      service.close()
      await closed
    }
  }
  try {
    let url = await open()
    assert.equal((await fetch(url)).status, 401)
    const headers = { Authorization: 'Bearer ' + key }
    const initial = await (await fetch(url, { headers })).json()
    assert.equal(initial.revision, 0)
    const body = {
      revision: initial.revision, change: { type: 'worker', value: { name: 'First Worker', limit: 25, groups: [] } },
    }
    const write = () => fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
    const results = await Promise.all([write(), write()])
    assert.deepEqual(results.map(response => response.status).sort(), [200, 409])
    await close()
    url = await open()
    const latest = await (await fetch(url, { headers })).json()
    assert.equal(latest.revision, 1)
    assert.equal(latest.records.workers.length, 1)
    assert.equal(latest.balances[0].rule.max, 25)
  } finally {
    await close()
    await rm(directory, { recursive: true, force: true })
  }
})
