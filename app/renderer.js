const main = document.querySelector('#main')
const dialog = document.querySelector('#editor')
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
let periodId = ''
let groupId = ''
let sortBy = 'name'
let search = ''
let version = ''
let updateState = 'idle'
let noticeTimer

const t = key => messages[key]?.[Object.keys(localeNames).indexOf(language)] ?? messages[key]?.[0] ?? key
const number = value => new Intl.NumberFormat(language).format(value)
const displayDate = value => new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value))
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character])
const today = () => {
  const date = new Date()
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()].map(value => String(value).padStart(2, '0')).join('-')
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

function filters(records, showPeriods) {
  return `<div class="filters">
    ${showPeriods ? `<label>${t('period')}<select data-filter="period" ${!records.periods.length ? 'disabled' : ''}>${options(records.periods, periodId, records.periods.length ? null : 'noPeriods')}</select></label>` : ''}
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
    const used = balance.used[periodId] ?? 0
    const rule = personal ? t('personal') : limitingGroups.join(', ')
    const remaining = max === null ? t('unlimited') : number(max - used)
    return `<tr><td><strong>${escape(worker.name)}</strong></td><td>${groupBadges(worker, records.groups)}</td>
      ${overview ? `<td class="number">${periodId ? number(used) : t('none')}</td>` : ''}
      <td class="number" title="${escape(rule)}">${max === null ? t('unlimited') : number(max)}
      ${rule ? `<br><small>${escape(rule)}</small>` : ''}</td>
      ${overview ? `<td class="number ${max !== null && used > max ? 'over' : ''}">${periodId ? remaining : t('none')}</td>` : ''}
      <td>${overview ? button('vacation-for', 'recordShort', worker.id, 'small') : button('edit-worker', 'edit', worker.id, 'small')}</td></tr>`
  })
}

function overview(records) {
  const metrics = [
    ['workers', records.workers.length],
    ['groups', records.groups.length],
    ['vacationsInPeriod', records.vacations.filter(item => item.periodId === periodId).length],
  ]
  return heading('overview', button('new-vacation', 'recordVacation', '', 'primary')) +
    (snapshot.showLegacyImport ? `<section class="panel setup"><div class="panel-body"><h2>${t('legacyRecords')}</h2>
    <p>${t('legacyRecordsHelp')}</p><div class="actions">${button('page', 'settings', 'settings')}</div></div></section>` : '') +
    (!records.workers.length || !records.periods.length ? `<section class="panel setup"><div class="panel-body"><h2>${t('getStarted')}</h2>
    <p>${t('vacationNeedsRecords')}</p><div class="actions">${!records.workers.length ? button('page', 'workers', 'workers') : ''}
    ${!records.periods.length ? button('page', 'periods', 'periods') : ''}</div></div></section>` : '') +
    `<div class="cards">${metrics.map(([key, value]) => `<div class="card"><strong>${number(value)}</strong><span>${t(key)}</span></div>`).join('')}</div>
    <section class="panel"><div class="panel-top"><h2>${t('balances')}</h2>${filters(records, true)}</div>
    <div id="worker-results">${workerResults(records, true)}</div></section>`
}

function workerResults(records, overviewMode) {
  return table(overviewMode ? ['worker', 'groups', 'used', 'limit', 'remaining', 'actions'] : ['worker', 'groups', 'limit', 'actions'],
    workerRows(records, overviewMode), records.workers.length ? 'noMatches' : 'noWorkers')
}

function workers(records) {
  return heading('workers', button('import', 'bulkAdd') + button('new-worker', 'addWorker', '', 'primary')) +
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

function renderPeriods(records) {
  const rows = records.periods.slice().sort((a, b) => b.start.localeCompare(a.start)).map(item =>
    `<tr><td><strong>${escape(item.name)}</strong></td><td>${displayDate(item.start)}</td><td>${displayDate(item.end)}</td>
    <td>${button('edit-period', 'edit', item.id, 'small')}</td></tr>`)
  return heading('periods', button('new-period', 'addPeriod', '', 'primary')) +
    `<section class="panel">${table(['name', 'start', 'end', 'actions'], rows, 'noPeriods')}</section>`
}

function renderVacations(records) {
  const rows = records.vacations.slice().sort((a, b) => b.start.localeCompare(a.start)).map(item => {
    const worker = records.workers.find(worker => worker.id === item.workerId)
    const period = records.periods.find(period => period.id === item.periodId)
    return `<tr><td><strong>${escape(worker.name)}</strong></td><td>${escape(period.name)}</td><td>${displayDate(item.start)}</td>
      <td>${displayDate(item.end)}</td><td>${number(item.days)}</td><td><div class="actions">
      ${button('edit-vacation', 'edit', item.id, 'small')}${button('delete-vacation', 'delete', item.id, 'small danger')}</div></td></tr>`
  })
  return heading('vacations', button('new-vacation', 'recordVacation', '', 'primary')) +
    `<section class="panel">${table(['worker', 'period', 'start', 'end', 'days', 'actions'], rows, 'noVacations')}</section>`
}

function recordsStatus() {
  if (!recordsError) return `<p role="status">${t('loadingRecords')}</p>`
  return `<p class="error" role="alert">${t(recordsError)}</p>
    <div class="actions">${button('retry-records', 'retry')}</div>`
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
    <label>${t('countRule')}<select name="counting">${options(['calendar', 'weekdays', 'working'].map(id => ({ id, name: t(id) })), current.counting)}</select></label>
    ${textarea('holidays', 'holidays', current.holidays.join('\n'), 'dateHelp')}
    ${textarea('deductible', 'deductible', current.deductible.join('\n'), 'dateHelp')}
    <div class="actions"><button class="primary">${t('save')}</button></div>
    <p class="error" role="alert"></p></form></section>` : ''}
    <section class="panel"><div class="panel-body" id="update-panel"></div></section>`
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

function render() {
  document.documentElement.lang = language
  nav.setAttribute('aria-label', t('navigation'))
  nav.innerHTML = pages.map(id => `<button type="button" data-action="page" data-id="${id}" ${id === page ? 'aria-current="page"' : ''}>${t(id)}</button>`).join('')
  footer.innerHTML = `<label>${t('language')}<select id="language">${options(Object.entries(localeNames).map(([id, name]) => ({ id, name })), language)}</select></label>`
  if (page === 'settings') {
    main.innerHTML = settings()
    renderUpdate()
  } else if (!snapshot) {
    main.innerHTML = heading(page) + `<section class="panel"><div class="panel-body">${recordsStatus()}</div></section>`
  } else {
    const renderPage = { overview, workers, groups: renderGroups, periods: renderPeriods, vacations: renderVacations }
    main.innerHTML = renderPage[page](snapshot.records)
  }
}

function setSnapshot(result) {
  snapshot = result
  const periods = result.records.periods
  if (!periods.some(item => item.id === periodId)) {
    const date = today()
    periodId = periods.find(item => item.start <= date && item.end >= date)?.id ??
      periods.slice().sort((a, b) => b.start.localeCompare(a.start))[0]?.id ?? ''
  }
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
    <div class="actions dialog-actions">${button('close', 'cancel')}<button class="${submit === 'delete' ? 'danger' : 'primary'}">${t(submit)}</button></div></form>`
  dialog.setAttribute('aria-labelledby', 'editor-title')
  if (!dialog.open) dialog.showModal()
}

const limitInput = value => field('limit', 'limit', value ?? '', 'number', 'min="0" step="1"')
const nameInput = value => field('name', 'name', value, 'text', 'required maxlength="160" autofocus')
const datePair = item => `<div class="pair">${field('start', 'start', item.start, 'date', 'required')}
  ${field('end', 'end', item.end, 'date', 'required')}</div>`

function workerEdit(id) {
  const item = snapshot.records.workers.find(item => item.id === id) ?? {}
  editor('worker', id ? 'editWorker' : 'addWorker',
    nameInput(item.name) + limitInput(item.limit) + `<small>${t('personalHelp')}</small>` + groupPicker(item.groups), id)
}

function groupEdit(id) {
  const item = snapshot.records.groups.find(item => item.id === id) ?? {}
  editor('group', id ? 'editGroup' : 'addGroup', nameInput(item.name) + limitInput(item.limit), id)
}

function periodEdit(id) {
  const item = snapshot.records.periods.find(item => item.id === id) ?? {}
  editor('period', id ? 'editPeriod' : 'addPeriod', nameInput(item.name) + datePair(item), id)
}

function suggestPeriod(form) {
  if (form.dataset.periodManual) return
  const start = form.elements.start.value
  const match = snapshot.records.periods.find(period => period.start <= start && period.end >= start)
  form.elements.periodId.value = match?.id ?? ''
}

function vacationEdit(id, workerId) {
  const records = snapshot.records
  if (!records.workers.length || !records.periods.length) return toast('vacationNeedsRecords')
  const item = records.vacations.find(item => item.id === id)
  editor('vacation', item ? 'editVacation' : 'recordVacation',
    `<label>${t('worker')}<select name="workerId" required>${options(records.workers.slice().sort((a, b) => a.name.localeCompare(b.name, language)), item?.workerId ?? workerId, 'chooseWorker')}</select></label>
    ${datePair(item ?? { start: today(), end: today() })}
    <label>${t('period')}<select name="periodId" required>${options(records.periods, item?.periodId, 'choosePeriod')}</select></label>
    <small>${t('periodHelp')}</small>`, id)
  if (!item) suggestPeriod(dialog.querySelector('form'))
  else dialog.querySelector('form').dataset.periodManual = 'yes'
}

function importEditor() {
  editor('import', 'bulkAdd', `<div class="actions">${button('open-file', 'pickFile')}</div>
    ${textarea('names', 'workerRows', '', 'importHelp')}
    <label class="check"><input type="checkbox" name="header">${t('skipHeader')}</label>
    ${groupPicker()}`, '', 'import')
}

function setFormError(form, error) {
  form.querySelector('.error').textContent = t(error)
}

function splitDates(input) {
  return input.split(/[\s,;]+/).filter(Boolean)
}

async function submitForm(event) {
  const form = event.target
  const type = form.dataset.form
  if (!type) return
  event.preventDefault()
  if (form.dataset.saving) return
  form.dataset.saving = 'yes'
  const submit = form.querySelector('button:not([type="button"])')
  submit.disabled = true
  setFormError(form, '')
  try {
    const data = new FormData(form)
    const value = Object.fromEntries(data)
    if (type === 'worker' || type === 'import') value.groups = data.getAll('groups')
    if (type === 'worker' || type === 'group') value.limit = value.limit === '' ? null : Number(value.limit)
    if (type === 'settings') {
      value.holidays = splitDates(value.holidays)
      value.deductible = splitDates(value.deductible)
    }
    if (type === 'import') {
      value.limit = null
      value.names = value.names.split(/\r?\n/).map(line => line.split('\t', 1)[0].trim()).filter(Boolean)
      if (value.header) value.names.shift()
    }
    const result = await desktop.change({ revision: snapshot.revision, change: { type, id: form.dataset.id || undefined, value } })
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
  if (input.dataset.filter === 'period') periodId = input.value
  if (input.dataset.filter === 'group') groupId = input.value
  if (input.dataset.filter === 'sort') sortBy = input.value
  if (input.dataset.filter === 'search') search = input.value
  if (input.dataset.filter === 'period') {
    render()
    main.querySelector('[data-filter="period"]').focus()
  } else {
    document.querySelector('#worker-results').innerHTML = workerResults(snapshot.records, page === 'overview')
  }
}

document.addEventListener('submit', submitForm)
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
  if (form?.dataset.form === 'vacation') {
    if (source.name === 'periodId') form.dataset.periodManual = 'yes'
    if (source.name === 'start') suggestPeriod(form)
  }
})
document.addEventListener('input', event => {
  if (event.target.dataset.filter === 'search') applyFilter(event.target)
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
    case 'new-group': case 'edit-group': groupEdit(id); break
    case 'new-period': case 'edit-period': periodEdit(id); break
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
    case 'update-check': await desktop.checkUpdate(); break
    case 'update-install': await desktop.installUpdate(); break
  }
})

async function initialize() {
  desktop.onUpdate(state => {
    updateState = state
    renderUpdate()
  })
  const [update] = await Promise.all([desktop.getUpdate(), loadRecords()])
  version = update.version
  updateState = update.state
  renderUpdate()
}

render()
void initialize()
