import { annualVacationCharge, annualVacationPeriods } from './domain.mjs'
import { parseHolidayDates } from './holiday-import.mjs'
import { interruptsVacation, leaveKinds, movesWorkingYear } from './leave-types.mjs'
import { isRecordDate, localDate as today, periodOn, periodsFor } from './periods.mjs'

const main = document.querySelector('#main')
const dialog = document.querySelector('#editor')
const updatePrompt = document.querySelector('#update-prompt')
const nav = document.querySelector('#nav')
const footer = document.querySelector('#footer')
const notice = document.querySelector('#notice')
const pages = ['overview', 'workers', 'groups', 'periods', 'vacations', 'settings']
const localeNames = { en: 'English', be: 'Беларуская', ru: 'Русский' }
let language = localStorage.getItem('language') || navigator.language.split('-')[0]
if (!localeNames[language]) language = 'en'

let snapshot
let recordsError
let importingDatabase = false
let page = 'overview'
let balanceDate = ''
let periodWorkerId = ''
let groupId = ''
let sortBy = 'name'
let search = ''
let version = ''
let updateState = 'idle'
let updatePromptShown = false
let noticeTimer

const t = key => messages[key]?.[Object.keys(localeNames).indexOf(language)] ?? messages[key]?.[0] ?? key
const number = value => new Intl.NumberFormat(language).format(value)
const displayDate = value => dateFormatter(language, 'medium')(new Date(value))
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character])
const totalDays = value => value === null ? t('unlimited') : number(value)
const periodName = period => period.name || t('workingYear').replace('{number}', number(period.year))

function findBalance(workerId) {
  return snapshot.balances.find(balance => balance.id === workerId)
}

function periodDates(period) {
  return `${displayDate(period.start)} – ${displayDate(period.end)}`
}

function toast(key) {
  notice.textContent = t(key)
  clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => { notice.textContent = '' }, 5200)
}

function button(action, key, id = '', style = '') {
  return `<button type="button" class="${style}" data-action="${action}" data-id="${escape(id)}">${escape(t(key))}</button>`
}

function heading(key, actions = '') {
  return `<header class="page"><div><h1 tabindex="-1">${t(key)}</h1><p>${t(key + 'Intro')}</p></div><div class="actions">${actions}</div></header>`
}

function options(items, selected, placeholder) {
  return (placeholder ? `<option value="">${t(placeholder)}</option>` : '') +
    items.map(item => `<option value="${escape(item.id)}" ${item.id === selected ? 'selected' : ''}>${escape(item.name)}</option>`).join('')
}

function field(name, key, value = '', type = 'text', attributes = '') {
  return `<label>${t(key)}<input name="${name}" type="${type}" value="${escape(value)}" ${attributes}></label>`
}

function textarea(name, key, value, hint) {
  return `<label>${t(key)}<textarea name="${name}">${escape(value)}</textarea><small>${t(hint)}</small></label>`
}

function table(columns, rows, empty) {
  if (!rows.length) return `<p class="empty">${t(empty)}</p>`
  return `<div class="table-wrap"><table><thead><tr>${columns.map(key => `<th scope="col">${t(key)}</th>`).join('')}</tr></thead>
    <tbody>${rows.join('')}</tbody></table></div>`
}

function groupBadges(worker, groups) {
  const names = groupNames(worker, groups)
  return names.length ? `<div class="badges">${names.map(name => `<span class="badge">${escape(name)}</span>`).join('')}</div>` : t('none')
}

function groupNames(worker, groups) {
  return groups.filter(group => worker.groups.includes(group.id)).map(group => group.name)
    .sort((left, right) => left.localeCompare(right, language))
}

function sortWorkers(records) {
  return records.workers.filter(worker => (!groupId || worker.groups.includes(groupId)) &&
    worker.name.toLocaleLowerCase(language).includes(search.toLocaleLowerCase(language))).sort((left, right) => {
    const groupOrder = sortBy === 'group'
      ? groupNames(left, records.groups).join(', ').localeCompare(groupNames(right, records.groups).join(', '), language)
      : 0
    return groupOrder || left.name.localeCompare(right.name, language)
  })
}

function filters(records, showDate) {
  return `<div class="filters">
    ${showDate ? `<label>${t('balanceDate')}<input type="date" data-filter="date" min="1000-01-01" max="${today()}" value="${balanceDate || today()}"></label>` : ''}
    <label>${t('group')}<select data-filter="group">${options(records.groups, groupId, 'allGroups')}</select></label>
    <label>${t('sort')}<select data-filter="sort">${options([{ id: 'name', name: t('name') }, { id: 'group', name: t('group') }], sortBy)}</select></label>
    <label>${t('search')}<input type="search" data-filter="search" value="${escape(search)}"></label>
    </div>`
}

function workerRows(records, overview) {
  const balances = new Map(snapshot.balances.map(balance => [balance.id, balance]))
  return sortWorkers(records).map(worker => {
    const balance = balances.get(worker.id)
    const { max, personal, groupNames: limitingGroups } = balance.rule
    const period = periodOn(balance.periods, balanceDate || today())
    const rule = personal ? t('personal') : limitingGroups.join(', ')
    const periodCell = period ? `${escape(periodName(period))}<br><small>${periodDates(period)}</small>` :
      t(balance.periods.length ? 'none' : 'noWorkerPeriod')
    return `<tr><td><strong>${escape(worker.name)}</strong></td><td>${groupBadges(worker, records.groups)}</td>
      ${overview ? `<td>${periodCell}</td><td class="number">${period ? number(period.used) : t('none')}</td>` : ''}
      <td class="number">${totalDays(max)}${rule ? `<br><small>${escape(rule)}</small>` : ''}</td>
      ${overview ? `<td class="number ${period?.remaining < 0 ? 'over' : ''}">${period ? totalDays(period.remaining) : t('none')}</td>` : ''}
      <td><div class="actions">${overview ? button('vacation-for', 'recordShort', worker.id, 'small') +
        button('worker-periods', 'periods', worker.id, 'small') : button('edit-worker', 'edit', worker.id, 'small') +
        button('worker-periods', 'periods', worker.id, 'small') + button('fire-worker', 'markFired', worker.id, 'small danger')}</div></td></tr>`
  })
}

function overview(records) {
  const metrics = [
    ['workers', records.workers.length],
    ['groups', records.groups.length],
    ['vacations', records.vacations.length],
  ]
  return heading('overview', button('new-vacation', 'recordVacation', '', 'primary')) +
    (snapshot.showLegacyImport ? `<section class="panel setup"><div class="panel-body"><h2>${t('legacyRecords')}</h2>
    <p>${t('legacyRecordsHelp')}</p><div class="actions">${button('page', 'settings', 'settings')}</div></div></section>` : '') +
    (!records.workers.length ? `<section class="panel setup"><div class="panel-body"><h2>${t('getStarted')}</h2>
    <p>${t('vacationNeedsRecords')}</p><div class="actions">${button('new-worker', 'addWorker')}</div></div></section>` : '') +
    `<div class="cards">${metrics.map(([key, value]) => `<div class="card"><strong>${number(value)}</strong><span>${t(key)}</span></div>`).join('')}</div>
    <section class="panel"><div class="panel-top"><h2>${t('balances')}</h2>${filters(records, true)}</div>
    <div id="worker-results">${workerResults(records, true)}</div></section>`
}

function workerResults(records, overviewMode) {
  return table(overviewMode ? ['worker', 'groups', 'period', 'used', 'limit', 'remaining', 'actions'] : ['worker', 'groups', 'limit', 'actions'],
    workerRows(records, overviewMode), records.workers.length ? 'noMatches' : 'noWorkers')
}

function workers(records) {
  const recover = snapshot.firedWorkers.length ? button('recover-workers', 'recoverWorkers') : ''
  return heading('workers', recover + button('import', 'bulkAdd') + button('new-worker', 'addWorker', '', 'primary')) +
    `<section class="panel"><div class="panel-top">${filters(records, false)}</div>
      <div id="worker-results">${workerResults(records, false)}</div></section>`
}

function renderGroups(records) {
  const rows = records.groups.slice().sort((a, b) => a.name.localeCompare(b.name, language)).map(item =>
    `<tr><td><strong>${escape(item.name)}</strong></td><td>${number(records.workers.filter(worker => worker.groups.includes(item.id)).length)}</td>
    <td>${item.limit === null ? t('unlimited') : number(item.limit)}</td><td>${button('edit-group', 'edit', item.id, 'small')}</td></tr>`)
  return heading('groups', button('new-group', 'addGroup', '', 'primary')) +
    `<section class="panel">${table(['name', 'workers', 'limit', 'actions'], rows, 'noGroups')}</section>`
}

function historyDescription(event) {
  const direction = (from, to) => `${from} → ${to}`
  const leave = entry => `${t(entry.kind)} · ${periodDates(entry)}`
  switch (event.type) {
    case 'startSet': return displayDate(event.to)
    case 'startImported': return event.recurringStart
      ? t('importedStartDetail').replace('{date}', displayDate(event.to)).replace('{next}', displayDate(event.recurringStart))
      : displayDate(event.to)
    case 'startChanged': return direction(displayDate(event.from), displayDate(event.to))
    case 'socialTakenChanged': return `${periodName({ name: event.periodName, year: event.year })} · ${direction(number(event.from), number(event.to))}`
    case 'thresholdChanged': return direction(number(event.from), number(event.to))
    case 'maternityRuleUpdated': return t('maternityRuleDetail')
    case 'leaveAdded': return leave(event.to)
    case 'leaveDeleted': return leave(event.from)
    case 'leaveEdited': return direction(leave(event.from), leave(event.to))
  }
}

function periodHistory(worker) {
  if (!worker) return ''
  const history = worker.periodHistory ?? []
  const original = history.find(event => event.type === 'startSet' || event.type === 'startImported')?.to ??
    worker.legacyPeriods?.[0]?.start ?? worker.periodStart
  if (!original) return ''
  const rows = history.slice().reverse().map(event => {
    const label = `<strong>${escape(event.name || t(event.type))}</strong>${event.name ? ` · ${t(event.type)}` : ''}
      ${event.recordedAt ? `<small>${displayDate(event.recordedAt)}</small>` : ''}
      <span>${escape(historyDescription(event))}</span>`
    const changes = event.changes.map(change => `<tr><td>${escape(periodName(change))}</td>
      <td>${periodDates(change.before)}</td><td>${periodDates(change.after)}</td></tr>`)
    return changes.length ? `<details class="history-entry"><summary>${label}</summary>
      ${table(['period', 'beforeChange', 'afterChange'], changes)}</details>` :
      `<div class="history-entry">${label}</div>`
  })
  return `<section class="panel"><div class="panel-top"><h2>${t('periodHistory')}</h2>
    <span>${t('originalStart')} <strong>${displayDate(original)}</strong></span></div>
    <div>${rows.join('')}</div></section>`
}

function renderPeriods(records) {
  const workers = records.workers.slice().sort((a, b) => a.name.localeCompare(b.name, language))
  const worker = workers.find(item => item.id === periodWorkerId) ?? workers[0]
  const periods = worker ? findBalance(worker.id).periods : []
  const rows = periods.slice().reverse().map(period => `<tr>
    <td><strong>${escape(periodName(period))}</strong><br><small>${periodDates(period)}</small></td>
    <td class="number">${number(period.offset)}</td><td class="number">${number(period.socialDays)}</td>
    <td class="number">${number(period.used)}</td><td class="number ${period.remaining < 0 ? 'over' : ''}">${totalDays(period.remaining)}</td>
    <td>${button('period-balance', 'adjustBalance', period.id, 'small')}</td></tr>`)
  const templates = records.periodTemplates.slice().sort((a, b) => a.name.localeCompare(b.name, language))
    .map(item => `<tr><td><strong>${escape(item.name)}</strong></td><td>${displayDate(item.start)}</td>
      <td>${button('edit-template', 'edit', item.id, 'small')}</td></tr>`)
  return heading('periods', button('new-template', 'addTemplate')) +
    `<section class="panel"><div class="panel-top">
      ${worker ? `<label>${t('worker')}<select data-filter="period-worker">${options(workers, worker.id)}</select></label>
        ${button('edit-worker-period', worker.periodStart ? 'editPeriodStart' : 'setPeriodStart', worker.id, 'primary')}`
        : `<h2>${t('workers')}</h2>${button('new-worker', 'addWorker', '', 'primary')}`}
      </div>${table(['period', 'offsetDays', 'socialDays', 'used', 'remaining', 'actions'], rows,
        worker ? 'noWorkerPeriodsHelp' : 'noWorkers')}</section>
    ${periodHistory(worker)}
    <section class="panel"><div class="panel-top"><h2>${t('periodTemplates')}</h2></div>
      ${table(['name', 'start', 'actions'], templates, 'noTemplates')}</section>`
}

function renderVacations(records) {
  const workers = new Map(records.workers.map(worker => [worker.id, worker]))
  const balances = new Map(snapshot.balances.map(balance => [balance.id, balance]))
  const rows = records.vacations.slice().sort((a, b) => b.start.localeCompare(a.start)).map(item => {
    const worker = workers.get(item.workerId)
    const period = balances.get(item.workerId).periods.find(period => period.id === item.periodId)
    const credit = item.interruptedDays ? `<br><small>${t('interruptedDays').replace('{days}', number(item.interruptedDays))}</small>` : ''
    return `<tr><td><strong>${escape(worker.name)}</strong></td><td>${t(item.kind)}</td><td>${period ? escape(periodName(period)) : t('none')}</td>
      <td>${displayDate(item.start)}</td><td>${displayDate(item.end)}</td><td class="number">${number(item.days)}${credit}</td><td><div class="actions">
      ${button('edit-vacation', 'edit', item.id, 'small')}${button('delete-vacation', 'delete', item.id, 'small danger')}</div></td></tr>`
  })
  return heading('vacations', button('new-vacation', 'recordVacation', '', 'primary')) +
    `<section class="panel">${table(['worker', 'leaveKind', 'period', 'start', 'end', 'days', 'actions'], rows, 'noVacations')}</section>`
}

function recordsStatus() {
  if (!recordsError) return `<p role="status">${t('loadingRecords')}</p>`
  return `<p class="error" role="alert">${t(recordsError)}</p>
    <div class="actions">${button('retry-records', 'retry')}</div>`
}

function mostRelevantDate(dates, current) {
  const sorted = [...dates].sort()
  return sorted.find(date => date >= current) ?? sorted.at(-1) ?? current
}

async function holidayFileDates(file) {
  let result
  try {
    result = parseHolidayDates(await file.text())
  } catch {
    return { error: t('unreadableHolidayFile').replace('{file}', () => file.name) }
  }
  if (result.invalidLine) {
    return { error: t('invalidHolidayDate').replace('{line}', number(result.invalidLine)).replace('{file}', () => file.name) }
  }
  if (!result.dates.length) {
    return { error: t('emptyHolidayFile').replace('{file}', () => file.name) }
  }
  return result
}

function mountHolidaySettings(form, settings) {
  const holidays = new Set(settings.holidays)
  const count = form.querySelector('.settings-date-count')
  const current = today()
  const updateCount = () => { count.textContent = `${t('selectedDates')} (${number(holidays.size)})` }
  const calendar = mountCalendar(form.querySelector('[data-calendar-host]'), {
    id: 'settings-holidays', initial: mostRelevantDate(holidays, current), today: current, language, t,
    markedDates: holidays, selected: date => holidays.has(date),
    choose(date) {
      if (form.dataset.saving) return
      if (!holidays.delete(date)) holidays.add(date)
      updateCount()
    },
  })
  form.addEventListener('formdata', ({ formData }) => {
    for (const date of holidays) formData.append('holidays', date)
  })
  updateCount()

  const input = form.querySelector('[data-holiday-file]')
  const importButton = form.querySelector('[data-action="import-holidays"]')
  const status = form.querySelector('[data-holiday-import-status]')
  const save = form.querySelector('[type="submit"]')
  importButton.addEventListener('click', () => {
    if (!form.dataset.saving && !form.dataset.importingDates) input.click()
  })
  input.addEventListener('change', async () => {
    const files = [...input.files]
    input.value = ''
    if (!files.length || form.dataset.saving || form.dataset.importingDates) return
    form.dataset.importingDates = 'yes'
    save.disabled = true
    status.textContent = ''
    status.classList.remove('error')
    try {
      const imported = new Set()
      for (const file of files) {
        const { dates, error } = await holidayFileDates(file)
        if (!form.isConnected) return
        if (error) {
          status.classList.add('error')
          status.textContent = error
          return
        }
        for (const date of dates) imported.add(date)
      }
      for (const date of holidays) imported.delete(date)
      if (!imported.size) {
        status.textContent = t('noNewHolidayDates')
        return
      }
      for (const date of imported) holidays.add(date)
      calendar.showDate(mostRelevantDate(imported, today()))
      updateCount()
      status.textContent = t('holidayDatesImported')
    } finally {
      delete form.dataset.importingDates
      save.disabled = false
    }
  })
}

function holidaySettings() {
  return `<section class="settings-calendar" aria-labelledby="holidays-label">
    <h3 id="holidays-label">${t('holidays')}</h3>
    <p class="settings-date-count" role="status"></p>
    <div data-calendar-host></div>
    <div class="actions">
    <button type="button" data-action="import-holidays" aria-describedby="holiday-file-format">${t('importHolidayDates')}</button>
    <input type="file" accept=".txt,text/plain" multiple data-holiday-file hidden>
    </div>
    <small id="holiday-file-format">${t('holidayFileFormat')}</small>
    <p class="holiday-import-status" data-holiday-import-status role="status"></p>
    <small>${t('holidayHelp')}</small>
    </section>`
}

function settings() {
  const current = snapshot?.records.settings
  return heading('settings') + `
    <section class="panel"><div class="panel-body">
    <h2>${t('localRecords')}</h2><p>${t('localRecordsHelp')}</p>
    ${snapshot ? '' : recordsStatus()}
    <div class="actions">${button('data-folder', 'openDataFolder')}
    ${snapshot?.revision === 0 ? button('database-import', 'importDatabase') : ''}</div>
    <p id="database-import-error" class="error" role="alert" hidden></p>
    </div></section>
    ${current ? `<section class="panel"><form class="panel-body" data-form="settings">
    <h2>${t('dayCounting')}</h2><p>${t('countingHelp')}</p>
    <label>${t('countRule')}<select name="counting">${options(['calendar', 'weekdays'].map(id => ({ id, name: t(id) })), current.counting === 'working' ? 'weekdays' : current.counting)}</select></label>
    ${holidaySettings()}
    <h2>${t('periodRules')}</h2>
    ${field('socialThreshold', 'socialThreshold', current.socialThreshold, 'number', 'required min="0" step="1"')}
    <small>${t('socialThresholdHelp')}</small>
    <div class="actions"><button type="submit" class="primary">${t('save')}</button></div>
    <p class="error" role="alert"></p></form></section>` : ''}
    <section class="panel"><div class="panel-body">
    <div id="update-panel"></div>
    <div><a class="repository-link" data-action="open-repository" href="https://github.com/Severnbli/rVacation">${t('githubRepository')}</a></div>
    </div></section>`
}

function renderUpdate() {
  const panel = document.querySelector('#update-panel')
  if (!panel) return
  panel.innerHTML = `<h2>${t('updates')}</h2><p>${t('version')} ${escape(version)}</p>
    <p role="status">${updateState === 'idle' ? '' : t(updateState)}</p><div class="actions">
    ${updateState === 'ready' ? button('update-install', 'installUpdate', '', 'primary') : button('update-check', 'checkUpdate')}
    </div>`
  const action = panel.querySelector('button')
  if (['checking', 'downloading'].includes(updateState)) action.disabled = true
}

function showUpdatePrompt() {
  if (updateState !== 'ready' || updatePromptShown || document.querySelector('dialog[open]')) return
  updatePrompt.innerHTML = `<form class="dialog-content" method="dialog">
    <h2 id="update-prompt-title">${t('updates')}</h2>
    <p id="update-prompt-message">${t('ready')}</p>
    <div class="actions dialog-actions">
    <button autofocus>${t('updateLater')}</button>
    ${button('update-install', 'installUpdate', '', 'primary')}
    </div></form>`
  updatePrompt.showModal()
  updatePromptShown = true
}

function render() {
  document.documentElement.lang = language
  nav.setAttribute('aria-label', t('navigation'))
  nav.innerHTML = pages.map(id => `<button type="button" data-action="page" data-id="${id}" ${id === page ? 'aria-current="page"' : ''}>${t(id)}</button>`).join('')
  footer.innerHTML = `<label>${t('language')}<select id="language">${options(Object.entries(localeNames).map(([id, name]) => ({ id, name })), language)}</select></label>`
  if (page === 'settings') {
    main.innerHTML = settings()
    if (snapshot) mountHolidaySettings(main.querySelector('[data-form="settings"]'), snapshot.records.settings)
    renderUpdate()
  } else if (!snapshot) {
    main.innerHTML = heading(page) + `<section class="panel"><div class="panel-body">${recordsStatus()}</div></section>`
  } else {
    const renderPage = { overview, workers, groups: renderGroups, periods: renderPeriods, vacations: renderVacations }
    main.innerHTML = renderPage[page](snapshot.records)
  }
}

function setSnapshot(result) {
  const workers = result.records.workers.filter(worker => worker.fired !== true)
  const activeIds = new Set(workers.map(worker => worker.id))
  snapshot = {
    ...result,
    firedWorkers: result.records.workers.filter(worker => worker.fired === true),
    records: { ...result.records, workers, vacations: result.records.vacations.filter(item => activeIds.has(item.workerId)) },
    balances: result.balances.filter(balance => activeIds.has(balance.id)),
  }
  if (!workers.some(worker => worker.id === periodWorkerId)) periodWorkerId = ''
  if (!result.records.groups.some(group => group.id === groupId)) groupId = ''
}

async function loadRecords() {
  const result = await desktop.getRecords()
  recordsError = result.error
  if (!result.error) setSnapshot(result)
  render()
}

async function importDatabase(target) {
  if (importingDatabase) return
  importingDatabase = true
  target.disabled = true
  const previousError = document.querySelector('#database-import-error')
  previousError.hidden = true
  try {
    const result = await desktop.importDatabase()
    if (result.error) {
      const error = document.querySelector('#database-import-error')
      if (error) {
        error.hidden = false
        error.textContent = t(result.error)
      }
    } else if (!result.canceled) {
      setSnapshot(result)
      render()
      toast('databaseImported')
      if (page === 'settings') main.querySelector('h1').focus()
    }
  } finally {
    importingDatabase = false
    target.disabled = false
    if (target.isConnected) target.focus()
  }
}

function groupPicker(selected = []) {
  return `<fieldset><legend>${t('groups')}</legend>${snapshot.records.groups.map(item =>
    `<label class="check"><input type="checkbox" name="groups" value="${escape(item.id)}" ${selected.includes(item.id) ? 'checked' : ''}>${escape(item.name)}</label>`).join('') || `<small>${t('noGroups')}</small>`}</fieldset>`
}

function editor(type, title, content, id = '', submit = 'save') {
  dialog.innerHTML = `<form class="dialog-content" data-form="${type}" data-id="${escape(id)}">
    <h2 id="editor-title">${t(title)}</h2>${content}<p class="error" role="alert"></p>
    <div class="actions dialog-actions">${button('close', 'cancel')}<button class="${['delete', 'markFired'].includes(submit) ? 'danger' : 'primary'}">${t(submit)}</button></div></form>`
  dialog.setAttribute('aria-labelledby', 'editor-title')
  if (!dialog.open) dialog.showModal()
}

const limitInput = value => field('limit', 'limit', value ?? '', 'number', 'min="0" step="1"')
const changeNameField = () => field('changeName', 'changeName', '', 'text', 'maxlength="160"')
const nameInput = value => field('name', 'name', value, 'text', 'required maxlength="160" autofocus')

function dateRange({ start = '', end = '' }) {
  const startText = start ? displayDate(start) : t('none')
  const endText = end ? displayDate(end) : t('none')
  const label = `${t('dateRange')}. ${t('start')} ${startText}. ${t('end')} ${endText}`
  return `<div class="range-field">
    <input type="hidden" name="start" value="${escape(start)}">
    <input type="hidden" name="end" value="${escape(end)}">
    <button type="button" class="range-trigger" data-action="record-dates" aria-haspopup="dialog" aria-label="${escape(label)}">
      <span class="range-icon" aria-hidden="true"></span>
      <span><small>${t('start')}</small><strong>${escape(startText)}</strong></span>
      <span><small>${t('end')}</small><strong>${escape(endText)}</strong></span>
    </button>
    </div>`
}

function describeVacationRange(form, start, end) {
  const records = snapshot.records
  const worker = records.workers.find(item => item.id === form.elements.workerId.value)
  if (!worker) return { message: 'chooseWorker' }

  const previous = records.vacations.find(item => item.id === form.dataset.id)
  const { period, periods } = vacationPeriodChoice(form, worker, previous, start, end)
  const { vacation, remaining, exceedsAllowance } = annualVacationCharge(records, { worker, previous, period, start, end })
  const message = !periods.length ? 'workerNeedsPeriod' : !period ? 'noPeriodForStart' :
    exceedsAllowance ? 'allowanceExceeded' : ''
  return {
    days: vacation.days,
    remaining,
    period: period ? `${periodName(period)} · ${periodDates(period)}` : '',
    message, exceedsAllowance,
  }
}

function chooseRecordDates(target) {
  const form = target.form
  if (form.dataset.saving) return
  const dates = [form.elements.start.value, form.elements.end.value]
  openDatePicker({
    title: t('dateRange'), dates, language, t, today: today(),
    holidays: new Set(snapshot.records.settings.holidays),
    describeRange: form.elements.kind.value === 'annual' ? (start, end) => describeVacationRange(form, start, end) : undefined,
    onApply: ([start, end]) => {
      target.closest('.range-field').outerHTML = dateRange({ start, end })
      updateLeaveFields(form)
      form.querySelector('[data-action="record-dates"]').focus()
    },
  })
}

function workerPeriodFields(worker, required = false) {
  const templates = snapshot.records.periodTemplates.slice().sort((a, b) => a.name.localeCompare(b.name, language))
  const last = worker.legacyPeriods?.at(-1)
  return `<div class="period-fields">
    ${templates.length ? `<label>${t('periodTemplate')}<select name="templateId">${options(templates, '', 'chooseTemplate')}</select></label>` : ''}
    ${field('periodStart', 'periodStart', worker.periodStart, 'date', `min="1000-01-01" max="9999-12-31" ${required ? 'required' : ''}`)}
    ${field('periodName', 'periodName', worker.periodName, 'text', 'maxlength="160"')}
    <small>${last ? t('legacyPeriodHelp').replace('{date}', displayDate(last.end)) : t('periodStartHelp')}</small>
    ${worker.periodStart ? `<div data-change-name hidden>${changeNameField()}</div>` : ''}
  </div>`
}

function workerEdit(id) {
  const item = snapshot.records.workers.find(item => item.id === id) ?? {}
  editor('worker', id ? 'editWorker' : 'addWorker', nameInput(item.name) + limitInput(item.limit) +
    `<small>${t('personalHelp')}</small>` + groupPicker(item.groups) + workerPeriodFields(item, !id || Boolean(item.periodStart)), id)
}

function fireWorker(id) {
  const worker = snapshot.records.workers.find(item => item.id === id)
  if (!worker) return toast('recordMissing')
  editor('fireWorker', 'markFired', `<strong>${escape(worker.name)}</strong><p>${t('fireWorkerHelp')}</p>`, id, 'markFired')
}

function recoverWorkers() {
  const workers = snapshot.firedWorkers.slice().sort((a, b) => a.name.localeCompare(b.name, language)).map(worker => {
    const groups = groupNames(worker, snapshot.records.groups).join(', ')
    return { ...worker, name: groups ? `${worker.name} (${groups})` : worker.name }
  })
  editor('recoverWorker', 'recoverWorkers',
    `<label>${t('worker')}<select name="workerId" required>${options(workers, '', 'chooseWorker')}</select></label>`, '', 'recoverWorker')
}

function groupEdit(id) {
  const item = snapshot.records.groups.find(item => item.id === id) ?? {}
  editor('group', id ? 'editGroup' : 'addGroup', nameInput(item.name) + limitInput(item.limit), id)
}

function templateEdit(id) {
  const item = snapshot.records.periodTemplates.find(item => item.id === id) ?? {}
  editor('periodTemplate', id ? 'editTemplate' : 'addTemplate', nameInput(item.name) +
    field('start', 'start', item.start, 'date', 'required min="1000-01-01" max="9999-12-31"'), id)
}

function workerPeriodEdit(id) {
  const worker = snapshot.records.workers.find(item => item.id === id)
  if (!worker) return toast('recordMissing')
  editor('workerPeriod', worker.periodStart ? 'editPeriodStart' : 'setPeriodStart',
    `<strong>${escape(worker.name)}</strong>` + workerPeriodFields(worker, true), id)
}

function balanceEdit(id) {
  const workerId = main.querySelector('[data-filter="period-worker"]').value
  const period = findBalance(workerId).periods.find(period => period.id === id)
  const reset = period.vacationCeiling === null ? '' :
    `<label class="check"><input type="checkbox" name="resetRemaining">${t('resetRemaining')}</label>`
  editor('periodBalance', 'adjustBalance', `
    <p><strong>${escape(periodName(period))}</strong> · ${periodDates(period)}</p>
    <input type="hidden" name="periodId" value="${escape(id)}">
    ${field('remaining', 'setRemaining', '', 'number', 'min="0" step="1"')}
    <small>${t('remainingNow').replace('{days}', totalDays(period.remaining))}</small>
    ${reset}
    ${field('socialTaken', 'socialTaken', period.socialTaken, 'number', 'required min="0" step="1"')}
    <small>${t('socialTakenHelp')}</small>
    <div data-change-name hidden>${changeNameField()}</div>`, workerId)
  dialog.querySelector('[name="socialTaken"]').dataset.original = period.socialTaken
}

function vacationPeriodChoice(form, worker, previous, start, end) {
  const periods = annualVacationPeriods(snapshot.records, worker, previous, start > end ? start : end)
  const manual = periods.find(period => period.id === form.dataset.manualPeriod)
  return { periods, period: manual ?? periodOn(periods, start) }
}

function updateLeaveFields(form) {
  const worker = snapshot.records.workers.find(item => item.id === form.elements.workerId.value)
  const { start, end, kind, periodId } = form.elements
  const annual = kind.value === 'annual'
  const pickerVisible = Boolean(annual && worker)
  periodId.closest('.period-choice').hidden = !pickerVisible
  periodId.disabled = !pickerVisible
  periodId.required = pickerVisible
  setFormError(form, '')
  const entries = worker ? snapshot.records.vacations.filter(item =>
    item.workerId === worker.id && item.id !== form.dataset.id) : []
  const interrupted = annual && entries.some(item => interruptsVacation(item.kind) &&
    item.start <= end.value && item.end >= start.value)
  const help = form.querySelector('[data-leave-help]')
  help.textContent = annual ? interrupted ? t('interruptedHelp') : '' : t(kind.value + 'Help')
  help.hidden = !help.textContent
  if (!worker) return

  if (pickerVisible) {
    const previous = snapshot.records.vacations.find(item => item.id === form.dataset.id)
    const { periods, period } = vacationPeriodChoice(form, worker, previous, start.value, end.value)
    const selected = period?.id ?? ''
    const choices = periods.slice().reverse().map(period => ({ id: period.id, name: `${periodName(period)} · ${periodDates(period)}` }))
    periodId.innerHTML = options(choices, selected, 'choosePeriod')
    periodId.value = selected
    if (!periods.length) setFormError(form, 'workerNeedsPeriod')
    else if (!selected) setFormError(form, 'noPeriodForStart')
  } else if (movesWorkingYear(kind.value)) {
    const through = [today(), start.value, end.value].sort().at(-1)
    const periods = periodsFor(worker, entries, snapshot.records.settings.socialThreshold, through)
    if (!periodOn(periods, start.value)) setFormError(form, 'leaveOutsidePeriod')
  }
}

function vacationEdit(id, workerId) {
  const records = snapshot.records
  if (!records.workers.length) return toast('vacationNeedsRecords')
  const item = records.vacations.find(item => item.id === id)
  editor('vacation', item ? 'editVacation' : 'recordVacation',
    `<label>${t('worker')}<select name="workerId" required>${options(records.workers.slice().sort((a, b) => a.name.localeCompare(b.name, language)), item?.workerId ?? workerId, 'chooseWorker')}</select></label>
    <label>${t('leaveKind')}<select name="kind">${options(leaveKinds.map(id => ({ id, name: t(id) })), item?.kind ?? 'annual')}</select></label>
    ${dateRange(item ?? { start: today(), end: today() })}
    <small data-leave-help hidden></small>
    <div class="period-choice"><label>${t('period')}<select name="periodId"></select></label>
    <small>${t('periodHelp')}</small></div>`, id)
  const form = dialog.querySelector('form')
  if (item?.periodId) form.dataset.manualPeriod = item.periodId
  updateLeaveFields(form)
}

function importEditor() {
  editor('import', 'bulkAdd', `<div class="actions">${button('open-file', 'pickFile')}</div>
    ${textarea('names', 'workerRows', '', 'importHelp')}
    <label class="check"><input type="checkbox" name="header">${t('skipHeader')}</label>
    ${groupPicker()}${workerPeriodFields({})}`, '', 'import')
}

function setFormError(form, error) {
  form.querySelector('.error').textContent = t(error)
}

async function submitForm(event) {
  const form = event.target
  const type = form.dataset.form
  if (!type) return
  event.preventDefault()
  if (form.dataset.saving || form.dataset.importingDates) return
  form.dataset.saving = 'yes'
  const submit = form.querySelector('button:not([type="button"])')
  submit.disabled = true
  setFormError(form, '')
  try {
    const data = new FormData(form)
    const value = Object.fromEntries(data)
    if (type === 'vacation' && (!value.start || !value.end)) {
      setFormError(form, value.start ? 'selectRangeEnd' : 'selectRangeStart')
      form.querySelector('[data-action="record-dates"]').focus()
      return
    }
    if (type === 'worker' || type === 'import') value.groups = data.getAll('groups')
    if (type === 'worker' || type === 'group') value.limit = value.limit === '' ? null : Number(value.limit)
    if (type === 'periodBalance') {
      value.socialTaken = Number(value.socialTaken)
      if (value.resetRemaining) value.remaining = null
      else if (value.remaining) value.remaining = Number(value.remaining)
      else delete value.remaining
    }
    if (type === 'settings') {
      value.socialThreshold = Number(value.socialThreshold)
      value.holidays = data.getAll('holidays')
    }
    if (type === 'import') {
      value.limit = null
      value.names = value.names.split(/\r?\n/).map(line => line.split('\t', 1)[0].trim()).filter(Boolean)
      if (value.header) value.names.shift()
    }
    const id = type === 'recoverWorker' ? value.workerId : form.dataset.id || undefined
    const result = await desktop.change({ revision: snapshot.revision, change: { type, id, value } })
    if (result.error === 'conflict') {
      const latest = await desktop.getRecords()
      if (!latest.error) setSnapshot(latest)
    }
    if (result.error) return setFormError(form, result.error)
    setSnapshot(result)
    if (dialog.open) dialog.close()
    render()
    toast('saved')
    main.querySelector('h1')?.focus()
  } finally {
    delete form.dataset.saving
    submit.disabled = false
  }
}

function applyFilter(input) {
  const filter = input.dataset.filter
  if (filter === 'date' && (!input.value || isRecordDate(input.value) && input.value <= today())) balanceDate = input.value
  if (filter === 'group') groupId = input.value
  if (filter === 'sort') sortBy = input.value
  if (filter === 'search') search = input.value
  if (filter === 'period-worker') {
    periodWorkerId = input.value
    render()
    main.querySelector('[data-filter="period-worker"]').focus()
  } else {
    document.querySelector('#worker-results').innerHTML = workerResults(snapshot.records, page === 'overview')
  }
}

document.addEventListener('submit', submitForm)
document.addEventListener('close', showUpdatePrompt, true)
document.addEventListener('change', event => {
  const source = event.target
  if (source.id === 'language') {
    language = source.value
    localStorage.setItem('language', language)
    notice.textContent = ''
    render()
    document.querySelector('#language').focus()
  }
  if (source.dataset.filter && source.dataset.filter !== 'search') applyFilter(source)
  const form = source.form
  if (source.name === 'templateId') {
    const template = snapshot.records.periodTemplates.find(item => item.id === source.value)
    if (template) {
      form.elements.periodName.value = template.name
      form.elements.periodStart.value = template.start
      setFormError(form, '')
    }
  }
  if (source.name === 'templateId' || source.name === 'periodStart') showChangeName(form?.elements.periodStart)
  if (source.name === 'resetRemaining') form.elements.remaining.disabled = source.checked
  if (form?.dataset.form === 'vacation') {
    if (source.name === 'workerId') {
      delete form.dataset.manualPeriod
      updateLeaveFields(form)
    }
    if (source.name === 'kind') updateLeaveFields(form)
    if (source.name === 'periodId') {
      form.dataset.manualPeriod = source.value
      setFormError(form, source.value ? '' : 'noPeriodForStart')
    }
  }
})
function showChangeName(input) {
  const field = input?.form?.querySelector('[data-change-name]')
  if (!field) return
  field.hidden = input.value === (input.dataset.original ?? input.defaultValue)
  field.querySelector('input').disabled = field.hidden
}

document.addEventListener('input', event => {
  if (event.target.dataset.filter === 'search') applyFilter(event.target)
  if (['periodStart', 'socialTaken'].includes(event.target.name)) showChangeName(event.target)
})
dialog.addEventListener('cancel', event => {
  if (dialog.querySelector('form')?.dataset.saving) event.preventDefault()
})
document.addEventListener('click', async event => {
  const target = event.target.closest('[data-action]')
  if (!target) return
  const { action, id } = target.dataset
  switch (action) {
    case 'page': {
      const fromNavigation = nav.contains(target)
      page = id
      render()
      if (fromNavigation) nav.querySelector('[aria-current]').focus()
      else main.querySelector('h1').focus()
      break
    }
    case 'retry-records': {
      target.disabled = true
      await loadRecords()
      const focusTarget = main.querySelector('[data-action="retry-records"]') ?? main.querySelector('h1')
      focusTarget.focus()
      break
    }
    case 'database-import': await importDatabase(target); break
    case 'data-folder': {
      const result = await desktop.openDataFolder()
      if (result?.error) toast(result.error)
      break
    }
    case 'new-worker': case 'edit-worker': workerEdit(id); break
    case 'fire-worker': fireWorker(id); break
    case 'recover-workers': recoverWorkers(); break
    case 'new-group': case 'edit-group': groupEdit(id); break
    case 'worker-periods':
      periodWorkerId = id
      page = 'periods'
      render()
      main.querySelector('h1').focus()
      break
    case 'edit-worker-period': workerPeriodEdit(id); break
    case 'period-balance': balanceEdit(id); break
    case 'new-template': case 'edit-template': templateEdit(id); break
    case 'new-vacation': case 'edit-vacation': vacationEdit(id); break
    case 'vacation-for': vacationEdit('', id); break
    case 'delete-vacation': editor('deleteVacation', 'deleteVacation', `<p>${t('deleteHelp')}</p>`, id, 'delete'); break
    case 'import': importEditor(); break
    case 'open-file': {
      const form = target.form
      const result = await desktop.openWorkers()
      if (result.error) setFormError(form, result.error)
      else if (!result.canceled) form.elements.names.value = result.names.join('\n')
      break
    }
    case 'close': if (!target.form.dataset.saving) dialog.close(); break
    case 'record-dates': chooseRecordDates(target); break
    case 'open-repository': {
      event.preventDefault()
      const result = await desktop.openRepository()
      if (result?.error) toast(result.error)
      break
    }
    case 'update-check': await desktop.checkUpdate(); break
    case 'update-install': {
      if (updatePrompt.open) updatePrompt.close()
      const result = await desktop.installUpdate()
      if (result?.error) toast(result.error)
      break
    }
  }
})

async function initialize() {
  desktop.onUpdate(state => {
    updateState = state
    renderUpdate()
    showUpdatePrompt()
  })
  const [update] = await Promise.all([desktop.getUpdate(), loadRecords()])
  version = update.version
  if (updateState === 'idle') updateState = update.state
  renderUpdate()
  showUpdatePrompt()
}

render()
void initialize()
