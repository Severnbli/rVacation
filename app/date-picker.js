function openDatePicker({ title, dates, language, t, today, onApply }) {
  const picker = document.querySelector('#date-picker')
  const day = 86400000
  const firstDate = Date.UTC(1000, 0, 1)
  const lastDate = Date.UTC(9999, 11, 31)
  const iso = date => date.toISOString().slice(0, 10)
  const boundedDate = time => new Date(Math.min(lastDate, Math.max(firstDate, time)))
  const weekStart = new Intl.Locale(language).getWeekInfo().firstDay % 7
  const weekday = dateFormatter(language, 'weekday')
  const monthLabel = dateFormatter(language, 'month')
  const dateLabel = dateFormatter(language, 'full')
  const number = new Intl.NumberFormat(language)
  const selected = new Set(dates)
  const sorted = [...selected].sort()
  let cursor = boundedDate(Date.parse(sorted.find(date => date >= today) ?? sorted.at(-1) ?? today))
  let rangeStart

  picker.innerHTML = `<form class="dialog-content" method="dialog">
    <h2 id="date-picker-title">${title}</h2>
    <div class="calendar-header">
      <button type="button" data-month-step="-1" aria-label="${t('previousMonth')}" title="${t('previousMonth')}">‹</button>
      <strong id="calendar-month" aria-live="polite"></strong>
      <button type="button" data-month-step="1" aria-label="${t('nextMonth')}" title="${t('nextMonth')}">›</button>
    </div>
    <table class="calendar" aria-labelledby="calendar-month">
      <thead><tr>${Array.from({ length: 7 }, (_, index) => {
        const date = new Date(Date.UTC(2024, 0, 7 + weekStart + index))
        return `<th scope="col">${weekday(date)}</th>`
      }).join('')}</tr></thead>
      <tbody></tbody>
    </table>
    <div class="calendar-options">
      <label class="check"><input name="range" type="checkbox">${t('selectDateRange')}</label>
      <p role="status"></p>
    </div>
    <div class="actions dialog-actions">
      <button value="cancel">${t('cancel')}</button>
      <button value="apply" class="primary">${t('applyDates')}</button>
    </div>
    </form>`

  const form = picker.querySelector('form')
  const calendar = form.querySelector('table')
  const body = calendar.querySelector('tbody')
  const monthTitle = form.querySelector('#calendar-month')
  const previous = form.querySelector('[data-month-step="-1"]')
  const next = form.querySelector('[data-month-step="1"]')
  const range = form.elements.range
  const status = form.querySelector('[role="status"]')
  const apply = form.querySelector('[value="apply"]')
  const weekOffset = date => (date.getUTCDay() - weekStart + 7) % 7

  function showSelection() {
    const active = iso(cursor)
    for (const button of body.querySelectorAll('button')) {
      const date = button.dataset.date
      button.setAttribute('aria-pressed', selected.has(date))
      button.classList.toggle('calendar-range-start', date === rangeStart)
      button.tabIndex = date === active ? 0 : -1
    }
    const count = `${t('selectedDates')} (${number.format(selected.size)})`
    const summary = range.checked ? `${count} · ${t(rangeStart ? 'selectRangeEnd' : 'selectRangeStart')}` : count
    if (status.textContent !== summary) status.textContent = summary
    apply.disabled = Boolean(rangeStart)
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
      return `<td><button type="button" data-date="${value}" aria-label="${dateLabel(date)}"
        ${value === today ? 'aria-current="date"' : ''}>${number.format(dayOfMonth)}</button></td>`
    }).join('')}</tr>`).join('')
    monthTitle.textContent = monthLabel(start)
    previous.disabled = +start === firstDate
    next.disabled = year === 9999 && month === 11
    showSelection()
  }

  function moveMonth(step) {
    const year = cursor.getUTCFullYear()
    const month = cursor.getUTCMonth() + step
    const length = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
    return boundedDate(Date.UTC(year, month, Math.min(cursor.getUTCDate(), length)))
  }

  function focusDay() {
    body.querySelector('[tabindex="0"]').focus()
  }

  form.addEventListener('click', event => {
    const button = event.target.closest('button')
    if (!button) return
    const { date, monthStep } = button.dataset
    if (monthStep) {
      cursor = moveMonth(Number(monthStep))
      showMonth()
      if (button.disabled) focusDay()
    }
    if (!date) return
    cursor = new Date(date)
    if (range.checked) {
      if (rangeStart) {
        const endpoints = [rangeStart, date].sort()
        const end = Date.parse(endpoints[1])
        for (let time = Date.parse(endpoints[0]); time <= end; time += day) {
          selected.add(iso(new Date(time)))
        }
        rangeStart = undefined
        range.checked = false
      } else {
        rangeStart = date
      }
    } else if (!selected.delete(date)) {
      selected.add(date)
    }
    showSelection()
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

  range.addEventListener('change', () => {
    rangeStart = undefined
    showSelection()
  })
  form.addEventListener('submit', event => {
    event.preventDefault()
    picker.close()
    if (event.submitter?.value === 'apply') onApply([...selected].sort())
  })

  showMonth()
  picker.showModal()
  focusDay()
}
