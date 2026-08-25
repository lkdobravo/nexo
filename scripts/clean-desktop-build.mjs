/**
 * Limpa artefatos de build do desktop em %USERPROFILE%\.nexo-build
 * — sem isso, cada Nexo-Setup / Portable / win-unpacked acumula ~200MB+.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const pkg = require('../package.json')
const root = path.join(os.homedir(), '.nexo-build')
const dist = path.join(root, 'electron-dist')
const tauriTarget = path.join(root, 'target')
const version = String(pkg.version || '0.0.0')

function rm(p) {
  try {
    if (!fs.existsSync(p)) return false
    fs.rmSync(p, { recursive: true, force: true, maxRetries: 3 })
    console.log(`[nexo] removido: ${p}`)
    return true
  } catch (err) {
    console.warn(`[nexo] não removeu ${p}: ${err.message}`)
    return false
  }
}

function bytes(p) {
  if (!fs.existsSync(p)) return 0
  const st = fs.statSync(p)
  if (st.isFile()) return st.size
  let total = 0
  for (const name of fs.readdirSync(p)) {
    total += bytes(path.join(p, name))
  }
  return total
}

const before = bytes(root)

// Rust/Tauri antigo (não usamos mais no desktop)
rm(tauriTarget)

if (fs.existsSync(dist)) {
  // Pasta intermediária — o electron-builder recria
  rm(path.join(dist, 'win-unpacked'))
  rm(path.join(dist, 'builder-debug.yml'))
  rm(path.join(dist, 'builder-effective-config.yaml'))

  for (const name of fs.readdirSync(dist)) {
    const full = path.join(dist, name)
    // Só mantém o instalador da versão atual (não geramos mais Portable)
    const keep =
      name === `Nexo-Setup-${version}.exe` || name === `Nexo-Setup-${version}.exe.blockmap`
    if (keep) continue
    if (
      /^Nexo-(Setup|Portable)-/i.test(name) ||
      name.endsWith('.blockmap') ||
      name.endsWith('.nsis.7z')
    ) {
      rm(full)
    }
  }
}

const after = bytes(root)
const freed = Math.max(0, before - after)
console.log(
  `[nexo] limpeza ok — liberados ~${(freed / (1024 * 1024)).toFixed(0)} MB (resta ~${(after / (1024 * 1024)).toFixed(0)} MB em .nexo-build)`,
)
