import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { initialRecords } from '../app/domain.mjs'
import { openRecords } from '../app/storage.mjs'

const legacyRecords = {
  workers: [{ id: 'worker', name: 'First Worker', groups: ['group'], limit: null }],
  groups: [{ id: 'group', name: 'Office', limit: 2 }],
  periods: [{ id: 'period', name: '26/27', start: '2026-01-01', end: '2027-12-31' }],
  vacations: [{ id: 'vacation', workerId: 'worker', periodId: 'period', start: '2026-01-02', end: '2026-01-04', days: 3 }],
  settings: { counting: 'working', holidays: ['2026-01-02'], deductible: [] },
}

const migratedWorker = { ...legacyRecords.workers[0], legacyPeriods: legacyRecords.periods,
  periodStart: '2028-01-01', periodHistory: [{ type: 'startImported', to: '2026-01-01',
    recurringStart: '2028-01-01', recordedAt: null, changes: [] }] }
const migratedVacation = { ...legacyRecords.vacations[0], kind: 'annual',
  dayRule: { counting: 'working', deductible: [] }, daysBeforeHolidays: 4 }

async function directoryFor(t) {
  const directory = await mkdtemp(join(tmpdir(), 'rvacation-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

function writeLegacy(file, records = legacyRecords) {
  const database = new DatabaseSync(file)
  try {
    database.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE records (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        revision INTEGER NOT NULL,
        contents TEXT NOT NULL
      );
    `)
    database.prepare('INSERT INTO records VALUES (1, 7, ?)').run(JSON.stringify(records))
  } finally {
    database.close()
  }
}

function addWorker(revision, name = 'Local Worker') {
  return { revision, change: { type: 'worker', value: { name, limit: 25, groups: [] } } }
}

test('local changes persist across opens and stale writes cannot overwrite newer changes', async t => {
  const file = join(await directoryFor(t), 'rvacation.sqlite')
  const first = openRecords(file)
  const other = openRecords(file)
  let saved
  try {
    assert.deepEqual(first.read(), { revision: 0, records: initialRecords(), balances: [] })
    saved = first.change(addWorker(0))
    assert.equal(saved.revision, 1)
    assert.throws(() => other.change(addWorker(0, 'Stale Worker')), { message: 'conflict' })
    assert.throws(() => first.change(addWorker(1, '')), { message: 'invalidName' })
  } finally {
    other.close()
    first.close()
  }
  const reopened = openRecords(file)
  try {
    assert.deepEqual(reopened.read(), saved)
  } finally {
    reopened.close()
  }
})

test('the old service database migrates in place with its revision and recorded balances', async t => {
  const file = join(await directoryFor(t), 'rvacation.sqlite')
  writeLegacy(file)
  const records = openRecords(file)
  try {
    const saved = records.read()
    assert.equal(saved.revision, 7)
    assert.deepEqual(saved.records.workers, [migratedWorker])
    assert.deepEqual(saved.records.periodTemplates, [{ id: 'period', name: '26/27', start: '2026-01-01' }])
    assert.deepEqual(saved.records.vacations, [migratedVacation])
    assert.deepEqual(saved.balances[0].rule, { max: 2, personal: false, groupNames: ['Office'] })
    const old = saved.balances[0].periods.find(period => period.id === 'period')
    assert.equal(old.used, 3)
    assert.equal(old.remaining, -1)
  } finally {
    records.close()
  }
  const database = new DatabaseSync(file)
  try {
    assert.equal(database.prepare('PRAGMA user_version').get().user_version, 3)
  } finally {
    database.close()
  }
})

test('firing and recovering a worker preserves vacation history and allowance across opens', async t => {
  const file = join(await directoryFor(t), 'rvacation.sqlite')
  writeLegacy(file)
  const before = openRecords(file)
  let archived
  try {
    archived = before.change({ revision: 7, change: { type: 'fireWorker', id: 'worker', value: {} } })
    assert.equal(archived.records.workers[0].fired, true)
    assert.deepEqual(archived.records.vacations, [migratedVacation])
  } finally {
    before.close()
  }

  const reopened = openRecords(file)
  try {
    assert.deepEqual(reopened.read(), archived)
    assert.throws(() => reopened.change({
      revision: 8, change: { type: 'vacation', value: { workerId: 'worker', periodId: 'period', start: '2026-03-01', end: '2026-03-02' } },
    }), { message: 'recordMissing' })
    const restored = reopened.change({ revision: 8, change: { type: 'recoverWorker', id: 'worker', value: {} } })
    assert.deepEqual(restored.records.workers, [{ ...migratedWorker, fired: false }])
    assert.deepEqual(restored.records.vacations, [migratedVacation])
    assert.deepEqual(restored.balances, archived.balances)
  } finally {
    reopened.close()
  }
})

test('import preserves old records and cannot overwrite local changes', async t => {
  const directory = await directoryFor(t)
  const source = join(directory, 'service.sqlite')
  const invalidSource = join(directory, 'invalid.sqlite')
  writeLegacy(source)
  writeLegacy(invalidSource, { ...legacyRecords, workers: [] })
  const original = await readFile(source)
  const records = openRecords(join(directory, 'rvacation.sqlite'))
  try {
    assert.throws(() => records.importLegacy(invalidSource), { message: 'invalidDatabaseImport' })
    assert.equal(records.read().revision, 0)
    const imported = records.importLegacy(source)
    assert.equal(imported.revision, 1)
    assert.deepEqual(imported.records.workers, [migratedWorker])
    assert.deepEqual(imported.records.vacations, [migratedVacation])
    assert.deepEqual(imported.records.groups, legacyRecords.groups)
    const saved = records.change(addWorker(1))
    assert.throws(() => records.importLegacy(source), { message: 'databaseImportUnavailable' })
    assert.deepEqual(records.read(), saved)
    assert.deepEqual(await readFile(source), original)
  } finally {
    records.close()
  }
})

test('upgrades an existing desktop database from schema version one', async t => {
  const file = join(await directoryFor(t), 'rvacation.sqlite')
  writeLegacy(file)
  const source = new DatabaseSync(file)
  try {
    source.exec('PRAGMA user_version = 1')
  } finally {
    source.close()
  }
  const records = openRecords(file)
  try {
    const saved = records.read()
    assert.equal(saved.revision, 7)
    assert.deepEqual(saved.records.workers, [migratedWorker])
    assert.deepEqual(saved.records.vacations, [migratedVacation])
  } finally {
    records.close()
  }
})

test('migration returns a configured holiday that was charged at the full rate', async t => {
  const file = join(await directoryFor(t), 'rvacation.sqlite')
  writeLegacy(file, { ...legacyRecords, settings: { ...legacyRecords.settings, counting: 'calendar' } })
  const records = openRecords(file)
  try {
    const { vacations } = records.read().records
    assert.equal(vacations[0].days, 2)
    assert.equal(vacations[0].daysBeforeHolidays, 3)
  } finally {
    records.close()
  }
})

test('schema two maternity dates are preserved and the working-year rule correction is recorded', async t => {
  const file = join(await directoryFor(t), 'rvacation.sqlite')
  const maternity = { id: 'maternity', workerId: 'worker', kind: 'maternity', start: '2026-02-01', end: '2026-02-03', days: 3 }
  const oldRecords = { ...initialRecords(), workers: [{ id: 'worker', name: 'Worker', groups: [], limit: null,
    periodStart: '2025-09-01' }], vacations: [maternity] }
  writeLegacy(file, oldRecords)
  const source = new DatabaseSync(file)
  try {
    source.exec('PRAGMA user_version = 2')
  } finally {
    source.close()
  }
  const records = openRecords(file)
  try {
    const saved = records.read()
    assert.deepEqual(saved.records.vacations, [maternity])
    assert.equal(saved.balances[0].periods[0].end, '2026-08-31')
    const event = saved.records.workers[0].periodHistory[0]
    assert.equal(event.type, 'maternityRuleUpdated')
    assert.equal(event.changes[0].before.end, '2026-09-03')
    assert.equal(event.changes[0].after.end, '2026-08-31')
  } finally {
    records.close()
  }
})

test('failed migration and a newer schema leave the existing records intact', async t => {
  const file = join(await directoryFor(t), 'rvacation.sqlite')
  writeLegacy(file, { ...legacyRecords, settings: null })
  assert.throws(() => openRecords(file), { message: 'Invalid vacations or settings' })
  const database = new DatabaseSync(file)
  let contents
  try {
    assert.equal(database.prepare('PRAGMA user_version').get().user_version, 0)
    contents = database.prepare('SELECT contents FROM records').get().contents
    database.exec('PRAGMA user_version = 100')
  } finally {
    database.close()
  }
  assert.throws(() => openRecords(file), { message: 'databaseVersion' })
  const preserved = new DatabaseSync(file)
  try {
    assert.equal(preserved.prepare('PRAGMA user_version').get().user_version, 100)
    assert.equal(preserved.prepare('SELECT contents FROM records').get().contents, contents)
  } finally {
    preserved.close()
  }
})
