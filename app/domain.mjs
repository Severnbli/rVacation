import { randomUUID } from 'node:crypto'
import { interruptsVacation, leaveKinds, movesWorkingYear } from './leave-types.mjs'
import { recordPeriodChange } from './period-history.mjs'
import { isRecordDate, nextDay, periodOn, periodsFor } from './periods.mjs'

const DAY = 86_400_000
const DEFAULT_SOCIAL_THRESHOLD = 14

export class RecordError extends Error {}

export function initialRecords() {
  return { workers: [], groups: [], periodTemplates: [], vacations: [],
    settings: { counting: 'calendar', holidays: [], deductible: [], socialThreshold: DEFAULT_SOCIAL_THRESHOLD } }
}

function requireThat(condition, code) {
  if (!condition) throw new RecordError(code)
}

function label(value) {
  requireThat(typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 160, 'invalidName')
  return value.trim()
}

function daysValue(value) {
  requireThat(Number.isSafeInteger(value) && value >= 0, 'invalidLimit')
  return value
}

function limit(value) {
  return value === null ? null : daysValue(value)
}

function date(value) {
  requireThat(isRecordDate(value), 'invalidDate')
  return Date.parse(value)
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

function weekday(value) {
  const day = new Date(value).getUTCDay()
  return day !== 0 && day !== 6
}

function chargeBeforeHolidays(start, end, rule) {
  const [first, last] = range(start, end)
  const total = (last - first) / DAY + 1
  if (rule.counting === 'calendar') return total
  let days = Math.floor(total / 7) * 5
  for (let offset = 0; offset < total % 7; offset++) {
    days += Number(weekday(first + offset * DAY))
  }
  for (const day of new Set(rule.deductible)) {
    if (day >= start && day <= end && !weekday(day)) days++
  }
  return days
}

function holidayCredit(start, end, rule, holidays) {
  const marked = new Set(rule.deductible)
  return [...new Set(holidays)].filter(day => day >= start && day <= end &&
    (rule.counting === 'calendar' || weekday(day) || marked.has(day))).length
}

export function countDays(start, end, settings) {
  return chargeBeforeHolidays(start, end, settings) - holidayCredit(start, end, settings, settings.holidays)
}

function vacationRule(settings, start, end) {
  return { counting: settings.counting, deductible: settings.deductible.filter(day => day >= start && day <= end) }
}

export function upgradeRecords(records) {
  if (!records.periods) return records
  const { periods, ...rest } = records
  const ordered = periods.slice().sort((a, b) => a.start.localeCompare(b.start))
  const assignments = new Map()
  for (const vacation of rest.vacations) {
    if (!assignments.has(vacation.workerId)) assignments.set(vacation.workerId, new Set())
    assignments.get(vacation.workerId).add(vacation.periodId)
  }
  const settings = { ...rest.settings, socialThreshold: DEFAULT_SOCIAL_THRESHOLD }
  return {
    ...rest,
    settings,
    periodTemplates: ordered.map(({ id, name, start }) => ({ id, name, start })),
    workers: rest.workers.map(worker => {
      const assigned = assignments.get(worker.id)
      const first = ordered.findIndex(period => assigned?.has(period.id))
      const last = ordered.findLastIndex(period => assigned?.has(period.id))
      const legacyPeriods = first === -1 ? [] : ordered.slice(first, last + 1)
      if (!legacyPeriods.length) return worker
      const periodStart = nextDay(legacyPeriods.at(-1).end)
      const updated = { ...worker, legacyPeriods, periodStart }
      recordPeriodChange(updated, { type: 'startImported', to: legacyPeriods[0].start, recurringStart: periodStart })
      return updated
    }),
    vacations: rest.vacations.map(vacation => {
      const dayRule = vacationRule(settings, vacation.start, vacation.end)
      const credit = holidayCredit(vacation.start, vacation.end, dayRule, settings.holidays)
      const matchesFullCharge = credit > 0 && isRecordDate(vacation.start) && isRecordDate(vacation.end) &&
        vacation.start <= vacation.end && vacation.days === chargeBeforeHolidays(vacation.start, vacation.end, dayRule)
      const days = matchesFullCharge ? vacation.days - credit : vacation.days
      return { ...vacation, kind: 'annual', dayRule, days, daysBeforeHolidays: days + credit }
    }),
  }
}

export function allowance(worker, groups) {
  if (worker.limit !== null) return { max: worker.limit, personal: true, groupNames: [] }
  const applicable = groups.filter(group => worker.groups.includes(group.id) && group.limit !== null)
  if (!applicable.length) return { max: null, personal: false, groupNames: [] }
  const max = Math.min(...applicable.map(group => group.limit))
  return { max, personal: false, groupNames: applicable.filter(group => group.limit === max).map(group => group.name) }
}

function effectiveLimit(max, ceiling) {
  if (max === null) return ceiling
  return ceiling === null ? max : Math.min(max, ceiling)
}

function leaveByWorker(vacations) {
  const result = new Map()
  for (const vacation of vacations) {
    if (!result.has(vacation.workerId)) result.set(vacation.workerId, [])
    result.get(vacation.workerId).push(vacation)
  }
  return result
}

export function upgradePeriodRules(records) {
  if (!records.vacations.some(entry => entry.kind === 'maternity')) return records
  const byWorker = leaveByWorker(records.vacations)
  const threshold = records.settings.socialThreshold
  for (const worker of records.workers) {
    const entries = byWorker.get(worker.id) ?? []
    if (!entries.some(entry => entry.kind === 'maternity')) continue
    const oldEntries = entries.map(entry => entry.kind === 'maternity' ? { ...entry, kind: 'childcare' } : entry)
    const before = periodsFor(worker, oldEntries, threshold, undefined, true)
    const after = periodsFor(worker, entries, threshold, undefined, true)
    recordPeriodChange(worker, { type: 'maternityRuleUpdated' }, before, after, true)
  }
  return records
}

export function summarize(records) {
  const leave = leaveByWorker(records.vacations)
  return records.workers.map(worker => {
    const rule = allowance(worker, records.groups)
    const periods = periodsFor(worker, leave.get(worker.id) ?? [], records.settings.socialThreshold).map(period => {
      const max = effectiveLimit(rule.max, period.vacationCeiling)
      return { ...period, remaining: max === null ? null : max - period.used }
    })
    return { id: worker.id, rule, periods }
  })
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

function optionalName(value) {
  requireThat(value === undefined || typeof value === 'string', 'invalidName')
  return value?.trim() ? label(value) : ''
}

function periodDetails(worker, value) {
  const periodStart = value.periodStart ?? ''
  const periodName = optionalName(value.periodName)
  if (periodStart) {
    date(periodStart)
    const last = worker.legacyPeriods?.at(-1)
    requireThat(!last || periodStart > last.end, 'periodOverlap')
  } else {
    requireThat(!worker.periodStart && !periodName, 'periodStartRequired')
  }
  return { periodStart, periodName }
}

function workerLeave(records, id) {
  return records.vacations.filter(entry => entry.workerId === id)
}

function coversLeave(periods, entry) {
  let next = entry.start
  for (const period of periods) {
    if (period.end < next) continue
    if (period.start > next) return false
    if (period.end >= entry.end) return true
    next = nextDay(period.end)
  }
  return false
}

function checkSchedule(worker, entries, threshold) {
  const periods = periodsFor(worker, entries, threshold, undefined, true)
  const periodIds = new Set(periods.map(period => period.id))
  requireThat(Object.keys(worker.periodAdjustments ?? {}).every(id => periodIds.has(id)), 'periodOutsideCalendar')
  for (const entry of entries) {
    if (entry.kind === 'annual') requireThat(periodIds.has(entry.periodId), 'periodOutsideCalendar')
    else if (movesWorkingYear(entry.kind)) requireThat(coversLeave(periods, entry), 'leaveOutsidePeriod')
  }
  return periods
}

function saveWorker(records, type, id, value) {
  if (type === 'workerPeriod') requireThat(id, 'invalidRequest')
  const worker = id ? activeWorker(records, id) : {}
  const details = type === 'worker' ? workerDetails(records, value) : {}
  const dates = periodDetails(worker, value)
  const updated = { ...worker, ...details, ...dates }
  const changeName = optionalName(value.changeName)
  if (dates.periodStart && dates.periodStart !== worker.periodStart) {
    const entries = workerLeave(records, worker.id)
    const threshold = records.settings.socialThreshold
    const before = periodsFor(worker, entries, threshold, undefined, true)
    const after = checkSchedule(updated, entries, threshold)
    recordPeriodChange(updated, { type: worker.periodStart ? 'startChanged' : 'startSet',
      from: worker.periodStart || '', to: dates.periodStart, name: changeName }, before, after)
  }
  save(records.workers, id, updated)
}

function leaveDates(entry) {
  return { kind: entry.kind, start: entry.start, end: entry.end }
}

function auditLeave(worker, previous, entry, before, after, threshold) {
  const from = movesWorkingYear(previous?.kind) ? leaveDates(previous) : null
  const to = movesWorkingYear(entry?.kind) ? leaveDates(entry) : null
  if (!from && !to) return
  const type = from ? to ? 'leaveEdited' : 'leaveDeleted' : 'leaveAdded'
  recordPeriodChange(worker, { type, from, to }, periodsFor(worker, before, threshold, undefined, true), after, true)
}

function overlapAllowed(firstKind, secondKind) {
  return firstKind === 'annual' && interruptsVacation(secondKind) ||
    secondKind === 'annual' && interruptsVacation(firstKind)
}

function annualCharge(vacation, holidays, interruptions) {
  const { start, end, dayRule } = vacation
  const afterHolidays = Math.max(0, vacation.daysBeforeHolidays - holidayCredit(start, end, dayRule, holidays))
  let credits = 0
  for (const period of interruptions) {
    const overlapStart = period.start > start ? period.start : start
    const overlapEnd = period.end < end ? period.end : end
    if (overlapStart <= overlapEnd) {
      credits += countDays(overlapStart, overlapEnd, { ...dayRule, holidays })
    }
  }
  const interruptedDays = Math.min(afterHolidays, credits)
  return { ...vacation, interruptedDays, days: afterHolidays - interruptedDays }
}

function updateAnnualCharges(entries, holidays) {
  const interruptions = leaveByWorker(entries.filter(entry => interruptsVacation(entry.kind)))
  return entries.map(entry => entry.kind === 'annual'
    ? annualCharge(entry, holidays, interruptions.get(entry.workerId) ?? []) : entry)
}

function saveVacation(records, id, value) {
  const worker = activeWorker(records, value.workerId)
  const previous = id ? existing(records.vacations, id) : null
  const previousWorker = previous && previous.workerId !== worker.id ? activeWorker(records, previous.workerId) : null
  const kind = value.kind
  requireThat(leaveKinds.includes(kind), 'invalidRequest')
  const [start, end] = range(value.start, value.end)
  const entries = workerLeave(records, worker.id)
  const others = entries.filter(entry => entry.id !== id)
  requireThat(!others.some(entry => entry.start <= value.end && entry.end >= value.start &&
    !overlapAllowed(kind, entry.kind)), 'vacationOverlap')
  const { socialThreshold: threshold, holidays } = records.settings
  let details = { workerId: worker.id, kind, start: value.start, end: value.end }

  if (kind === 'annual') {
    const priorInterruption = !previousWorker && interruptsVacation(previous?.kind)
    const availableEntries = priorInterruption ? updateAnnualCharges(others, holidays) :
      movesWorkingYear(previous?.kind) ? others : entries
    const periods = periodsFor(worker, availableEntries, threshold, value.end)
    const period = existing(periods, value.periodId)
    const unchanged = previous?.kind === kind && previous.start === value.start && previous.end === value.end
    const dayRule = unchanged ? previous.dayRule : vacationRule(records.settings, value.start, value.end)
    const daysBeforeHolidays = unchanged ? previous.daysBeforeHolidays : chargeBeforeHolidays(value.start, value.end, dayRule)
    const interruptions = others.filter(entry => interruptsVacation(entry.kind))
    details = annualCharge({ ...details, periodId: period.id, dayRule, daysBeforeHolidays }, holidays, interruptions)
    const max = effectiveLimit(allowance(worker, records.groups).max, period.vacationCeiling)
    const sameBalance = previous?.kind === kind && previous.workerId === worker.id && previous.periodId === period.id
    const used = period.used - (sameBalance ? previous.days : 0)
    requireThat(max === null || used + details.days <= max || sameBalance && details.days <= previous.days, 'allowanceExceeded')
  } else {
    if (movesWorkingYear(kind)) {
      requireThat(periodOn(periodsFor(worker, others, threshold, value.start), value.start), 'leaveOutsidePeriod')
    }
    details.days = (end - start) / DAY + 1
  }

  const after = checkSchedule(worker, [...others, details], threshold)
  if (previousWorker) {
    const previousEntries = workerLeave(records, previousWorker.id)
    const previousAfter = checkSchedule(previousWorker, previousEntries.filter(entry => entry.id !== id), threshold)
    auditLeave(previousWorker, previous, null, previousEntries, previousAfter, threshold)
  }
  auditLeave(worker, previousWorker ? null : previous, details, entries, after, threshold)
  if (previous) records.vacations[records.vacations.indexOf(previous)] = { id, ...details }
  else save(records.vacations, null, details)
  if (interruptsVacation(kind) || interruptsVacation(previous?.kind)) {
    records.vacations = updateAnnualCharges(records.vacations, holidays)
  }
}

export function applyChange(records, change) {
  requireThat(change && typeof change === 'object', 'invalidRequest')
  const { type, id, value } = change
  requireThat(type === 'deleteVacation' || (value && typeof value === 'object'), 'invalidRequest')

  switch (type) {
    case 'worker':
    case 'workerPeriod':
      saveWorker(records, type, id, value)
      break
    case 'fireWorker':
    case 'recoverWorker':
      existing(records.workers, id).fired = type === 'fireWorker'
      break
    case 'import': {
      requireThat(Array.isArray(value.names) && value.names.length > 0 && value.names.length <= 5000, 'invalidImport')
      const dates = periodDetails({}, value)
      const details = value.names.map(name => workerDetails(records, { ...value, name }))
      for (const worker of details) {
        const updated = { ...worker, ...dates }
        if (dates.periodStart) recordPeriodChange(updated, { type: 'startSet', from: '', to: dates.periodStart })
        save(records.workers, null, updated)
      }
      break
    }
    case 'group': {
      const name = label(value.name)
      distinctName(records.groups, name, id)
      save(records.groups, id, { name, limit: limit(value.limit) })
      break
    }
    case 'periodTemplate': {
      const name = label(value.name)
      distinctName(records.periodTemplates, name, id)
      date(value.start)
      save(records.periodTemplates, id, { name, start: value.start })
      break
    }
    case 'periodBalance': {
      const worker = activeWorker(records, id)
      const entries = workerLeave(records, id)
      const threshold = records.settings.socialThreshold
      const before = periodsFor(worker, entries, threshold, undefined, true)
      const period = existing(periodsFor(worker, entries, threshold), value.periodId)
      const socialTaken = daysValue(value.socialTaken)
      let vacationCeiling = period.vacationCeiling
      if (value.remaining !== undefined) {
        vacationCeiling = value.remaining === null ? null : daysValue(daysValue(value.remaining) + period.used)
        const { max } = allowance(worker, records.groups)
        requireThat(vacationCeiling === null || max === null || vacationCeiling <= max, 'balanceExceedsLimit')
      }
      const periodAdjustments = { ...worker.periodAdjustments }
      if (vacationCeiling === null && socialTaken === 0) delete periodAdjustments[period.id]
      else periodAdjustments[period.id] = { vacationCeiling, socialTaken }
      const changeName = optionalName(value.changeName)
      const after = checkSchedule({ ...worker, periodAdjustments }, entries, threshold)
      if (period.socialTaken !== socialTaken) {
        recordPeriodChange(worker, { type: 'socialTakenChanged', name: changeName, periodName: period.name,
          year: period.year, from: period.socialTaken, to: socialTaken }, before, after)
      }
      worker.periodAdjustments = periodAdjustments
      break
    }
    case 'vacation':
      saveVacation(records, id, value)
      break
    case 'deleteVacation': {
      const entry = existing(records.vacations, id)
      const worker = activeWorker(records, entry.workerId)
      const entries = workerLeave(records, worker.id)
      const threshold = records.settings.socialThreshold
      const after = checkSchedule(worker, entries.filter(entry => entry.id !== id), threshold)
      auditLeave(worker, entry, null, entries, after, threshold)
      const remaining = records.vacations.filter(entry => entry.id !== id)
      records.vacations = interruptsVacation(entry.kind) ? updateAnnualCharges(remaining, records.settings.holidays) : remaining
      break
    }
    case 'settings': {
      requireThat(['calendar', 'weekdays', 'working'].includes(value.counting), 'invalidRequest')
      const socialThreshold = daysValue(value.socialThreshold)
      const holidays = dateList(value.holidays)
      const deductible = dateList(value.deductible)
      if (socialThreshold !== records.settings.socialThreshold) {
        const leave = leaveByWorker(records.vacations)
        const previous = records.settings.socialThreshold
        const schedules = records.workers.map(worker => {
          const entries = leave.get(worker.id) ?? []
          return { worker, before: periodsFor(worker, entries, previous, undefined, true), after: checkSchedule(worker, entries, socialThreshold) }
        })
        for (const { worker, before, after } of schedules) {
          recordPeriodChange(worker, { type: 'thresholdChanged', from: previous, to: socialThreshold }, before, after, true)
        }
      }
      records.vacations = updateAnnualCharges(records.vacations, holidays)
      records.settings = { counting: value.counting, holidays, deductible, socialThreshold }
      break
    }
    default:
      throw new RecordError('invalidRequest')
  }
  return records
}
