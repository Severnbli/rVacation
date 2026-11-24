const { app, BrowserWindow, dialog, ipcMain, safeStorage } = require('electron')
const { autoUpdater } = require('electron-updater')
const fs = require('node:fs/promises')
const path = require('node:path')
const Papa = require('papaparse')
const { readSheet } = require('read-excel-file/node')

let window
let configuration = { url: '', key: '' }
let updateState = 'idle'
const entry = path.join(__dirname, 'index.html')

function secureStorage() {
  return safeStorage.isEncryptionAvailable() &&
    (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text')
}

function configurationFile() {
  return path.join(app.getPath('userData'), 'connection.json')
}

async function loadConfiguration() {
  try {
    const saved = JSON.parse(await fs.readFile(configurationFile(), 'utf8'))
    configuration.url = saved.url
    if (saved.key && secureStorage()) {
      configuration.key = safeStorage.decryptString(Buffer.from(saved.key, 'base64'))
    }
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Unable to read connection settings.')
  }
}

async function request(connection, change) {
  if (!connection.url || !connection.key) return { error: 'connectionRequired' }
  try {
    const response = await fetch(connection.url + '/v1/records', {
      method: change ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + connection.key, 'Content-Type': 'application/json' },
      body: change ? JSON.stringify(change) : undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(12000),
    })
    if (response.status === 401) return { error: 'unauthorized' }
    const data = await response.json()
    if (!response.ok) return { error: typeof data?.error === 'string' ? data.error : 'connectionFailed' }
    if (!Number.isSafeInteger(data?.revision) || !Array.isArray(data.balances) || !data.records?.settings ||
      !['workers', 'groups', 'periods', 'vacations'].every(field => Array.isArray(data.records[field]))) {
      return { error: 'connectionFailed' }
    }
    return data
  } catch {
    return { error: 'connectionFailed' }
  }
}

function getConnection() {
  return { url: configuration.url, hasKey: Boolean(configuration.key), stored: secureStorage() }
}

async function connect(value) {
  let address
  try {
    address = new URL(value.url.trim())
  } catch {
    return { error: 'invalidServer' }
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(address.hostname)
  if ((address.protocol !== 'https:' && !(local && address.protocol === 'http:')) ||
    address.username || address.password || address.search || address.hash) return { error: 'invalidServer' }
  const url = address.href.replace(/\/$/, '')
  const next = { url, key: value.key.trim() || (url === configuration.url ? configuration.key : '') }
  const data = await request(next)
  if (data.error) return data
  const saved = { url: next.url }
  if (secureStorage()) saved.key = safeStorage.encryptString(next.key).toString('base64')
  const temporary = configurationFile() + '.tmp'
  await fs.writeFile(temporary, JSON.stringify(saved), { mode: 0o600 })
  await fs.rename(temporary, configurationFile())
  configuration = next
  return { ...data, connection: getConnection() }
}

function firstColumn(parsed) {
  return parsed.map(row => String(row[0] ?? '').replace(/[\r\n\t]+/g, ' ').trim()).filter(Boolean)
}

async function openWorkers() {
  const result = await dialog.showOpenDialog(window, {
    properties: ['openFile'],
    filters: [{ name: 'CSV, TSV, XLSX', extensions: ['csv', 'tsv', 'xlsx'] }],
  })
  if (result.canceled) return { canceled: true }
  const file = result.filePaths[0]
  if ((await fs.stat(file)).size > 10 * 1024 * 1024) return { error: 'invalidImport' }
  if (path.extname(file).toLowerCase() === '.xlsx') {
    return { names: firstColumn(await readSheet(file)) }
  }
  const parsed = Papa.parse(await fs.readFile(file, 'utf8'), {
    delimiter: path.extname(file).toLowerCase() === '.tsv' ? '\t' : '',
    skipEmptyLines: 'greedy',
  })
  if (parsed.errors.some(error => error.type === 'Quotes')) return { error: 'invalidImport' }
  return { names: firstColumn(parsed.data) }
}

function setUpdate(state) {
  updateState = state
  if (window && !window.isDestroyed()) window.webContents.send('update:state', state)
}

async function checkUpdate() {
  if (!app.isPackaged) return setUpdate('updateUnavailable')
  if (['checking', 'downloading', 'ready'].includes(updateState)) return
  try {
    await autoUpdater.checkForUpdates()
    if (updateState === 'checking') setUpdate('updateUnavailable')
  } catch {
    setUpdate('updateFailed')
  }
}

function register(channel, handler, failure = 'serverError') {
  ipcMain.handle(channel, async (event, ...args) => {
    if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame) {
      return { error: 'invalidRequest' }
    }
    try {
      return await handler(...args)
    } catch {
      return { error: failure }
    }
  })
}

async function launch() {
  await loadConfiguration()
  window = new BrowserWindow({ width: 1280, height: 860, minWidth: 760, minHeight: 560,
    backgroundColor: '#f2f4f3', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), sandbox: true,
      contextIsolation: true, nodeIntegration: false },
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  register('connection:get', getConnection)
  register('connection:set', connect)
  register('records:get', () => request(configuration))
  register('records:change', change => request(configuration, change))
  register('workers:file', openWorkers, 'invalidImport')
  register('update:get', () => ({ state: updateState, version: app.getVersion() }))
  register('update:check', checkUpdate)
  register('update:install', () => {
    if (updateState === 'ready') autoUpdater.quitAndInstall(false, true)
  })
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.on('checking-for-update', () => setUpdate('checking'))
  autoUpdater.on('update-available', () => setUpdate('downloading'))
  autoUpdater.on('update-not-available', () => setUpdate('upToDate'))
  autoUpdater.on('update-downloaded', () => setUpdate('ready'))
  autoUpdater.on('error', () => setUpdate('updateFailed'))
  await window.loadFile(entry)
  if (app.isPackaged) void checkUpdate()
}

app.whenReady().then(launch).catch(error => {
  console.error(error)
  app.exit(1)
})
app.on('window-all-closed', () => app.quit())
