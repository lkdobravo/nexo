import {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  Menu,
  nativeImage,
  session,
  shell,
  Tray,
  protocol,
  net,
} from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isDev = !app.isPackaged
const PRODUCTION_ORIGIN = 'https://nexo.nexo-app.workers.dev'

/** @type {BrowserWindow | null} */
let mainWindow = null
/** @type {Tray | null} */
let tray = null
let allowQuit = false
/** @type {string | null} */
let pendingCaptureSourceId = null
let minimizeToBackground = true

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showMainWindow()
  })
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'nexo',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      bypassCSP: true,
    },
  },
])

function log(msg) {
  try {
    const dir = path.join(app.getPath('userData'), 'logs')
    fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(path.join(dir, 'nexo.log'), `[${new Date().toISOString()}] ${msg}\n`)
  } catch {
    /* ignore */
  }
}

function showMainWindow() {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function resolveTrayIcon() {
  const candidates = [
    path.join(__dirname, 'icon.ico'),
    path.join(__dirname, '..', 'src-tauri', 'icons', 'icon.ico'),
    path.join(process.resourcesPath || '', 'icon.ico'),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const img = nativeImage.createFromPath(p)
      if (!img.isEmpty()) return img
    }
  }
  return nativeImage.createEmpty()
}

function createTray() {
  tray = new Tray(resolveTrayIcon())
  const menu = Menu.buildFromTemplate([
    { label: 'Restaurar', click: () => showMainWindow() },
    { type: 'separator' },
    {
      label: 'Sair do Nexo',
      click: () => {
        allowQuit = true
        app.quit()
      },
    },
  ])
  tray.setToolTip('Nexo')
  tray.setContextMenu(menu)
  tray.on('click', () => showMainWindow())
  tray.on('double-click', () => showMainWindow())
}

function grantMediaPermissions() {
  // Estratégia Discord/Electron: nunca mostrar diálogo "http://… wants to use"
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    const allow = new Set([
      'media',
      'microphone',
      'camera',
      'display-capture',
      'notifications',
      'mediaKeySystem',
    ])
    callback(allow.has(permission))
  })

  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    const allow = new Set(['media', 'microphone', 'camera', 'display-capture', 'notifications'])
    return allow.has(permission)
  })

  try {
    // Windows: o handler SEMPRE roda (useSystemPicker é macOS).
    // Nunca use WebFrameMain aqui — isso captura só a janela do Nexo.
    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
      const wanted = pendingCaptureSourceId
      pendingCaptureSourceId = null
      const types = wanted?.startsWith('window:')
        ? ['window', 'screen']
        : ['screen', 'window']

      desktopCapturer
        .getSources({ types, thumbnailSize: { width: 1, height: 1 } })
        .then((sources) => {
          const byId = wanted ? sources.find((s) => s.id === wanted) : null
          const screen =
            sources.find((s) => String(s.id).startsWith('screen')) ||
            sources.find((s) => /screen|display|monitor|tela/i.test(s.name))
          const chosen = byId || screen || null

          if (!chosen) {
            log('display media: no source — deny')
            callback({})
            return
          }

          log(`display media: grant ${chosen.id} (${chosen.name})`)
          // loopback = áudio do sistema no Windows (quando pedido)
          callback({
            video: chosen,
            audio: request.audioRequested ? 'loopback' : undefined,
          })
        })
        .catch((err) => {
          log(`display media resolve failed: ${err}`)
          callback({})
        })
    })
  } catch (err) {
    log(`display media handler unavailable: ${err}`)
  }
}

function registerNexoProtocol() {
  const distDir = path.join(__dirname, '..', 'dist')

  protocol.handle('nexo', async (request) => {
    try {
      const url = new URL(request.url)
      let pathname = decodeURIComponent(url.pathname)
      if (pathname === '/' || pathname === '') pathname = '/index.html'
      if (pathname.startsWith('/app')) pathname = pathname.slice(4) || '/index.html'
      pathname = pathname.replace(/^\/+/, '')

      const safePath = path.normalize(path.join(distDir, pathname))
      if (!safePath.startsWith(path.normalize(distDir))) {
        return new Response('Forbidden', { status: 403 })
      }
      const target = fs.existsSync(safePath) ? safePath : path.join(distDir, 'index.html')
      return net.fetch(pathToFileURL(target).href)
    } catch (err) {
      log(`protocol error: ${err}`)
      return new Response('Not found', { status: 404 })
    }
  })
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 600,
    title: 'Nexo',
    backgroundColor: '#1e1f22',
    show: false,
    frame: false,
    fullscreenable: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  })

  mainWindow.once('ready-to-show', () => {
    const startHidden = process.argv.includes('--autostart')
    if (startHidden) mainWindow.hide()
    else {
      mainWindow.show()
      mainWindow.focus()
    }
  })

  mainWindow.on('minimize', (e) => {
    if (!minimizeToBackground) return
    e.preventDefault()
    mainWindow.hide()
  })

  mainWindow.on('close', (e) => {
    if (!allowQuit) {
      e.preventDefault()
      mainWindow.hide()
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // Só permite o hub Nexo / localhost (não vira navegador genérico)
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const ok =
      url.startsWith(PRODUCTION_ORIGIN) ||
      url.startsWith('nexo://') ||
      url.startsWith('http://localhost') ||
      url.startsWith('http://127.0.0.1')
    if (!ok) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })

  if (isDev) {
    await mainWindow.loadURL('http://localhost:5173')
  } else {
    // Igual Discord: UI vem do servidor → cada deploy atualiza todos os apps
    await mainWindow.loadURL(PRODUCTION_ORIGIN)
  }

  log('window created')
}

function wireIpc() {
  ipcMain.handle('window:minimize', () => {
    if (!mainWindow) return
    if (minimizeToBackground) {
      mainWindow.hide()
      return
    }
    mainWindow.minimize()
  })
  ipcMain.handle('window:toggleMaximize', () => {
    if (!mainWindow) return false
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
    return mainWindow.isMaximized()
  })
  ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false)
  ipcMain.handle('window:close', () => {
    mainWindow?.hide()
  })
  ipcMain.handle('window:hide', () => mainWindow?.hide())
  ipcMain.handle('window:show', () => showMainWindow())
  ipcMain.handle('window:set-fullscreen', (_e, enabled) => {
    if (!mainWindow) return
    mainWindow.setFullScreen(Boolean(enabled))
  })
  ipcMain.handle('app:quit', () => {
    allowQuit = true
    app.quit()
  })
  ipcMain.handle('app:apply-update', async () => {
    log('apply-update: reloading from production')
    if (!mainWindow) return
    await session.defaultSession.clearCache()
    mainWindow.webContents.reloadIgnoringCache()
  })
  ipcMain.handle('app:download-install-update', async (_e, payload) => {
    const url = typeof payload?.url === 'string' ? payload.url : ''
    if (!url.startsWith('https://')) throw new Error('URL de atualização inválida')
    log(`download-install: ${url}`)
    const dest = path.join(app.getPath('temp'), `Nexo-Setup-update-${Date.now()}.exe`)
    const res = await net.fetch(url)
    if (!res.ok) throw new Error(`Download falhou (${res.status})`)
    const body = res.body
    if (!body) throw new Error('Resposta vazia no download')
    await pipeline(Readable.fromWeb(body), createWriteStream(dest))
    log(`installer saved: ${dest}`)
    // NSIS: /S = silencioso; app reinicia após instalar
    const child = spawn(dest, ['/S'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.unref()
    allowQuit = true
    setTimeout(() => app.quit(), 800)
  })
  ipcMain.handle('autostart:get', () => app.getLoginItemSettings().openAtLogin)
  ipcMain.handle('autostart:set', (_e, enabled) => {
    app.setLoginItemSettings({
      openAtLogin: Boolean(enabled),
      openAsHidden: true,
      args: ['--autostart'],
    })
    return app.getLoginItemSettings().openAtLogin
  })
  ipcMain.handle('desktop:get-minimize-bg', () => minimizeToBackground)
  ipcMain.handle('desktop:set-minimize-bg', (_e, enabled) => {
    minimizeToBackground = Boolean(enabled)
    return minimizeToBackground
  })
  ipcMain.handle('desktop:info', () => ({
    engine: 'electron',
    version: app.getVersion(),
    hub: PRODUCTION_ORIGIN,
  }))
  ipcMain.handle('desktop:list-capture-sources', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 360, height: 220 },
      fetchWindowIcons: true,
    })
    const isScreen = (id, name) =>
      String(id).startsWith('screen') || /entire (screen|display)|screen \d|display \d|monitor/i.test(name)

    return sources
      .filter((s) => {
        if (!s.name?.trim()) return false
        // Não listar a própria janela do app na aba Janela
        if (!isScreen(s.id, s.name) && /^nexo$/i.test(s.name.trim())) return false
        return true
      })
      .map((s) => {
        const screen = isScreen(s.id, s.name)
        return {
          id: s.id,
          name: screen ? (s.name.match(/screen|display|monitor|tela/i) ? s.name : `Tela cheia — ${s.name}`) : s.name,
          type: screen ? 'screen' : 'window',
          thumbnail: s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL(),
          appIcon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
        }
      })
  })
  ipcMain.handle('desktop:prepare-capture', (_e, sourceId) => {
    pendingCaptureSourceId = typeof sourceId === 'string' && sourceId.length > 0 ? sourceId : null
    log(`prepare-capture: ${pendingCaptureSourceId || '(none)'}`)
    return Boolean(pendingCaptureSourceId)
  })
}

app.whenReady().then(async () => {
  grantMediaPermissions()
  if (!isDev) registerNexoProtocol()
  wireIpc()
  createTray()
  await createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && allowQuit) app.quit()
})

app.on('activate', () => {
  showMainWindow()
})

app.on('before-quit', () => {
  allowQuit = true
})
