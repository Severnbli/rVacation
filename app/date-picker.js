function mountCalendar(container, { initial, today, language, t, id, selected, choose, holidays, markedDates, rangePosition }) {
  const day = 86400000
  const firstDate = Date.UTC(1000, 0, 1)
  const lastDate = Date.UTC(9999, 11, 31)
  const iso = date => date.toISOString().slice(0, 10)
  const boundedDate = time => new Date(Math.min(lastDate, Math.max(firstDate, time)))
  const weekStart = new Intl.Locale(language).getWeekInfo().firstDay % 7
  const weekday = dateFormatter(language, 'weekday')
  const monthName = dateFormatter(language, 'monthName')
  const months = Array.from({ length: 12 }, (_, index) => monthName(new Date(Date.UTC(2024, index, 1))))
  const monthLabel = dateFormatter(language, 'month')
  const dateLabel = dateFormatter(language, 'full')
  const number = new Intl.NumberFormat(language)
  let cursor = boundedDate(Date.parse(initial))

  container.insertAdjacentHTML('beforeend', `<div class="calendar-header">
      <button type="button" data-month-step="-1" aria-label="${t('previousMonth')}" title="${t('previousMonth')}">‹</button>
      <div class="calendar-month-fields">
        <select aria-label="${t('month')}">${months.map((name, index) =>
          `<option value="${index}">${name}</option>`).join('')}</select>
        <input type="number" min="1000" max="9999" step="1" aria-label="${t('year')}">
      </div>
      <button type="button" data-month-step="1" aria-label="${t('nextMonth')}" title="${t('nextMonth')}">›</button>
    </div>
    <span class="visually-hidden" id="${id}-month" aria-live="polite"></span>
    ${rangePosition ? `<span class="visually-hidden" id="${id}-range">${t('inSelectedRange')}</span>` : ''}
    <table class="calendar" aria-labelledby="${id}-month">
      <thead><tr>${Array.from({ length: 7 }, (_, index) =>
        `<th scope="col">${weekday(new Date(Date.UTC(2024, 0, 7 + weekStart + index)))}</th>`).join('')}</tr></thead>
      <tbody></tbody>
    </table>`)

  const calendar = container.querySelector('table')
  const body = calendar.querySelector('tbody')
  const monthTitle = container.querySelector('[aria-live]')
  const previous = container.querySelector('[data-month-step="-1"]')
  const next = container.querySelector('[data-month-step="1"]')
  const monthInput = container.querySelector('select')
  const yearInput = container.querySelector('input')
  const weekOffset = date => (date.getUTCDay() - weekStart + 7) % 7

  function showSelection() {
    const active = iso(cursor)
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

  function showMonthCounts() {
    if (!markedDates) return
    const year = iso(cursor).slice(0, 4)
    const counts = Array(12).fill(0)
    for (const date of markedDates) {
      if (date.startsWith(year)) counts[Number(date.slice(5, 7)) - 1]++
    }
    for (const [index, option] of Array.from(monthInput.options).entries()) {
      option.textContent = counts[index] ? `${months[index]} · ${number.format(counts[index])}` : months[index]
    }
  }

  function showMonth() {
    const year = cursor.getUTCFullYear()
    const month = cursor.getUTCMonth()
    const start = new Date(Date.UTC(year, month, 1))
    const offset = weekOffset(start)
    const length = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
    const rows = Math.ceil((offset + length) / 7)
    body.innerHTML = Array.from({ length: rows }, (_, row) => `<tr>${Array.from({ length: 7 }, (_, column) => {
      const dayOfMonth = row * 7 + column - offset + 1
      if (dayOfMonth < 1 || dayOfMonth > length) return '<td></td>'
      const date = new Date(Date.UTC(year, month, dayOfMonth))
      const value = iso(date)
      const holiday = holidays?.has(value)
      const label = holiday ? `${dateLabel(date)}. ${t('publicHoliday')}` : dateLabel(date)
      return `<td><button type="button" data-date="${value}" aria-label="${label}"
        ${holiday ? `class="calendar-holiday" title="${t('publicHoliday')}"` : ''}
        ${value === today ? 'aria-current="date"' : ''}>${number.format(dayOfMonth)}</button></td>`
    }).join('')}</tr>`).join('')
    monthTitle.textContent = monthLabel(start)
    monthInput.value = month
    yearInput.value = year
    previous.disabled = +start === firstDate
    next.disabled = year === 9999 && month === 11
    showMonthCounts()
    showSelection()
  }

  function monthDate(year, month) {
    const length = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
    return boundedDate(Date.UTC(year, month, Math.min(cursor.getUTCDate(), length)))
  }

  const moveMonth = step => monthDate(cursor.getUTCFullYear(), cursor.getUTCMonth() + step)
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
      showMonthCounts()
      showSelection()
    }
  })

  calendar.addEventListener('keydown', event => {
    if (!event.target.dataset.date) return
    const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7,
      Home: -weekOffset(cursor), End: 6 - weekOffset(cursor) }
    const month = iso(cursor).slice(0, 7)
    if (event.key === 'PageUp' || event.key === 'PageDown') {
      cursor = moveMonth((event.key === 'PageUp' ? -1 : 1) * (event.shiftKey ? 12 : 1))
    } else if (Object.hasOwn(offsets, event.key)) {
      cursor = boundedDate(+cursor + offsets[event.key] * day)
    } else {
      return
    }
    event.preventDefault()
    if (iso(cursor).slice(0, 7) !== month) showMonth()
    else showSelection()
    focusDay()
  })

  monthInput.addEventListener('change', () => {
    cursor = monthDate(cursor.getUTCFullYear(), Number(monthInput.value))
    showMonth()
  })
  function changeYear() {
    if (yearInput.validity.valid && yearInput.value) {
      cursor = monthDate(yearInput.valueAsNumber, cursor.getUTCMonth())
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
  return {
    focusDay,
    showSelection,
    showDate(date) {
      cursor = boundedDate(Date.parse(date))
      showMonth()
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
