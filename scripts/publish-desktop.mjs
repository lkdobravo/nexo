/**
 * Publica o instalador desktop e atualiza version.json.
 *
 * Ordem (estilo Discord — hospedar o .exe em qualquer CDN):
 * 1. GitHub Releases — se existir `repository` no package.json e `gh` autenticado
 *    (ou NEXO_GITHUB_REPO=owner/repo)
 * 2. Cloudflare R2 — se R2 estiver ativo + r2_buckets no wrangler.jsonc
 * 3. NEXO_INSTALLER_URL — URL já hospedada por você (qualquer CDN)
 *
 * Sem host: available=false. A UI continua atualizando pelo hub (não precisa de .exe).
 *
 * Uso:
 *   npm run desktop:build
 *   npm run desktop:publish
 */
import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync, execSync } from 'node:child_process'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const installerName = `Nexo-Setup-${pkg.version}.exe`
const installerPath = path.join(os.homedir(), '.nexo-build', 'electron-dist', installerName)
const tag = `v${pkg.version}`
const origin = 'https://nexo.nexo-app.workers.dev'
const r2Bucket = 'nexo-releases'

if (!existsSync(installerPath)) {
  console.error(`[nexo] instalador não encontrado: ${installerPath}`)
  console.error('[nexo] rode antes: npm run desktop:build')
  process.exit(1)
}

const localReleases = path.join(root, 'releases')
mkdirSync(localReleases, { recursive: true })
copyFileSync(installerPath, path.join(localReleases, installerName))
console.log(`[nexo] cópia local: releases/${installerName}`)

function hasGh() {
  try {
    execSync('gh --version', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function resolveGithubRepo() {
  const env = (process.env.NEXO_GITHUB_REPO || '').trim()
  if (env) return env
  const repo = pkg.repository
  if (typeof repo === 'string') {
    const m = repo.match(/github\.com[/:]([^/]+\/[^/.]+)/i)
    return m ? m[1].replace(/\.git$/i, '') : ''
  }
  if (repo && typeof repo === 'object' && typeof repo.url === 'string') {
    const m = repo.url.match(/github\.com[/:]([^/]+\/[^/.]+)/i)
    return m ? m[1].replace(/\.git$/i, '') : ''
  }
  return ''
}

/** @returns {{ url: string, via: string } | null} */
function tryGithub() {
  const repo = resolveGithubRepo()
  if (!repo) {
    console.log('[nexo] GitHub: sem repository no package.json (opcional: NEXO_GITHUB_REPO=owner/repo)')
    return null
  }
  if (!hasGh()) {
    console.log('[nexo] GitHub: instale o GitHub CLI (gh) e faça gh auth login')
    return null
  }
  try {
    // Cria release se não existir; ignora se já existir
    try {
      execFileSync(
        'gh',
        ['release', 'view', tag, '--repo', repo],
        { cwd: root, stdio: 'ignore', shell: true },
      )
    } catch {
      execFileSync(
        'gh',
        ['release', 'create', tag, '--repo', repo, '--title', `Nexo ${tag}`, '--notes', `Instalador desktop ${tag}`],
        { cwd: root, stdio: 'inherit', shell: true },
      )
    }
    execFileSync(
      'gh',
      ['release', 'upload', tag, installerPath, '--repo', repo, '--clobber'],
      { cwd: root, stdio: 'inherit', shell: true },
    )
    const url = `https://github.com/${repo}/releases/download/${tag}/${installerName}`
    console.log(`[nexo] GitHub Releases OK → ${url}`)
    return { url, via: 'github' }
  } catch (err) {
    console.warn('[nexo] GitHub Releases falhou:', err instanceof Error ? err.message : err)
    return null
  }
}

/** @returns {{ url: string, via: string } | null} */
function tryR2() {
  try {
    try {
      execFileSync('npx', ['wrangler', 'r2', 'bucket', 'create', r2Bucket], {
        cwd: root,
        stdio: 'ignore',
        shell: true,
      })
    } catch {
      /* já existe ou R2 off */
    }
    execFileSync(
      'npx',
      ['wrangler', 'r2', 'object', 'put', `${r2Bucket}/${installerName}`, '--file', installerPath, '--remote'],
      { cwd: root, stdio: 'inherit', shell: true },
    )
    const url = `${origin}/releases/${installerName}`
    console.log(`[nexo] R2 OK → ${url}`)
    console.log('[nexo] Lembrete: wrangler.jsonc precisa do binding RELEASES (veja wrangler.r2.snippet.jsonc)')
    return { url, via: 'r2' }
  } catch {
    console.warn('[nexo] R2 indisponível (opcional).')
    return null
  }
}

function tryEnvUrl() {
  const url = (process.env.NEXO_INSTALLER_URL || '').trim()
  if (!url) return null
  console.log(`[nexo] Usando NEXO_INSTALLER_URL → ${url}`)
  return { url, via: 'env' }
}

const hosted = tryEnvUrl() || tryGithub() || tryR2()

const versionInfo = {
  version: pkg.version,
  build: Date.now(),
  deployedAt: new Date().toISOString(),
  desktop: {
    version: pkg.version,
    installer: installerName,
    url: hosted?.url || `${origin}/releases/${installerName}`,
    available: Boolean(hosted),
  },
}

writeFileSync(path.join(root, 'public', 'version.json'), `${JSON.stringify(versionInfo, null, 2)}\n`)
if (existsSync(path.join(root, 'dist'))) {
  writeFileSync(path.join(root, 'dist', 'version.json'), `${JSON.stringify(versionInfo, null, 2)}\n`)
}

console.log('[nexo] publicando hub (version.json)…')
try {
  execFileSync('npx', ['wrangler', 'deploy'], { cwd: root, stdio: 'inherit', shell: true })
} catch {
  console.warn('[nexo] deploy falhou — rode: npm run deploy')
}

if (hosted) {
  console.log(`[nexo] OK — casca disponível via ${hosted.via}: ${hosted.url}`)
} else {
  console.log('')
  console.log('[nexo] Instalador NÃO hospedado — modo Discord ativo:')
  console.log('  • UI atualiza sozinha com npm run deploy (sem popup de Setup)')
  console.log('  • Para “Baixar e instalar” automático, escolha UMA opção:')
  console.log('    A) GitHub: package.json → "repository": "github.com/voce/nexo" + gh auth login')
  console.log('    B) R2: ativar no painel Cloudflare + wrangler.r2.snippet.jsonc')
  console.log('    C) CDN próprio: set NEXO_INSTALLER_URL=https://.../Nexo-Setup-x.y.z.exe')
  console.log(`  • Enquanto isso, envie releases/${installerName} manualmente aos amigos.`)
  console.log('')
}
