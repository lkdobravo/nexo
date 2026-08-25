import { NexoHub } from './hub'

export { NexoHub }

export interface Env {
  ASSETS: Fetcher
  NEXO_HUB: DurableObjectNamespace<NexoHub>
  /** Opcional até ativar R2 no painel Cloudflare. */
  RELEASES?: R2Bucket
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const upgrade = request.headers.get('Upgrade')?.toLowerCase()
    if (upgrade === 'websocket' || url.pathname === '/ws') {
      const stub = env.NEXO_HUB.getByName('main')
      return stub.fetch(request)
    }

    // Instaladores desktop (R2) — popup “Baixar e instalar”
    if (url.pathname.startsWith('/releases/')) {
      if (!env.RELEASES) {
        return new Response(
          'Releases ainda não configurados. Ative o R2 no Cloudflare e rode npm run desktop:publish.',
          { status: 503 },
        )
      }
      const key = decodeURIComponent(url.pathname.slice('/releases/'.length)).replace(/^\/+/, '')
      if (!key || key.includes('..')) {
        return new Response('Not found', { status: 404 })
      }
      const obj = await env.RELEASES.get(key)
      if (!obj) return new Response('Installer not found', { status: 404 })
      const headers = new Headers()
      obj.writeHttpMetadata(headers)
      headers.set('etag', obj.httpEtag)
      headers.set('Cache-Control', 'public, max-age=300')
      if (key.endsWith('.exe')) {
        headers.set('Content-Type', 'application/octet-stream')
        headers.set('Content-Disposition', `attachment; filename="${key.split('/').pop()}"`)
      }
      return new Response(obj.body, { headers })
    }

    const response = await env.ASSETS.fetch(request)
    if (url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/version.json') {
      const headers = new Headers(response.headers)
      headers.set('Cache-Control', 'no-cache, no-store, must-revalidate')
      return new Response(response.body, { status: response.status, headers })
    }
    return response
  },
}
