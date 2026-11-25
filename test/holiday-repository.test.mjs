import assert from 'node:assert/strict'
import test from 'node:test'
import { listHolidayFiles, readHolidayFile } from '../app/holiday-repository.mjs'

const directory = 'https://api.github.com/repos/Severnbli/rVacation/contents/holidays'

test('discovers text calendars in the repository directory without downloading their dates', async () => {
  const result = await listHolidayFiles(async (url, options) => {
    assert.equal(url, `${directory}?ref=main`)
    assert.equal(options.headers.accept, 'application/vnd.github+json')
    return Response.json([
      { type: 'file', name: 'belarus-2027.txt' },
      { type: 'dir', name: 'archive.txt' },
      { type: 'file', name: 'README.md' },
      { type: 'file', name: 'belarus-2026.txt' },
      { type: 'file', name: 'new calendar.TXT' },
    ])
  })
  assert.deepEqual(result.files, ['belarus-2026.txt', 'belarus-2027.txt', 'new calendar.TXT'])
})

test('distinguishes an empty catalog from a GitHub error', async () => {
  assert.deepEqual(await listHolidayFiles(async () => new Response(null, { status: 404 })), { files: [] })
  await assert.rejects(listHolidayFiles(async () => new Response(null, { status: 403 })), /HTTP 403/)
})

test('reads only the named text file and safely encodes the file name', async () => {
  const text = '# Public holidays\n2027-01-01\n'
  assert.deepEqual(await readHolidayFile('2027 # Holidays.txt', async (url, options) => {
    assert.equal(url, `${directory}/2027%20%23%20Holidays.txt?ref=main`)
    assert.equal(options.headers.accept, 'application/vnd.github.raw+json')
    return new Response(text)
  }), { text })
  for (const name of ['../calendar.txt', 'other\\calendar.txt', 'README.md', undefined]) {
    assert.deepEqual(await readHolidayFile(name, () => assert.fail('Unexpected request')), { error: 'invalidRequest' })
  }
  await assert.rejects(readHolidayFile('missing.txt', async () => new Response(null, { status: 404 })), /HTTP 404/)
})
