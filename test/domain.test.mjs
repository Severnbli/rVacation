import assert from 'node:assert/strict'
import test from 'node:test'
import { applyChange, countDays, initialRecords, summarize } from '../app/domain.mjs'
import { periodsFor } from '../app/periods.mjs'

function model() {
  const records = initialRecords()
  const change = (type, value, id) => applyChange(records, { type, value, id })
  const addWorker = (periodStart, limit = null, groups = []) => {
    change('worker', { name: 'Example Worker', periodStart, limit, groups })
    return records.workers.at(-1).id
  }
  const balance = workerId => summarize(records).find(item => item.id === workerId)
  const leave = (workerId, kind, start, end, periodId, id) => {
    change('vacation', { workerId, kind, start, end, periodId }, id)
    return id ?? records.vacations.at(-1).id
  }
  return { records, change, addWorker, balance, leave }
}

test('counts inclusive dates, holiday credits, and extra chargeable dates once', () => {
  const settings = { counting: 'weekdays', holidays: ['2026-05-01', '2026-05-04'],
    deductible: ['2026-05-01', '2026-05-03', '2026-05-18'] }
  assert.equal(countDays('2026-04-30', '2026-05-11', settings), 7)
  assert.equal(countDays('2026-04-30', '2026-05-11', { ...settings, counting: 'calendar' }), 10)
  assert.throws(() => countDays('2026-02-29', '2026-03-01', settings), /invalidDate/)
  assert.throws(() => countDays('2026-03-02', '2026-03-01', settings), /invalidRange/)
})

test('calendar days include ordinary weekends and skip holidays even on weekends', () => {
  const settings = { counting: 'calendar', holidays: ['2026-05-03'], deductible: [] }
  assert.equal(countDays('2026-05-02', '2026-05-03', settings), 1)
  assert.equal(countDays('2026-05-03', '2026-05-03', settings), 0)
  assert.equal(countDays('2026-05-02', '2026-05-03', { ...settings, deductible: ['2026-05-03'] }), 1)
  assert.equal(countDays('2026-05-02', '2026-05-03', { ...settings, counting: 'working' }), 0)
})

test('enforces every group limit until a personal limit is set', () => {
  const { records, change, addWorker, balance, leave } = model()
  change('group', { name: 'Office', limit: 2 })
  change('group', { name: 'Management', limit: 5 })
  const groups = records.groups.map(group => group.id)
  const workerId = addWorker('2024-06-01', null, groups)
  const book = (periodId, id) => leave(workerId, 'annual', '2025-06-06', '2025-06-08', periodId, id)
  assert.throws(() => book('year-1'), /allowanceExceeded/)
  change('worker', { name: 'Example Worker', limit: 3, groups, periodStart: '2024-06-01' }, workerId)
  const id = book('year-1')
  assert.equal(balance(workerId).periods[0].used, 3)
  assert.equal(balance(workerId).periods[1].used, 0)
  assert.throws(() => book('year-2'), /vacationOverlap/)
  change('settings', { ...records.settings, counting: 'weekdays' })
  book('year-2', id)
  assert.equal(records.vacations[0].days, 3)
  change('deleteVacation', undefined, id)
  assert.equal(records.vacations.length, 0)
})

test('builds independent inclusive working years through the requested date', () => {
  const { records, addWorker } = model()
  addWorker('2014-09-01')
  addWorker('2025-10-24')
  addWorker('2024-02-29')
  const periods = index => periodsFor(records.workers[index], [], 14, '2026-08-01')
  assert.equal(periods(0).length, 12)
  assert.deepEqual(periods(0).slice(0, 2).map(({ start, end }) => [start, end]), [
    ['2014-09-01', '2015-08-31'], ['2015-09-01', '2016-08-31'],
  ])
  assert.equal(periods(1).length, 1)
  assert.equal(periods(1)[0].end, '2026-10-23')
  assert.deepEqual(periods(2).slice(0, 2).map(({ start, end }) => [start, end]), [
    ['2024-02-29', '2025-02-28'], ['2025-03-01', '2026-02-28'],
  ])
})

test('social leave adds only excess calendar days and childcare leave moves later working years in full', () => {
  const { records, change, addWorker, balance, leave } = model()
  const workerId = addWorker('2023-09-01', 20)
  change('settings', { ...records.settings, socialThreshold: 2 })
  leave(workerId, 'annual', '2024-08-19', '2024-08-20', 'year-1')
  leave(workerId, 'social', '2024-08-25', '2024-08-26')
  assert.equal(balance(workerId).periods[0].end, '2024-08-31')
  leave(workerId, 'social', '2024-08-31', '2024-09-02')
  const childcare = leave(workerId, 'childcare', '2024-09-03', '2024-09-05')
  const [first, next] = balance(workerId).periods
  assert.equal(first.end, '2024-09-06')
  assert.equal(first.offset, 6)
  assert.equal(first.socialDays, 5)
  assert.equal(first.used, 2)
  assert.equal(first.remaining, 18)
  assert.equal(next.start, '2024-09-07')
  assert.equal(next.end, '2025-09-06')
  assert.throws(() => leave(workerId, 'annual', '2024-09-04', '2024-09-08', 'year-2'), /vacationOverlap/)
  assert.throws(() => leave(workerId, 'social', '2024-09-02', '2024-09-04'), /vacationOverlap/)
  change('deleteVacation', undefined, childcare)
  assert.equal(balance(workerId).periods[1].start, '2024-09-04')
})

test('social leave crossing the original end splits when a period has no excess', () => {
  const { records, change, addWorker, balance, leave } = model()
  const workerId = addWorker('2023-09-01')
  change('settings', { ...records.settings, socialThreshold: 2 })
  leave(workerId, 'social', '2024-08-30', '2024-09-04')
  const [first, next] = balance(workerId).periods
  assert.equal(first.end, '2024-08-31')
  assert.equal(first.socialDays, 2)
  assert.equal(next.start, '2024-09-01')
  assert.equal(next.socialDays, 4)
  assert.equal(next.end, '2025-09-02')
})

test('setting remaining vacation and prior social leave updates balances without creating leave records', () => {
  const { records, change, addWorker, balance, leave } = model()
  const workerId = addWorker('2024-09-01', 12)
  leave(workerId, 'annual', '2024-11-15', '2024-11-16', 'year-1')
  change('periodBalance', { periodId: 'year-1', remaining: 3, socialTaken: 16, changeName: 'Paper register' }, workerId)
  assert.equal(records.vacations.length, 1)
  assert.equal(balance(workerId).periods[0].remaining, 3)
  assert.equal(balance(workerId).periods[0].end, '2025-09-02')
  assert.equal(records.workers[0].periodHistory.at(-1).name, 'Paper register')
  assert.throws(() => leave(workerId, 'annual', '2025-03-01', '2025-03-04', 'year-1'), /allowanceExceeded/)
  leave(workerId, 'annual', '2025-03-01', '2025-03-03', 'year-1')
  assert.equal(balance(workerId).periods[0].remaining, 0)
  assert.throws(() => change('periodBalance', { periodId: 'year-1', remaining: 8, socialTaken: 16 }, workerId), /balanceExceedsLimit/)
  change('periodBalance', { periodId: 'year-1', remaining: null, socialTaken: 16 }, workerId)
  assert.equal(balance(workerId).periods[0].remaining, 7)
})

test('holiday changes credit recorded annual vacation while leaving recorded counting rules and special leave intact', () => {
  const { records, change, addWorker, balance, leave } = model()
  const workerId = addWorker('2024-09-01', 15)
  leave(workerId, 'annual', '2025-05-01', '2025-05-04', 'year-1')
  leave(workerId, 'childcare', '2025-05-08', '2025-05-09')
  assert.equal(balance(workerId).periods[0].remaining, 11)
  change('settings', { ...records.settings, counting: 'weekdays', holidays: ['2025-05-01', '2025-05-09'] })
  assert.equal(balance(workerId).periods[0].remaining, 12)
  assert.equal(records.vacations[0].days, 3)
  assert.equal(records.vacations[1].days, 2)
  change('settings', { ...records.settings, holidays: [] })
  assert.equal(balance(workerId).periods[0].remaining, 11)
})

test('sick leave returns chargeable vacation days once and preserves the working-year dates', () => {
  const { records, change, addWorker, balance, leave } = model()
  const workerId = addWorker('2025-09-01', 10)
  const colleague = addWorker('2025-09-01', 10)
  change('settings', { ...records.settings, counting: 'weekdays', holidays: ['2026-05-01'] })
  const annual = leave(workerId, 'annual', '2026-04-29', '2026-05-07', 'year-1')
  leave(colleague, 'annual', '2026-04-29', '2026-05-07', 'year-1')
  const sick = leave(workerId, 'sick', '2026-04-30', '2026-05-04')
  const booking = () => records.vacations.find(entry => entry.id === annual)
  assert.equal(booking().interruptedDays, 2)
  assert.equal(booking().days, 4)
  assert.equal(booking().end, '2026-05-07')
  assert.equal(balance(workerId).periods[0].remaining, 6)
  assert.equal(balance(workerId).periods[0].end, '2026-08-31')
  assert.equal(balance(colleague).periods[0].used, 6)
  assert.throws(() => leave(workerId, 'sick', '2026-05-04', '2026-05-06'), /vacationOverlap/)
  assert.throws(() => leave(workerId, 'social', '2026-04-30', '2026-05-04'), /vacationOverlap/)
  leave(workerId, 'sick', '2026-04-30', '2026-05-03', undefined, sick)
  assert.equal(booking().days, 5)
  change('deleteVacation', undefined, sick)
  assert.equal(booking().days, 6)
})

test('an annual vacation recorded after a sick leave uses the credited day count for its limit', () => {
  const { change, addWorker, balance, leave } = model()
  const workerId = addWorker('2025-09-01', 2)
  const sick = leave(workerId, 'sick', '2025-12-30', '2026-01-01')
  leave(workerId, 'annual', '2026-01-01', '2026-01-03', 'year-1')
  assert.equal(balance(workerId).periods[0].remaining, 0)
  change('deleteVacation', undefined, sick)
  assert.equal(balance(workerId).periods[0].remaining, -1)
})

test('pregnancy and childbirth leave interrupts annual vacation while childcare leave shifts the working year', () => {
  const { addWorker, balance, leave } = model()
  const workerId = addWorker('2025-09-01', 24)
  leave(workerId, 'annual', '2026-07-01', '2026-07-05', 'year-1')
  leave(workerId, 'maternity', '2026-07-03', '2026-07-07')
  assert.equal(balance(workerId).periods[0].used, 2)
  assert.equal(balance(workerId).periods[0].offset, 0)
  assert.throws(() => leave(workerId, 'sick', '2026-07-07', '2026-07-08'), /vacationOverlap/)
  assert.throws(() => leave(workerId, 'childcare', '2026-07-07', '2026-07-08'), /vacationOverlap/)
  leave(workerId, 'childcare', '2026-07-08', '2026-07-12')
  assert.equal(balance(workerId).periods[0].end, '2026-09-05')
})

test('period history preserves the original start, named corrections, and causes of shifts', () => {
  const { records, change, addWorker, balance, leave } = model()
  const workerId = addWorker('2024-09-01')
  change('workerPeriod', { periodStart: '2024-09-02', changeName: 'Hiring date correction' }, workerId)
  const childcare = leave(workerId, 'childcare', '2024-10-01', '2024-10-05')
  const social = leave(workerId, 'social', '2024-11-01', '2024-11-05')
  change('settings', { ...records.settings, socialThreshold: 3 })
  leave(workerId, 'social', '2024-11-01', '2024-11-04', undefined, social)
  change('deleteVacation', undefined, childcare)
  assert.throws(() => change('workerPeriod', { periodStart: '2024-11-02' }, workerId), /leaveOutsidePeriod/)
  const history = records.workers[0].periodHistory
  assert.deepEqual(history.map(event => event.type), ['startSet', 'startChanged', 'leaveAdded', 'thresholdChanged', 'leaveEdited', 'leaveDeleted'])
  assert.equal(history[0].to, '2024-09-01')
  assert.equal(history[1].name, 'Hiring date correction')
  assert.deepEqual(history[2].to, { kind: 'childcare', start: '2024-10-01', end: '2024-10-05' })
  assert.equal(history[2].changes[1].before.start, '2025-09-02')
  assert.equal(history[2].changes[1].after.start, '2025-09-07')
  assert.equal(history[5].from.kind, 'childcare')
  assert.equal(balance(workerId).periods[0].end, '2025-09-02')
})

test('rejects a bulk change completely when any name fails validation', () => {
  const records = initialRecords()
  assert.throws(() => applyChange(records, {
    type: 'import', value: { names: ['Example Worker', '  '], limit: null, groups: [] },
  }), /invalidName/)
  assert.equal(records.workers.length, 0)
})
