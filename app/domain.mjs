import { randomUUID } from 'node:crypto'

const DAY = 86_400_000

export class RecordError extends Error {}

export function initialRecords() {
  return { workers: [], groups: [], periods: [], vacations: [],
    settings: { counting: 'calendar', holidays: [], deductible: [] } }
}

function requireThat(condition, code) {
  if (!condition) throw new RecordError(code)
}

function label(value) {
  requireThat(typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 160, 'invalidName')
  return value.trim()
}

function limit(value) {
  requireThat(value === null || (Number.isSafeInteger(value) && value >= 0), 'invalidLimit')
  return value
}

function date(value) {
  requireThat(typeof value === 'string' && /^[1-9]\d{3}-\d{2}-\d{2}$/.test(value), 'invalidDate')
  const parsed = new Date(value)
  requireThat(Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === value, 'invalidDate')
  return +parsed
}

function range(start, end) {
  const bounds = [date(start), date(end)]
  requireThat(bounds[0] <= bounds[1], 'invalidRange')
  return bounds
}

function dateList(values) {
  requireThat(Array.isArray(values), 'invalidDate')
  values.forEach(date)
  return [...new Set(values)].sort()
}

export function countDays(start, end, settings) {
  const [first, last] = range(start, end)
  const total = (last - first) / DAY + 1
  const calendar = settings.counting === 'calendar'
  const weekday = value => {
    const day = new Date(value).getUTCDay()
    return day !== 0 && day !== 6
  }
  const marked = new Set(settings.deductible)
  let days = total
  if (!calendar) {
    days = Math.floor(total / 7) * 5
    for (let offset = 0; offset < total % 7; offset++) {
      days += Number(weekday(first + offset * DAY))
    }
    for (const day of marked) {
      if (day >= start && day <= end && !weekday(day)) days++
    }
  }
  if (settings.counting !== 'weekdays') {
    for (const day of new Set(settings.holidays)) {
      if (day >= start && day <= end && !marked.has(day) && (calendar || weekday(day))) days--
    }
  }
  return days
}

export function allowance(worker, groups) {
  if (worker.limit !== null) return { max: worker.limit, personal: true, groupNames: [] }
  const applicable = groups.filter(group => worker.groups.includes(group.id) && group.limit !== null)
  if (!applicable.length) return { max: null, personal: false, groupNames: [] }
  const max = Math.min(...applicable.map(group => group.limit))
  return { max, personal: false, groupNames: applicable.filter(group => group.limit === max).map(group => group.name) }
}

export function summarize(records) {
  const summaries = new Map()
  for (const vacation of records.vacations) {
    const key = vacation.workerId + ':' + vacation.periodId
    summaries.set(key, (summaries.get(key) ?? 0) + vacation.days)
  }
  return records.workers.map(worker => ({
    id: worker.id,
    rule: allowance(worker, records.groups),
    used: Object.fromEntries(records.periods.map(period => [period.id, summaries.get(worker.id + ':' + period.id) ?? 0]))
  }))
}

function existing(items, id) {
  const item = items.find(item => item.id === id)
  requireThat(item, 'recordMissing')
  return item
}

function activeWorker(records, id) {
  const worker = existing(records.workers, id)
  requireThat(worker.fired !== true, 'recordMissing')
  return worker
}

function save(items, id, details) {
  if (id) Object.assign(existing(items, id), details)
  else items.push({ id: randomUUID(), ...details })
}

function distinctName(items, name, id) {
  requireThat(!items.some(item => item.id !== id && item.name.toLowerCase() === name.toLowerCase()), 'duplicateName')
}

function workerDetails(records, value) {
  requireThat(Array.isArray(value.groups), 'invalidRequest')
  const groups = [...new Set(value.groups)]
  for (const group of groups) existing(records.groups, group)
  return { name: label(value.name), limit: limit(value.limit), groups }
}

export function applyChange(records, change) {
  requireThat(change && typeof change === 'object', 'invalidRequest')
  const { type, id, value } = change
  requireThat(type === 'deleteVacation' || (value && typeof value === 'object'), 'invalidRequest')

  switch (type) {
    case 'worker': {
      const details = workerDetails(records, value)
      if (id) Object.assign(activeWorker(records, id), details)
      else save(records.workers, null, details)
      break
    }
    case 'fireWorker':
    case 'recoverWorker':
      existing(records.workers, id).fired = type === 'fireWorker'
      break
    case 'import': {
      requireThat(Array.isArray(value.names) && value.names.length > 0 && value.names.length <= 5000, 'invalidImport')
      const details = value.names.map(name => workerDetails(records, { ...value, name }))
      for (const worker of details) save(records.workers, null, worker)
      break
    }
    case 'group': {
      const name = label(value.name)
      distinctName(records.groups, name, id)
      save(records.groups, id, { name, limit: limit(value.limit) })
      break
    }
    case 'period': {
      const name = label(value.name)
      distinctName(records.periods, name, id)
      range(value.start, value.end)
      requireThat(!records.periods.some(period => period.id !== id &&
        period.start <= value.end && period.end >= value.start), 'periodOverlap')
      save(records.periods, id, { name, start: value.start, end: value.end })
      break
    }
    case 'vacation': {
      const worker = activeWorker(records, value.workerId)
      existing(records.periods, value.periodId)
      const previous = id ? existing(records.vacations, id) : null
      if (previous && previous.workerId !== worker.id) activeWorker(records, previous.workerId)
      const sameDates = previous?.start === value.start && previous?.end === value.end
      const days = sameDates ? previous.days : countDays(value.start, value.end, records.settings)
      const others = records.vacations.filter(vacation => vacation.workerId === worker.id && vacation.id !== id)
      requireThat(!others.some(vacation => vacation.start <= value.end && vacation.end >= value.start), 'vacationOverlap')
      const used = others.filter(vacation => vacation.periodId === value.periodId)
        .reduce((sum, vacation) => sum + vacation.days, 0)
      const { max } = allowance(worker, records.groups)
      const sameBalance = previous?.workerId === worker.id && previous.periodId === value.periodId
      requireThat(max === null || used + days <= max || sameBalance && days <= previous.days, 'allowanceExceeded')
      save(records.vacations, id, { workerId: worker.id, periodId: value.periodId,
        start: value.start, end: value.end, days })
      break
    }
    case 'deleteVacation':
      activeWorker(records, existing(records.vacations, id).workerId)
      records.vacations = records.vacations.filter(vacation => vacation.id !== id)
      break
    case 'settings':
      requireThat(['calendar', 'weekdays', 'working'].includes(value.counting), 'invalidRequest')
      records.settings = { counting: value.counting, holidays: dateList(value.holidays), deductible: dateList(value.deductible) }
      break
    default:
      throw new RecordError('invalidRequest')
  }
  return records
}
