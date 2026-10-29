import OAuthProvider, { AuthorizationError, CimdFetchError, type ConsentDescription } from '@cloudflare/workers-oauth-provider'
import type { Hono, MiddlewareHandler } from 'hono'
import type { Bindings, Variables } from './types'
import { handleMcp, type McpIdentity } from './mcp'

const ORIGIN = 'https://classup.pages.dev'
const SCOPE = 'classup:read'
const escape = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)

function consentHtml(details: ConsentDescription, handle: string) {
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>클업 분석 연결 승인</title><link rel="stylesheet" href="/static/mcp-consent.css">
<main><p>CLASS UP · 읽기 전용 MCP</p><h1>학급 분석 연결</h1>
<p><strong>${escape(details.clientName)}</strong>에서 클업 기록을 읽도록 요청했습니다.</p>
<p>연결 대상: <strong>${escape(details.redirectHost)}</strong></p>
${details.clientDomain ? `<p>요청 앱 도메인: ${escape(details.clientDomain)}</p>` : '<p>앱 이름은 요청자가 등록한 이름입니다. 직접 시작한 연결인지 확인하세요.</p>'}
${details.redirectIsLoopback ? '<p>이 연결은 컴퓨터의 로컬 앱으로 전달됩니다.</p>' : ''}
<ul><li>내 학급의 학생 번호·XP·HP·모둠 조회</li><li>최대 31일의 점수 기록 집계(한 번에 최대 500건)</li><li>이름·사진 제외, 점수 변경·학생 삭제 불가</li></ul>
<p>권한: <code>${SCOPE}</code> · 연결 유효기간 최대 7일</p>
<p>별도 AI API나 유료 서비스는 호출하지 않습니다. 기존 서버·DB의 무료 사용량은 소모됩니다.</p>
<p id="status" role="status">클업 로그인 상태를 확인하고 있습니다.</p>
<p><a href="/" target="_blank" rel="noopener">클업에서 로그인하기</a> → 로그인 후 이 화면에서 ‘로그인 다시 확인’을 누르세요.</p>
<button type="button" id="check">로그인 다시 확인</button>
<form id="consent"><input type="hidden" name="handle" value="${escape(handle)}">
<button type="submit" id="approve" disabled>읽기 전용 연결 승인</button><button type="button" id="deny">취소</button></form>
<p>승인 후 원래 요청한 앱으로 돌아갑니다. 언제든 해당 앱에서 연결을 해제할 수 있습니다.</p>
</main><script src="/static/mcp-consent.js" defer></script></html>`
}

export function mountMcpConsent(app: Hono<{ Bindings: Bindings; Variables: Variables }>, requireAuth: MiddlewareHandler<any>) {
  app.get('/oauth/authorize', async c => {
    if (!c.env.OAUTH_PROVIDER || c.env.MCP_ENABLED !== 'true') return c.text('MCP 연결이 아직 활성화되지 않았습니다.', 503)
    try {
      const oauth = c.env.OAUTH_PROVIDER
      const request = await oauth.parseAuthRequest(c.req.raw)
      if (request.scope.some(s => s !== SCOPE)) return c.text('읽기 전용 권한만 요청할 수 있습니다.', 400)
      const details = await oauth.describeConsent(request)
      const consent = await oauth.beginConsent(request)
      const headers = consent.headers
      headers.set('Content-Type', 'text/html; charset=utf-8')
      headers.set('Cache-Control', 'no-store')
      headers.set('Referrer-Policy', 'no-referrer')
      headers.set('X-Frame-Options', 'DENY')
      headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' https://*.supabase.co; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
      return new Response(consentHtml(details, consent.handle), { headers })
    } catch (error) {
      if (error instanceof AuthorizationError || error instanceof CimdFetchError) return c.text('유효하지 않거나 만료된 연결 요청입니다. 요청한 앱에서 다시 시작하세요.', 400)
      return c.text('연결 승인 화면을 준비할 수 없습니다.', 503)
    }
  })

  app.post('/api/mcp-authorize', requireAuth, async c => {
    if (!c.env.OAUTH_PROVIDER || c.env.MCP_ENABLED !== 'true') return c.json({ error: 'MCP 비활성 상태' }, 503)
    if (c.req.header('Origin') !== ORIGIN) return c.json({ error: '잘못된 요청 출처' }, 403)
    try {
      const { handle } = await c.req.json<{ handle: string }>()
      const approved = await c.env.OAUTH_PROVIDER.approveConsent(c.req.raw, handle, { scope: [SCOPE] })
      const props: McpIdentity = { userId: c.get('userId'), email: c.get('email') }
      const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
        request: approved.request, userId: props.userId,
        metadata: { label: '클업 읽기 전용 분석' }, scope: [SCOPE], props,
      })
      const headers = approved.headers
      headers.set('Content-Type', 'application/json')
      headers.set('Cache-Control', 'no-store')
      return new Response(JSON.stringify({ redirectTo }), { headers })
    } catch {
      return c.json({ error: '연결 요청이 만료되었거나 유효하지 않습니다. 요청한 앱에서 다시 시작하세요.' }, 400)
    }
  })
  app.post('/oauth/deny', async c => {
    if (!c.env.OAUTH_PROVIDER || c.req.header('Origin') !== ORIGIN) return c.text('Forbidden', 403)
    try {
      const { handle } = await c.req.json<{ handle: string }>()
      const denied = await c.env.OAUTH_PROVIDER.denyConsent(c.req.raw, handle)
      const headers = denied.headers
      const redirectTo = headers.get('Location')
      headers.delete('Location'); headers.set('Content-Type', 'application/json'); headers.set('Cache-Control', 'no-store')
      return new Response(JSON.stringify({ redirectTo }), { headers })
    } catch { return c.json({ error: '요청이 만료되었습니다.' }, 400) }
  })
}

export function withMcp(app: Hono<{ Bindings: Bindings; Variables: Variables }>) {
  const provider = new OAuthProvider<Bindings>({
    apiRoute: '/mcp',
    apiHandler: { async fetch(request, env, ctx) {
      const identity = ctx.props as McpIdentity
      if (!(ctx as any).auth?.scope?.includes(SCOPE) || !identity?.userId || !identity?.email) return new Response('Forbidden', { status: 403 })
      return handleMcp(request, env, identity)
    } },
    defaultHandler: { fetch: (request, env, ctx) => app.fetch(request, env, ctx) },
    authorizeEndpoint: '/oauth/authorize', tokenEndpoint: '/oauth/token', clientRegistrationEndpoint: '/oauth/register',
    scopesSupported: [SCOPE], requiredScopes: [SCOPE],
    resourceMetadata: { resource: `${ORIGIN}/mcp`, authorization_servers: [ORIGIN], resource_name: '클업 읽기 전용 분석' },
    accessTokenTTL: 3600, refreshTokenTTL: 7 * 86400, clientRegistrationTTL: 7 * 86400,
    // DCR avoids fetching client metadata URLs and therefore needs no extra outbound access.
    clientIdMetadataDocumentEnabled: false,
  })
  return { fetch(request: Request, env: Bindings, ctx: ExecutionContext) {
    const path = new URL(request.url).pathname
    const isMcp = path.startsWith('/mcp') || path.startsWith('/oauth/') || path.startsWith('/.well-known/oauth-') || path === '/api/mcp-authorize'
    if (!isMcp) return app.fetch(request, env, ctx)
    if (env.MCP_ENABLED !== 'true' || !env.OAUTH_KV) return new Response('MCP is disabled until free-plan verification and OAuth setup are complete.', { status: 503, headers: { 'Cache-Control': 'no-store' } })
    return provider.fetch(request, env, ctx)
  } }
}
