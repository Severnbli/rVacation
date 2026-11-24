const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron')
const { autoUpdater } = require('electron-updater')
const { existsSync } = require('node:fs')
const fs = require('node:fs/promises')
const path = require('node:path')
const Papa = require('papaparse')
const { readSheet } = require('read-excel-file/node')
const { RecordError } = require('./domain.mjs')
const { openRecords } = require('./storage.mjs')

let window
let records
let updateState = 'idle'
const entry = path.join(__dirname, 'index.html')
const repositoryUrl = 'https://github.com/Severnbli/rVacation'

function localRecords() {
  return records ??= openRecords(path.join(app.getPath('userData'), 'rvacation.sqlite'))
}

function readRecords() {
  const snapshot = localRecords().read()
  return {
    ...snapshot,
    showLegacyImport: snapshot.revision === 0 && existsSync(path.join(app.getPath('userData'), 'connection.json')),
  }
}

async function importDatabase() {
  const result = await dialog.showOpenDialog(window, {
    properties: ['openFile'],
    filters: [{ name: 'SQLite', extensions: ['sqlite', 'sqlite3', 'db'] }, { name: '*', extensions: ['*'] }],
  })
  if (result.canceled) return { canceled: true }
  return localRecords().importLegacy(result.filePaths[0])
}

async function openDataFolder() {
  if (await shell.openPath(app.getPath('userData'))) return { error: 'dataFolderFailed' }
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

function register(channel, handler, failure = 'operationFailed') {
  ipcMain.handle(channel, async (event, ...args) => {
    if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame) {
      return { error: 'invalidRequest' }
    }
    try {
      return await handler(...args)
    } catch (error) {
      if (error instanceof RecordError) return { error: error.message }
      console.error(channel, error)
      return { error: failure }
    }
  })
}

async function launch() {
  window = new BrowserWindow({ width: 1280, height: 860, minWidth: 760, minHeight: 560,
    backgroundColor: '#f2f4f3', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), sandbox: true,
      contextIsolation: true, nodeIntegration: false },
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  register('records:get', readRecords, 'databaseOpenFailed')
  register('records:change', change => localRecords().change(change), 'databaseSaveFailed')
  register('records:import', importDatabase, 'databaseSaveFailed')
  register('records:folder', openDataFolder, 'dataFolderFailed')
  register('workers:file', openWorkers, 'invalidImport')
  register('app:repository', () => shell.openExternal(repositoryUrl))
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
  void checkUpdate()
}

if (app.requestSingleInstanceLock()) {
  app.on('second-instance', () => {
    if (!window || window.isDestroyed()) return
    if (window.isMinimized()) window.restore()
    window.focus()
  })
  app.on('window-all-closed', () => app.quit())
  app.on('will-quit', () => records?.close())
  app.whenReady().then(launch).catch(error => {
    console.error(error)
    app.exit(1)
  })
} else {
  app.quit()
}
