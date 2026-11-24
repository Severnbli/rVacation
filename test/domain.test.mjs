import assert from 'node:assert/strict'
import test from 'node:test'
import { applyChange, countDays, initialRecords, summarize } from '../app/domain.mjs'

test('counts inclusive dates, holidays, and shared deductible dates once within a vacation', () => {
  const settings = { counting: 'working', holidays: ['2026-05-01', '2026-05-04'],
    deductible: ['2026-05-01', '2026-05-03', '2026-05-18'] }
  assert.equal(countDays('2026-04-30', '2026-05-11', settings), 8)
  assert.equal(countDays('2026-04-30', '2026-05-11', { ...settings, counting: 'weekdays' }), 9)
  assert.equal(countDays('2026-04-30', '2026-05-11', { ...settings, counting: 'calendar' }), 12)
  assert.throws(() => countDays('2026-02-29', '2026-03-01', settings), /invalidDate/)
})

test('enforces every group limit until a personal limit is set', () => {
  const records = initialRecords()
  const change = (type, value, id) => applyChange(records, { type, value, id })
  change('group', { name: 'Office', limit: 2 })
  change('group', { name: 'Management', limit: 5 })
  const groups = records.groups.map(group => group.id)
  change('worker', { name: 'Example Worker', limit: null, groups })
  change('period', { name: '25/26', start: '2025-06-01', end: '2026-05-31' })
  change('period', { name: '26/27', start: '2026-06-01', end: '2027-05-31' })
  const [{ id: workerId }] = records.workers
  const [{ id: periodId }, { id: secondPeriod }] = records.periods
  const booking = { workerId, periodId, start: '2026-06-01', end: '2026-06-03' }
  assert.throws(() => change('vacation', booking), /allowanceExceeded/)
  change('worker', { name: 'Example Worker', limit: 3, groups }, workerId)
  change('vacation', booking)
  assert.equal(summarize(records)[0].used[periodId], 3)
  assert.equal(summarize(records)[0].used[secondPeriod], 0)
  assert.throws(() => change('vacation', { ...booking, periodId: secondPeriod }), /vacationOverlap/)
  const [{ id }] = records.vacations
  change('settings', { counting: 'weekdays', holidays: [], deductible: [] })
  change('vacation', { ...booking, periodId: secondPeriod }, id)
  assert.equal(records.vacations[0].days, 3)
  change('deleteVacation', undefined, id)
  assert.equal(records.vacations.length, 0)
})

test('rejects a bulk change completely when any name fails validation', () => {
  const records = initialRecords()
  assert.throws(() => applyChange(records, {
    type: 'import', value: { names: ['Example Worker', '  '], limit: null, groups: [] },
  }), /invalidName/)
  assert.equal(records.workers.length, 0)
})
