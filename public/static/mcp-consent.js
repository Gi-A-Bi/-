// Session credentials stay inside the browser and are never placed in URLs or tool output.
(() => {
  const status = document.getElementById('status')
  const approve = document.getElementById('approve')
  const key = 'classup_auth_v1'
  let token = null
  async function check() {
    approve.disabled = true
    token = null
    try {
      const session = JSON.parse(localStorage.getItem(key) || 'null')
      if (!session?.access_token) throw new Error('클업에서 먼저 로그인해 주세요.')
      if (session.expires_at && session.expires_at * 1000 < Date.now() + 30000) throw new Error('클업 화면에서 로그인 상태를 갱신한 뒤 다시 확인해 주세요.')
      const response = await fetch('/api/me', { headers: { Authorization: `Bearer ${session.access_token}` }, cache: 'no-store' })
      if (!response.ok) throw new Error('클업에서 다시 로그인해 주세요.')
      const user = await response.json()
      token = session.access_token
      status.textContent = `로그인 계정: ${user.email}`
      approve.disabled = false
    } catch (error) { status.textContent = error.message }
  }
  async function decide(allow) {
    approve.disabled = true
    document.getElementById('deny').disabled = true
    const handle = document.querySelector('input[name="handle"]').value
    try {
      const response = await fetch(allow ? '/api/mcp-authorize' : '/oauth/deny', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(allow ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ handle }), redirect: 'error',
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '연결을 완료할 수 없습니다.')
      if (!data.redirectTo) { location.assign('/'); return }
      const redirect = new URL(data.redirectTo)
      if (redirect.protocol !== 'https:' && !(redirect.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(redirect.hostname))) throw new Error('안전하지 않은 이동 주소입니다.')
      location.assign(redirect.href)
    } catch (error) {
      status.textContent = error.message
      document.getElementById('deny').disabled = false
    }
  }
  document.getElementById('check').addEventListener('click', check)
  document.getElementById('consent').addEventListener('submit', event => { event.preventDefault(); if (token) decide(true) })
  document.getElementById('deny').addEventListener('click', () => decide(false))
  check()
})()
