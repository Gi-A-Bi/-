import test from 'node:test'
import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { activitySummary, makeMcpServer, ownedClass, period, handleMcp } from '../src/mcp'
import type { SupabaseClient } from '../src/supabase'

const classId = '00000000-0000-4000-8000-000000000001'
const identity = { userId: 'teacher-id', email: 'teacher@example.com' }
const queries: string[] = []
function database(owner = identity.email, logs: any[] = []): SupabaseClient {
  return {
    async select(table, query) {
      queries.push(`${table}?${query}`)
      if (table === 'classes') return [{ id: classId, name: '테스트 학급', owner_email: owner }] as any
      if (table === 'students') return [{ id: 'student-1', number: 1, xp: 100, hp: 3, team: 'A', name: 'SHOULD_NOT_LEAK', avatar_image: 'SHOULD_NOT_LEAK' }] as any
      if (table === 'activity_logs') return logs as any
      return []
    },
    insert: async () => { throw new Error('WRITE FORBIDDEN') },
    update: async () => { throw new Error('WRITE FORBIDDEN') },
    delete: async () => { throw new Error('WRITE FORBIDDEN') },
  }
}

test('Korea calendar boundaries, leap dates and maximum period', () => {
  assert.deepEqual(period('2026-10-01', '2026-10-02'), { from: '2026-10-01', to: '2026-10-02', start: '2026-09-30T15:00:00.000Z', end: '2026-10-02T15:00:00.000Z', timezone: 'Asia/Seoul' })
  assert.equal(period(undefined, undefined, new Date('2026-10-29T16:00:00Z')).to, '2026-10-30')
  assert.throws(() => period('2026-02-29', '2026-03-01'))
  assert.throws(() => period('2026-09-01', '2026-10-02'))
  assert.throws(() => period('2026-10-02', '2026-10-01'))
  assert.doesNotThrow(() => period('2026-10-01', '2026-10-31'))
})

test('foreign class and injection are rejected before student/log queries', async () => {
  queries.length = 0
  await assert.rejects(ownedClass(database('other@example.com'), identity, classId))
  assert.equal(queries.length, 1)
  await assert.rejects(ownedClass(database(), identity, `${classId}&owner_email=is.null`))
  assert.equal(queries.length, 1)
  await assert.doesNotReject(ownedClass(database(), identity, '00000000-0000-0000-0000-000000000001'))
})

test('summary is SELECT-only, scoped and explicit about truncation', async () => {
  queries.length = 0
  const logs = Array.from({ length: 501 }, () => ({ student_id: 'student-1', name: '발표', score: 10, created_at: '2026-10-01T15:00:00Z' }))
  const result = await activitySummary(database(identity.email, logs), identity, classId, '2026-10-01', '2026-10-02')
  assert.equal(result.truncated, true)
  assert.equal(result.records_analyzed, 500)
  assert.equal(result.students[0].xp_delta, 5000)
  assert.equal(result.days[0].date, '2026-10-02')
  assert.ok(!JSON.stringify(result).includes('SHOULD_NOT_LEAK'))
  assert.ok(queries.every(q => q.includes(`eq.${classId}`)))
  assert.match(queries[2], /type=eq.score/)
  assert.match(queries[2], /limit=501/)
})

test('real SDK MCP lifecycle exposes only three read tools; rejects writes and hides names', async () => {
  const server = makeMcpServer(database(), identity)
  const client = new Client({ name: 'test', version: '1.0.0' })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await server.connect(a)
  await client.connect(b)
  try {
    const { tools } = await client.listTools()
    assert.equal(tools.length, 3)
    assert.ok(tools.every(t => t.annotations?.readOnlyHint === true && t.annotations.destructiveHint === false))
    const result = await client.callTool({ name: 'get_student_status', arguments: { class_id: classId } })
    assert.ok(!JSON.stringify(result).includes('SHOULD_NOT_LEAK'))
    assert.match(JSON.stringify(result), /1番|1번/)
    const denied = await client.callTool({ name: 'get_student_status', arguments: { class_id: 'bad&injection' } })
    assert.equal(denied.isError, true)
    const write = await client.callTool({ name: 'delete_student', arguments: {} })
    assert.equal(write.isError, true)
  } finally { await client.close(); await server.close() }
})

test('database failure is sanitized', async () => {
  const db = database()
  db.select = async () => { throw new Error('SECRET_SERVICE_KEY') }
  const server = makeMcpServer(db, identity)
  const client = new Client({ name: 'test', version: '1.0.0' })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await server.connect(a); await client.connect(b)
  try {
    const result = await client.callTool({ name: 'list_my_classes', arguments: {} })
    assert.equal(result.isError, true)
    assert.ok(!JSON.stringify(result).includes('SECRET'))
  } finally { await client.close(); await server.close() }
})

test('stateless HTTP transport initializes and denies cross-origin and oversized requests', async () => {
  const env = {} as any
  const base = 'https://classup.pages.dev/mcp'
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } })
  const response = await handleMcp(new Request(base, { method: 'POST', headers, body }), { ...env, SUPABASE_URL: 'https://example.supabase.co' }, identity)
  assert.equal(response.status, 200)
  assert.match(await response.text(), /classup-readonly/)
  const forbidden = await handleMcp(new Request(base, { method: 'POST', headers: { ...headers, Origin: 'https://evil.example' }, body }), env, identity)
  assert.equal(forbidden.status, 403)
  const oversized = await handleMcp(new Request(base, { method: 'POST', headers, body: 'x'.repeat(17000) }), env, identity)
  assert.equal(oversized.status, 413)
  const wrongMethod = await handleMcp(new Request(base), env, identity)
  assert.equal(wrongMethod.status, 405)
})
