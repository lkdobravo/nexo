/**
 * Prepara public/sounds a partir do pack discord-sounds-mod.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const outDir = path.join(root, 'public', 'sounds')
fs.mkdirSync(outDir, { recursive: true })

const candidates = [
  path.join(root, 'discord-sounds-mod', 'sounds'),
  path.join(root, 'discord-sounds-mod'),
  path.join(os.homedir(), 'Desktop', 'discord-sounds-mod', 'sounds'),
  path.join(os.homedir(), 'Desktop', 'discord-sounds-mod'),
  path.join('C:', 'Program Files', 'Nexo', 'discord-sounds-mod', 'discord-sounds-mod', 'sounds'),
  path.join('C:', 'Program Files', 'Nexo', 'discord-sounds-mod', 'sounds'),
]

const rarPath = path.join(os.homedir(), 'Desktop', 'discord-sounds-mod.rar')
const unrar = path.join('C:', 'Program Files', 'WinRAR', 'UnRAR.exe')

function copyMp3s(fromDir) {
  let n = 0
  if (!fs.existsSync(fromDir)) return 0
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name)
      const st = fs.statSync(full)
      if (st.isDirectory()) {
        if (name === 'node_modules') continue
        walk(full)
      } else if (/\.(mp3|ogg|wav|m4a)$/i.test(name)) {
        fs.copyFileSync(full, path.join(outDir, name.toLowerCase()))
        n++
      }
    }
  }
  walk(fromDir)
  return n
}

let copied = 0
for (const dir of candidates) {
  copied = copyMp3s(dir)
  if (copied) {
    console.log(`[nexo] sons: ${copied} arquivos de ${dir}`)
    break
  }
}

if (!copied && fs.existsSync(rarPath) && fs.existsSync(unrar)) {
  const tmp = path.join(root, '_sounds_extract')
  fs.rmSync(tmp, { recursive: true, force: true })
  fs.mkdirSync(tmp, { recursive: true })
  try {
    execFileSync(unrar, ['x', '-y', rarPath, `${tmp}\\`], { stdio: 'inherit' })
    copied = copyMp3s(tmp)
    console.log(`[nexo] sons: ${copied} arquivos extraídos de ${rarPath}`)
  } catch (err) {
    console.warn(`[nexo] falha ao extrair RAR: ${err.message}`)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

if (!copied) {
  console.log('[nexo] nenhum pack de sons encontrado — mantendo public/sounds atual')
}

fs.writeFileSync(
  path.join(outDir, 'manifest.json'),
  `${JSON.stringify(
    {
      source: copied ? 'discord-sounds-mod' : 'existing',
      files: fs.readdirSync(outDir).filter((f) => !['manifest.json', 'README.md'].includes(f)),
    },
    null,
    2,
  )}\n`,
)
