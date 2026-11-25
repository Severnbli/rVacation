import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parseHolidayDates } from '../app/holiday-import.mjs'

test('imports distinct dates from text with comments, blank lines, and Windows line endings', () => {
  const contents = '\uFEFF# Holiday list\r\n2028-02-29 # Leap day\r\n\r\n 2026-01-01 \r\n2028-02-29'
  assert.deepEqual(parseHolidayDates(contents), { dates: ['2026-01-01', '2028-02-29'] })
  assert.deepEqual(parseHolidayDates('  # No dates\n\n'), { dates: [] })
})

test('reports the physical line of an invalid date without importing a partial file', () => {
  const contents = '# Holiday list\n2026-01-01\n\n2026-02-29\n2026-03-08'
  assert.deepEqual(parseHolidayDates(contents), { invalidLine: 4 })
  assert.deepEqual(parseHolidayDates('03.08.2026'), { invalidLine: 1 })
})

test('the Belarus files contain the fixed public holidays and the correct Radunitsa date', async () => {
  const fixed = ['01-01', '01-02', '01-07', '03-08', '05-01', '05-09', '07-03', '11-07', '12-25']
  for (const [year, radunitsa] of [['2026', '04-21'], ['2027', '05-11']]) {
    const file = new URL(`../holidays/belarus-${year}.txt`, import.meta.url)
    const expected = [...fixed, radunitsa].sort().map(day => `${year}-${day}`)
    assert.deepEqual(parseHolidayDates(await readFile(file, 'utf8')), { dates: expected })
  }
})
