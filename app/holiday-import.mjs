import { isRecordDate } from './periods.mjs'

export function parseHolidayDates(text) {
  const dates = new Set()
  for (const [index, line] of text.split(/\r\n?|\n/).entries()) {
    const date = line.split('#', 1)[0].trim()
    if (!date) continue
    if (!isRecordDate(date)) return { invalidLine: index + 1 }
    dates.add(date)
  }
  return { dates: [...dates].sort() }
}
