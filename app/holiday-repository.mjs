const directoryUrl = 'https://api.github.com/repos/Severnbli/rVacation/contents/holidays'

function isHolidayFile(name) {
  return typeof name === 'string' && !/[\\/]/.test(name) && /\.txt$/i.test(name)
}

function getContent(request, filePath, accept) {
  return request(`${directoryUrl}${filePath}?ref=main`, {
    headers: { accept },
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  })
}

export async function listHolidayFiles(request = fetch) {
  const response = await getContent(request, '', 'application/vnd.github+json')
  if (response.status === 404) return { files: [] }
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`)
  const entries = await response.json()
  const files = entries.filter(entry => entry.type === 'file' && isHolidayFile(entry.name))
    .map(entry => entry.name).sort()
  return { files }
}

export async function readHolidayFile(name, request = fetch) {
  if (!isHolidayFile(name)) return { error: 'invalidRequest' }
  const response = await getContent(request, `/${encodeURIComponent(name)}`, 'application/vnd.github.raw+json')
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`)
  return { text: await response.text() }
}
