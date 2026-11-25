const firstCalendarDate = Date.UTC(1000, 0, 1)
const lastCalendarDate = Date.UTC(9999, 11, 31)
const calendarIso = date => date.toISOString().slice(0, 10)
const boundedCalendarDate = time => new Date(Math.min(lastCalendarDate, Math.max(firstCalendarDate, time)))

function changeCalendarMonth(cursor, year, month) {
  const length = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return boundedCalendarDate(Date.UTC(year, month, Math.min(cursor.getUTCDate(), length)))
}

function calendarKeyDate(cursor, { key, shiftKey }, weekOffset) {
  if (key === 'PageUp' || key === 'PageDown') {
    const step = (key === 'PageUp' ? -1 : 1) * (shiftKey ? 12 : 1)
    return changeCalendarMonth(cursor, cursor.getUTCFullYear(), cursor.getUTCMonth() + step)
  }
  const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7,
    Home: -weekOffset(cursor), End: 6 - weekOffset(cursor) }
  if (Object.hasOwn(offsets, key)) return boundedCalendarDate(+cursor + offsets[key] * 86400000)
}

function calendarView({ today, language, holidays, holidayLabel, selectedDates }) {
  const weekStart = new Intl.Locale(language).getWeekInfo().firstDay % 7
  const weekOffset = date => (date.getUTCDay() - weekStart + 7) % 7
  const weekday = dateFormatter(language, 'weekday')
  const monthName = dateFormatter(language, 'monthName')
  const months = Array.from({ length: 12 }, (_, index) => monthName(new Date(Date.UTC(2024, index, 1))))
  const monthLabel = dateFormatter(language, 'month')
  const dateLabel = dateFormatter(language, 'full')
  const number = new Intl.NumberFormat(language)
  const headers = `<thead><tr>${Array.from({ length: 7 }, (_, index) =>
    `<th scope="col">${weekday(new Date(Date.UTC(2024, 0, 7 + weekStart + index)))}</th>`).join('')}</tr></thead>`

  function rows(year, month) {
    const offset = weekOffset(new Date(Date.UTC(year, month, 1)))
    const length = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
    return Array.from({ length: Math.ceil((offset + length) / 7) }, (_, row) => `<tr>${Array.from({ length: 7 }, (_, column) => {
      const dayOfMonth = row * 7 + column - offset + 1
      if (dayOfMonth < 1 || dayOfMonth > length) return '<td></td>'
      const date = new Date(Date.UTC(year, month, dayOfMonth))
      const value = calendarIso(date)
      const holiday = holidays?.has(value)
      const label = holiday ? `${dateLabel(date)}. ${holidayLabel}` : dateLabel(date)
      return `<td><button type="button" data-date="${value}" aria-label="${label}" tabindex="-1"
        ${holiday ? `class="calendar-holiday" title="${holidayLabel}"` : ''}
        ${selectedDates ? `aria-pressed="${selectedDates.has(value)}"` : ''}
        ${value === today ? 'aria-current="date"' : ''}>${number.format(dayOfMonth)}</button></td>`
    }).join('')}</tr>`).join('')
  }

  return { headers, months, monthLabel, rows, weekOffset }
}

function mountCalendar(container, { initial, today, language, t, id, selected, choose, holidays, rangePosition }) {
  const view = calendarView({ today, language, holidays, holidayLabel: t('publicHoliday') })
  let cursor = boundedCalendarDate(Date.parse(initial))

  container.insertAdjacentHTML('beforeend', `<div class="calendar-header">
      <button type="button" data-month-step="-1" aria-label="${t('previousMonth')}" title="${t('previousMonth')}">‹</button>
      <div class="calendar-month-fields">
        <select aria-label="${t('month')}">${view.months.map((name, index) =>
          `<option value="${index}">${name}</option>`).join('')}</select>
        <input type="number" min="1000" max="9999" step="1" aria-label="${t('year')}">
      </div>
      <button type="button" data-month-step="1" aria-label="${t('nextMonth')}" title="${t('nextMonth')}">›</button>
    </div>
    <span class="visually-hidden" id="${id}-month" aria-live="polite"></span>
    ${rangePosition ? `<span class="visually-hidden" id="${id}-range">${t('inSelectedRange')}</span>` : ''}
    <table class="calendar" aria-labelledby="${id}-month">${view.headers}
      <tbody></tbody>
    </table>`)

  const calendar = container.querySelector('table')
  const body = calendar.querySelector('tbody')
  const monthTitle = container.querySelector('[aria-live]')
  const previous = container.querySelector('[data-month-step="-1"]')
  const next = container.querySelector('[data-month-step="1"]')
  const monthInput = container.querySelector('select')
  const yearInput = container.querySelector('input')

  function showSelection() {
    const active = calendarIso(cursor)
    for (const button of body.querySelectorAll('button')) {
      const date = button.dataset.date
      button.setAttribute('aria-pressed', selected(date))
      button.tabIndex = date === active ? 0 : -1
      if (rangePosition) {
        const position = rangePosition(date)
        button.classList.toggle('calendar-in-range', Boolean(position))
        button.classList.toggle('calendar-range-edge', position === 'edge')
        if (position) button.setAttribute('aria-describedby', `${id}-range`)
        else button.removeAttribute('aria-describedby')
      }
    }
  }

  function showMonth() {
    const year = cursor.getUTCFullYear()
    const month = cursor.getUTCMonth()
    const start = new Date(Date.UTC(year, month, 1))
    body.innerHTML = view.rows(year, month)
    monthTitle.textContent = view.monthLabel(start)
    monthInput.value = month
    yearInput.value = year
    previous.disabled = +start === firstCalendarDate
    next.disabled = year === 9999 && month === 11
    showSelection()
  }

  const moveMonth = step => changeCalendarMonth(cursor, cursor.getUTCFullYear(), cursor.getUTCMonth() + step)
  const focusDay = () => body.querySelector('[tabindex="0"]').focus()

  container.addEventListener('click', event => {
    const button = event.target.closest('button')
    if (!button) return
    const { date, monthStep } = button.dataset
    if (monthStep) {
      cursor = moveMonth(Number(monthStep))
      showMonth()
      if (button.disabled) focusDay()
    }
    if (date) {
      cursor = new Date(date)
      choose(date)
      showSelection()
    }
  })

  calendar.addEventListener('keydown', event => {
    if (!event.target.dataset.date) return
    const date = calendarKeyDate(cursor, event, view.weekOffset)
    if (!date) return
    event.preventDefault()
    const monthChanged = calendarIso(date).slice(0, 7) !== calendarIso(cursor).slice(0, 7)
    cursor = date
    if (monthChanged) showMonth()
    else showSelection()
    focusDay()
  })

  monthInput.addEventListener('change', () => {
    cursor = changeCalendarMonth(cursor, cursor.getUTCFullYear(), Number(monthInput.value))
    showMonth()
  })
  function changeYear() {
    if (yearInput.validity.valid && yearInput.value) {
      cursor = changeCalendarMonth(cursor, yearInput.valueAsNumber, cursor.getUTCMonth())
    }
    showMonth()
  }
  yearInput.addEventListener('change', changeYear)
  yearInput.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    changeYear()
    focusDay()
  })
  showMonth()
  return { focusDay, showSelection }
}

function mountYearCalendar(container, { initial, today, language, t, dates, choose, onYearChange }) {
  const view = calendarView({ today, language, selectedDates: dates })
  const number = new Intl.NumberFormat(language)
  let cursor = boundedCalendarDate(Date.parse(initial))

  container.innerHTML = `<div class="calendar-year-toolbar">
    <div class="calendar-header">
      <button type="button" data-year-step="-1" aria-label="${t('previousYear')}" title="${t('previousYear')}">‹</button>
      <input type="number" min="1000" max="9999" step="1" aria-label="${t('year')}">
      <button type="button" data-year-step="1" aria-label="${t('nextYear')}" title="${t('nextYear')}">›</button>
    </div>
    <p class="settings-date-count" role="status"></p>
    </div>
    <div class="calendar-year-months"></div>`

  const grid = container.querySelector('.calendar-year-months')
  const count = container.querySelector('.settings-date-count')
  const yearInput = container.querySelector('input')
  const previous = container.querySelector('[data-year-step="-1"]')
  const next = container.querySelector('[data-year-step="1"]')
  const year = () => cursor.getUTCFullYear()
  const activeDay = () => grid.querySelector(`[data-date="${calendarIso(cursor)}"]`)

  function showCount() {
    const prefix = calendarIso(cursor).slice(0, 4)
    let total = 0
    for (const date of dates) if (date.startsWith(prefix)) total++
    count.textContent = t('holidaysInYear').replace('{year}', prefix).replace('{count}', number.format(total))
  }

  function showYear() {
    const current = year()
    grid.innerHTML = view.months.map((name, month) => `<div class="calendar-year-month">
      <h4>${name}</h4>
      <table class="calendar" aria-label="${view.monthLabel(new Date(Date.UTC(current, month, 1)))}">
        ${view.headers}<tbody>${view.rows(current, month)}</tbody>
      </table></div>`).join('')
    yearInput.value = current
    previous.disabled = current === 1000
    next.disabled = current === 9999
    activeDay().tabIndex = 0
    showCount()
    onYearChange(current)
  }

  function moveCursor(date) {
    const changedYear = date.getUTCFullYear() !== year()
    activeDay().tabIndex = -1
    cursor = date
    if (changedYear) showYear()
    activeDay().tabIndex = 0
  }

  function setYear(value) {
    moveCursor(changeCalendarMonth(cursor, value, cursor.getUTCMonth()))
    yearInput.value = year()
  }

  container.addEventListener('click', event => {
    const button = event.target.closest('button')
    if (!button) return
    const { date, yearStep } = button.dataset
    if (yearStep) {
      setYear(year() + Number(yearStep))
      if (button.disabled) (yearStep === '-1' ? next : previous).focus()
    }
    if (date) {
      moveCursor(new Date(date))
      choose(date)
      button.setAttribute('aria-pressed', dates.has(date))
      showCount()
    }
  })

  grid.addEventListener('keydown', event => {
    if (!event.target.dataset.date) return
    const date = calendarKeyDate(cursor, event, view.weekOffset)
    if (!date) return
    event.preventDefault()
    moveCursor(date)
    activeDay().focus()
  })
  const readYear = () => setYear(yearInput.validity.valid && yearInput.value ? yearInput.valueAsNumber : year())
  yearInput.addEventListener('change', readYear)
  yearInput.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    readYear()
    activeDay().focus()
  })
  showYear()

  return {
    showDate(date) {
      const focused = grid.contains(document.activeElement)
      cursor = boundedCalendarDate(Date.parse(date))
      showYear()
      if (focused) activeDay().focus()
    },
  }
}

function openDatePicker({ title, dates, language, t, today, holidays, describeRange, onApply }) {
  const picker = document.querySelector('#date-picker')
  const dateLabel = dateFormatter(language, 'medium')
  const number = new Intl.NumberFormat(language)
  const [start, end] = dates
  const values = { start, end }

  const legend = holidays?.size ? `<p class="calendar-legend">${t('publicHoliday')}</p>` : ''
  picker.innerHTML = `<form class="dialog-content" method="dialog" novalidate>
    <div class="calendar-title"><h2 id="date-picker-title">${title}</h2>${legend}</div>
    <div class="calendar-pair">${['start', 'end'].map(key => `
      <section data-calendar="${key}" aria-labelledby="calendar-${key}-label">
      <h3 id="calendar-${key}-label">${t(key)}</h3><p data-endpoint="${key}"></p>
      </section>`).join('')}</div>
    <div role="status" class="calendar-feedback">
      ${describeRange ? `<dl class="calendar-summary" hidden>
        <div><dt>${t('vacationDaysToDeduct')}</dt><dd data-range-days></dd></div>
        <div><dt>${t('remainingAfterVacation')}</dt><dd><span data-range-remaining></span><small data-range-period></small></dd></div>
      </dl>` : ''}
      <p class="calendar-message"></p>
    </div>
    <div class="actions dialog-actions">
      <button type="button" value="cancel">${t('cancel')}</button>
      <button type="submit" class="primary">${t('applyDates')}</button>
    </div></form>`

  const form = picker.querySelector('form')
  const status = form.querySelector('.calendar-message')
  const apply = form.querySelector('[type="submit"]')
  const details = form.querySelector('.calendar-summary')
  const days = form.querySelector('[data-range-days]')
  const remaining = form.querySelector('[data-range-remaining]')
  const period = form.querySelector('[data-range-period]')

  function showSummary() {
    for (const key of ['start', 'end']) {
      form.querySelector(`[data-endpoint="${key}"]`).textContent = values[key] ? dateLabel(new Date(values[key])) : t('none')
    }
    const invalid = Boolean(values.start && values.end && values.start > values.end)
    let summary = invalid ? t('invalidRange') : !values.start ? t('selectRangeStart') : !values.end ? t('selectRangeEnd') : ''
    apply.disabled = invalid || !values.start || !values.end
    const description = apply.disabled ? undefined : describeRange?.(values.start, values.end)
    if (details) {
      details.hidden = description?.days === undefined
      if (!details.hidden) {
        days.textContent = number.format(description.days)
        const balance = description.remaining
        remaining.textContent = balance === undefined ? t('none') : balance === null ? t('unlimited') : number.format(balance)
        remaining.classList.toggle('over', balance < 0)
        period.textContent = description.period
      }
    }
    if (description?.message) summary = t(description.message)
    status.classList.toggle('error', invalid || Boolean(description?.exceedsAllowance))
    if (status.textContent !== summary) status.textContent = summary
  }

  function rangePosition(date) {
    if (!values.start || !values.end || date < values.start || date > values.end) return
    return date === values.start || date === values.end ? 'edge' : 'inside'
  }

  const shared = { today, language, t, holidays, rangePosition }
  const calendars = ['start', 'end'].map((key, index) => mountCalendar(form.querySelector(`[data-calendar="${key}"]`), {
    ...shared, id: 'calendar-' + key, initial: values[key] || start || today,
    selected: date => values[key] === date,
    choose(date) {
      values[key] = date
      showSummary()
      calendars[1 - index].showSelection()
    },
  }))
  form.querySelector('[value="cancel"]').addEventListener('click', () => picker.close())
  form.addEventListener('submit', event => {
    event.preventDefault()
    if (apply.disabled) return
    picker.close()
    onApply([values.start, values.end])
  })

  showSummary()
  picker.showModal()
  calendars[0].focusDay()
}
