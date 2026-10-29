// Exercise the production bundle, OAuth/PKCE and consent cookies without external services.
import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'cloudflare:workers') return { url: 'data:text/javascript,export class WorkerEntrypoint {}', shortCircuit: true }
  return next(specifier, context)
} })
const { default: worker } = await import('../dist/_worker.js')
const origin = 'https://classup.pages.dev'
const classId = '00000000-0000-4000-8000-000000000001'
const identity = { id: 'teacher-id', email: 'teacher@example.com' }
const writes = []
const memory = new Map()
const kv = {
  async get(key, type) {
    const v = memory.get(key)
    return v === undefined ? null : (type === 'json' || type?.type === 'json') ? JSON.parse(v) : v
  },
  async put(key, value) { memory.set(key, value) },
  async delete(key) { memory.delete(key) },
  async list({ prefix = '' } = {}) { return { keys: [...memory.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true, cursor: '' } },
}
const env = { MCP_ENABLED: 'true', OAUTH_KV: kv, SUPABASE_URL: 'https://test.supabase.co', SUPABASE_KEY: 'test-anon', SUPABASE_SERVICE_KEY: 'test-service' }
const ctx = { waitUntil() {}, passThroughOnException() {} }
const request = (path, init = {}, bindings = env) => worker.fetch(new Request(origin + path, init), bindings, ctx)
const json = { 'Content-Type': 'application/json', Origin: origin }
const cookie = response => response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')

test('disabled endpoint fails closed while the existing home page still works', async () => {
  assert.equal((await request('/mcp', {}, {})).status, 503)
  assert.equal((await request('/', {}, {})).status, 200)
})

test('OAuth consent, PKCE, scoped token, MCP tools, revocation and no database writes', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    if (!String(url).startsWith('https://test.supabase.co/')) throw new Error('Unexpected external request')
    if (init.method && init.method !== 'GET') { writes.push(init.method); throw new Error('DB WRITE') }
    if (String(url).endsWith('/auth/v1/user')) return Response.json(identity)
    if (String(url).includes('/rest/v1/classes?')) return Response.json([{ id: classId, name: '테스트 학급', owner_email: identity.email }])
    if (String(url).includes('/rest/v1/students?')) return Response.json([{ id: 'student-id', number: 1, xp: 100, hp: 3, team: 'A' }])
    return Response.json([])
  }
  try {
    const challengeResponse = await request('/mcp', { method: 'POST', headers: json, body: '{}' })
    assert.equal(challengeResponse.status, 401)
    assert.match(challengeResponse.headers.get('WWW-Authenticate'), /oauth-protected-resource/)
    const metadata = await (await request('/.well-known/oauth-authorization-server')).json()
    assert.equal(metadata.authorization_endpoint, origin + '/oauth/authorize')
    const registration = await request('/oauth/register', { method: 'POST', headers: json, body: JSON.stringify({ client_name: 'Test <script>alert(1)</script>', redirect_uris: ['https://chatgpt.com/connector/oauth/callback'], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }) })
    assert.equal(registration.status, 201)
    const client = await registration.json()
    const verifier = 'a'.repeat(64)
    const challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))).toString('base64url')
    const params = new URLSearchParams({ response_type: 'code', client_id: client.client_id, redirect_uri: client.redirect_uris[0], scope: 'classup:read', state: 'test-state', code_challenge: challenge, code_challenge_method: 'S256', resource: origin + '/mcp' })
    const consent = await request('/oauth/authorize?' + params)
    assert.equal(consent.status, 200)
    assert.equal(consent.headers.get('X-Frame-Options'), 'DENY')
    const html = await consent.text()
    assert.ok(!html.includes('<script>alert(1)</script>'))
    const handle = html.match(/name="handle" value="([^"]+)"/)[1]
    const cookies = cookie(consent)
    const unauthorized = await request('/api/mcp-authorize', { method: 'POST', headers: { ...json, Cookie: cookies }, body: JSON.stringify({ handle }) })
    assert.equal(unauthorized.status, 401)
    const wrongOrigin = await request('/api/mcp-authorize', { method: 'POST', headers: { ...json, Origin: 'https://evil.example', Cookie: cookies, Authorization: 'Bearer test-user-session' }, body: JSON.stringify({ handle }) })
    assert.equal(wrongOrigin.status, 403)
    const approved = await request('/api/mcp-authorize', { method: 'POST', headers: { ...json, Cookie: cookies, Authorization: 'Bearer test-user-session' }, body: JSON.stringify({ handle }) })
    assert.equal(approved.status, 200)
    const redirect = new URL((await approved.json()).redirectTo)
    assert.equal(redirect.origin, 'https://chatgpt.com')
    assert.equal(redirect.searchParams.get('state'), 'test-state')
    const replay = await request('/api/mcp-authorize', { method: 'POST', headers: { ...json, Cookie: cookies, Authorization: 'Bearer test-user-session' }, body: JSON.stringify({ handle }) })
    assert.equal(replay.status, 400)
    const tokenBody = { grant_type: 'authorization_code', code: redirect.searchParams.get('code'), client_id: client.client_id, redirect_uri: client.redirect_uris[0], code_verifier: verifier, resource: origin + '/mcp' }
    const badPkce = await request('/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...tokenBody, code_verifier: 'b'.repeat(64) }) })
    assert.equal(badPkce.status, 400)
    const exchanged = await request('/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(tokenBody) })
    assert.equal(exchanged.status, 200)
    const token = await exchanged.json()
    assert.equal(token.scope, 'classup:read')
    const mcpHeaders = { ...json, Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token.access_token}`, 'MCP-Protocol-Version': '2025-11-25' }
    const tools = await request('/mcp', { method: 'POST', headers: mcpHeaders, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })
    assert.equal(tools.status, 200)
    const toolsBody = await tools.json()
    assert.equal(toolsBody.result.tools.length, 3)
    const status = await request('/mcp', { method: 'POST', headers: mcpHeaders, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_student_status', arguments: { class_id: classId } } }) })
    assert.equal(status.status, 200)
    const result = await status.json()
    assert.equal(result.result.isError, undefined)
    assert.match(result.result.content[0].text, /1번/)
    assert.deepEqual(writes, [])
    const revokePath = new URL(metadata.revocation_endpoint).pathname
    const revoked = await request(revokePath, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: token.access_token, client_id: client.client_id }) })
    assert.equal(revoked.status, 200)
    const after = await request('/mcp', { method: 'POST', headers: mcpHeaders, body: '{}' })
    assert.equal(after.status, 401)
  } finally { globalThis.fetch = originalFetch }
})
