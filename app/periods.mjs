const DAY = 86_400_000
const LAST_DATE = Date.UTC(9999, 11, 31)

export function localDate() {
  const date = new Date()
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()].map(value => String(value).padStart(2, '0')).join('-')
}

function iso(time) {
  return new Date(time).toISOString().slice(0, 10)
}

export function nextDay(value) {
  const next = Date.parse(value) + DAY
  return next <= LAST_DATE ? iso(next) : ''
}

export function periodOn(periods, date) {
  return periods.find(period => period.start <= date && date <= period.end)
}

export function isRecordDate(value) {
  return typeof value === 'string' && /^[1-9]\d{3}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && iso(Date.parse(value)) === value
}

function leaveOffset(start, baseEnd, leave, index, threshold, socialTaken) {
  let socialDays = socialTaken
  let end = Math.min(LAST_DATE, baseEnd + Math.max(0, socialTaken - threshold) * DAY)
  for (; index < leave.length; index++) {
    const entry = leave[index]
    if (entry.start > end) break
    const first = Math.max(start, entry.start)
    if (entry.end < first) continue
    const total = (entry.end - first) / DAY + 1
    if (entry.kind === 'maternity') {
      end = Math.min(LAST_DATE, end + total * DAY)
    } else {
      const available = Math.max(0, threshold - socialDays)
      const withinPeriod = (Math.min(end, entry.end) - first) / DAY + 1
      if (withinPeriod > available) {
        // Each excess day extends the end by one day, including the next day of this leave.
        socialDays += total
        end = Math.min(LAST_DATE, end + (total - available) * DAY)
      } else {
        socialDays += withinPeriod
      }
    }
  }
  return { end, socialDays, offset: (end - baseEnd) / DAY }
}

export function periodsFor(worker, entries, threshold, through = localDate(), includeNext = false) {
  const adjustments = worker.periodAdjustments ?? {}
  const history = worker.legacyPeriods ?? []
  const anchor = worker.periodStart ? new Date(worker.periodStart) : null
  const used = new Map()
  const leave = []
  let lastYear = 1
  for (const id of Object.keys(adjustments)) {
    if (id.startsWith('year-')) lastYear = Math.max(lastYear, Number(id.slice(5)))
  }
  for (const entry of entries) {
    if (entry.end > through) through = entry.end
    if (entry.kind === 'annual') {
      used.set(entry.periodId, (used.get(entry.periodId) ?? 0) + entry.days)
      if (entry.periodId.startsWith('year-')) lastYear = Math.max(lastYear, Number(entry.periodId.slice(5)))
    } else {
      leave.push({ kind: entry.kind, start: Date.parse(entry.start), end: Date.parse(entry.end) })
    }
  }
  leave.sort((a, b) => a.start - b.start)

  const periods = []
  let shift = 0
  let leaveIndex = 0
  function addPeriod(id, name, year, baseStart, baseEnd) {
    const start = baseStart + shift * DAY
    if (start > LAST_DATE) return false
    while (leaveIndex < leave.length && leave[leaveIndex].end < start) leaveIndex++
    const adjustment = adjustments[id] ?? {}
    const socialTaken = adjustment.socialTaken ?? 0
    const { end, socialDays, offset } = leaveOffset(
      start, Math.min(LAST_DATE, baseEnd + shift * DAY), leave, leaveIndex, threshold, socialTaken,
    )
    periods.push({ id, name, year, start: iso(start), end: iso(end), offset, socialDays,
      socialTaken, used: used.get(id) ?? 0, vacationCeiling: adjustment.vacationCeiling ?? null })
    shift += offset
    return true
  }

  for (const period of history) {
    addPeriod(period.id, period.name, null, Date.parse(period.start), Date.parse(period.end))
  }
  if (anchor) {
    const anniversary = year => Date.UTC(anchor.getUTCFullYear() + year, anchor.getUTCMonth(), anchor.getUTCDate())
    const throughTime = Date.parse(through)
    for (let year = 1; ; year++) {
      const scheduled = year <= lastYear || anniversary(year - 1) + shift * DAY <= throughTime
      if (!scheduled && !includeNext) break
      const added = addPeriod('year-' + year, year === 1 ? worker.periodName ?? '' : '', year,
        anniversary(year - 1), anniversary(year) - DAY)
      if (!added || !scheduled) break
    }
  }
  return periods
}
