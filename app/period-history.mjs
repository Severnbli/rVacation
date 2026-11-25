export function recordPeriodChange(worker, reason, before = [], after = [], datesOnly = false) {
  const previous = new Map(before.map(period => [period.id, period]))
  const changes = []
  for (const period of after) {
    const old = previous.get(period.id)
    if (!old || (old.start === period.start && old.end === period.end)) continue
    changes.push({
      name: period.name, year: period.year,
      before: { start: old.start, end: old.end },
      after: { start: period.start, end: period.end },
    })
  }

  if (changes.length || !datesOnly) {
    const recordedAt = reason.type === 'startImported' ? null : new Date().toISOString()
    worker.periodHistory = [...(worker.periodHistory ?? []), { ...reason, recordedAt, changes }]
  }
}
