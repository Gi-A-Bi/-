// =============================================================================
// Supabase REST API 헬퍼 (Cloudflare Workers 환경에서 fetch만 사용)
// =============================================================================
import type { Bindings } from './types'

export interface SupabaseClient {
  select<T = any>(
    table: string,
    query?: string,
    extraHeaders?: Record<string, string>,
  ): Promise<T[]>
  insert<T = any>(
    table: string,
    body: any | any[],
    returning?: boolean,
  ): Promise<T[]>
  update<T = any>(
    table: string,
    body: any,
    filter: string,
    returning?: boolean,
  ): Promise<T[]>
  delete(table: string, filter: string): Promise<void>
}

export function makeSupabase(env: Bindings): SupabaseClient {
  const base = env.SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1'
  const baseHeaders = {
    apikey: env.SUPABASE_KEY,
    Authorization: `Bearer ${env.SUPABASE_KEY}`,
    'Content-Type': 'application/json',
  }

  async function call(path: string, init: RequestInit & { headers?: Record<string, string> }) {
    const url = base + path
    const res = await fetch(url, {
      ...init,
      headers: { ...baseHeaders, ...(init.headers || {}) },
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Supabase ${init.method || 'GET'} ${path} failed (${res.status}): ${text}`)
    }
    const text = await res.text()
    if (!text) return []
    try {
      return JSON.parse(text)
    } catch {
      return text as any
    }
  }

  return {
    async select(table, query = '', extraHeaders = {}) {
      const q = query ? (query.startsWith('?') ? query : '?' + query) : ''
      return (await call(`/${table}${q}`, {
        method: 'GET',
        headers: extraHeaders,
      })) as any
    },

    async insert(table, body, returning = true) {
      return (await call(`/${table}`, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: {
          Prefer: returning ? 'return=representation' : 'return=minimal',
        },
      })) as any
    },

    async update(table, body, filter, returning = true) {
      const q = filter.startsWith('?') ? filter : '?' + filter
      return (await call(`/${table}${q}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
        headers: {
          Prefer: returning ? 'return=representation' : 'return=minimal',
        },
      })) as any
    },

    async delete(table, filter) {
      const q = filter.startsWith('?') ? filter : '?' + filter
      await call(`/${table}${q}`, { method: 'DELETE' })
    },
  }
}
