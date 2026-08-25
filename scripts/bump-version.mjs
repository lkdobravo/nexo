import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const build = Date.now()
const origin = 'https://nexo.nexo-app.workers.dev'
const installerName = `Nexo-Setup-${pkg.version}.exe`

/** Mantém URL/available do publish anterior se a versão do desktop não mudou. */
function resolveDesktop() {
  const fallback = {
    version: pkg.version,
    installer: installerName,
    url: '',
    available: false,
  }
  try {
    const prevPath = path.join(root, 'public', 'version.json')
    if (!existsSync(prevPath)) return fallback
    const prev = JSON.parse(readFileSync(prevPath, 'utf8'))
    const d = prev.desktop
    if (d?.version === pkg.version && d.available === true && typeof d.url === 'string' && d.url) {
      return {
        version: pkg.version,
        installer: d.installer || installerName,
        url: d.url,
        available: true,
      }
    }
  } catch {
    /* */
  }
  // URL opcional via env (GitHub Releases, CDN, etc.) sem precisar republish do script
  const envUrl = (process.env.NEXO_INSTALLER_URL || '').trim()
  if (envUrl) {
    return {
      version: pkg.version,
      installer: installerName,
      url: envUrl,
      available: true,
    }
  }
  return {
    ...fallback,
    // Placeholder legado (R2) — available fica false até publish confirmar
    url: `${origin}/releases/${installerName}`,
  }
}

const versionInfo = {
  version: pkg.version,
  build,
  deployedAt: new Date().toISOString(),
  desktop: resolveDesktop(),
}

writeFileSync(path.join(root, 'public', 'version.json'), `${JSON.stringify(versionInfo, null, 2)}\n`)

const tauriConfPath = path.join(root, 'src-tauri', 'tauri.conf.json')
try {
  const conf = JSON.parse(readFileSync(tauriConfPath, 'utf8'))
  conf.version = pkg.version
  writeFileSync(tauriConfPath, `${JSON.stringify(conf, null, 2)}\n`)
} catch {
  /* */
}

console.log(`[nexo] version.json → v${pkg.version} (build ${build})`)
if (versionInfo.desktop.available) {
  console.log(`[nexo] instalador publicado: ${versionInfo.desktop.url}`)
} else {
  console.log('[nexo] instalador ainda não hospedado (UI atualiza pelo hub; rode npm run desktop:publish para casca)')
}
