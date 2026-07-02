// =================================================================
// 클업 (CLASS UP) - SPA 프론트엔드
// =================================================================

const state = {
  classId: null,            // 내 학급 UUID (로그인 후 /api/my-class 에서 로드)
  className: '클업',
  bonusXp: 0,               // 학급 전체 경험치 보정치 (학생 xp 합계 + bonusXp = 학급 전체 경험치)
  view: 'list',             // list | detail | logs | settings
  currentStudentId: null,
  students: [],
  levelTable: [],
  activities: [],
  settingsTab: 'activities',
  booted: false,

  // === Auth 상태 ===
  authReady: false,
  authConfig: null,         // { supabase_url, supabase_key }
  authToken: null,          // access_token (JWT)
  authRefreshToken: null,
  authEmail: null,
  authExpiresAt: null,      // 초 단위 epoch
}

const AUTH_STORAGE_KEY = 'classup_auth_v1'

// ==============================
// 효과음 (Web Audio API로 실시간 합성 — 오디오 파일 없이 은은한 톤)
//  - 낮은 음량 + 부드러운 엔벨로프(클릭음 방지) + 짧은 길이로 조잡하지 않게
//  - 헤더의 소리 버튼으로 끌 수 있음 (localStorage 저장)
// ==============================
const SOUND_STORAGE_KEY = 'classup_sound_v1'
state.soundOn = localStorage.getItem(SOUND_STORAGE_KEY) !== 'off'

const Sound = (() => {
  let ctx = null
  function ac() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext
      if (!AC) return null
      ctx = new AC()
    }
    if (ctx.state === 'suspended') ctx.resume()
    return ctx
  }
  // 한 음 재생: 부드러운 attack/release 엔벨로프로 딱딱한 클릭음 제거
  function note(freq, t0, dur, { type = 'sine', gain = 0.13, glideTo = null } = {}) {
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, t0)
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur)
    const attack = 0.008
    const release = Math.max(0.04, dur * 0.7)
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + release)
    osc.connect(g)
    g.connect(ctx.destination)
    osc.start(t0)
    osc.stop(t0 + dur + release + 0.02)
  }
  function play(builder) {
    if (!state.soundOn) return
    const c = ac()
    if (!c) return
    try { builder(c.currentTime) } catch (_) {}
  }
  return {
    // 점수 부여(+): 살짝 위로 올라가는 짧고 맑은 톤
    scoreUp() { play(t => note(660, t, 0.10, { type: 'triangle', gain: 0.12, glideTo: 740 })) },
    // 점수 차감(−): 살짝 내려가는 낮고 부드러운 톤
    scoreDown() { play(t => note(320, t, 0.14, { type: 'triangle', gain: 0.11, glideTo: 250 })) },
    // 레벨업: 은은한 상승 아르페지오 (C5-E5-G5-C6)
    levelUp() {
      play(t => {
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
          note(f, t + i * 0.085, 0.16, { type: 'triangle', gain: 0.12 }))
      })
    },
    // 스킬/보상 획득: 반짝이는 두 음 (G5 → D6)
    skillGet() {
      play(t => {
        note(783.99, t, 0.12, { type: 'sine', gain: 0.12 })
        note(1174.66, t + 0.09, 0.20, { type: 'sine', gain: 0.10 })
      })
    },
    // 스킬 사용: 부드럽게 스치는 하강음
    skillUse() { play(t => note(880, t, 0.18, { type: 'sine', gain: 0.10, glideTo: 587.33 })) },
    // HP 변화(작고 조용한 틱)
    hpUp() { play(t => note(880, t, 0.07, { type: 'sine', gain: 0.08 })) },
    hpDown() { play(t => note(392, t, 0.09, { type: 'sine', gain: 0.08 })) },
  }
})()

function toggleSound() {
  state.soundOn = !state.soundOn
  localStorage.setItem(SOUND_STORAGE_KEY, state.soundOn ? 'on' : 'off')
  updateSoundButton()
  if (state.soundOn) Sound.scoreUp()   // 켤 때 짧은 미리듣기
}

function updateSoundButton() {
  const btn = document.getElementById('nav-sound')
  if (!btn) return
  const on = state.soundOn
  const icon = btn.querySelector('i')
  if (icon) icon.className = on ? 'fa-solid fa-volume-high' : 'fa-solid fa-volume-xmark'
  const label = btn.querySelector('.icon-label')
  if (label) label.textContent = on ? '소리' : '음소거'
  btn.title = on ? '효과음 켜짐' : '효과음 꺼짐'
  btn.classList.toggle('is-muted', !on)
}

// ==============================
// Auth 세션 저장/복원
// ==============================
function saveAuthSession() {
  if (!state.authToken) {
    localStorage.removeItem(AUTH_STORAGE_KEY)
    return
  }
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({
    access_token: state.authToken,
    refresh_token: state.authRefreshToken,
    email: state.authEmail,
    expires_at: state.authExpiresAt,
  }))
}

function loadAuthSession() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY)
    if (!raw) return false
    const s = JSON.parse(raw)
    if (!s.access_token) return false
    state.authToken = s.access_token
    state.authRefreshToken = s.refresh_token || null
    state.authEmail = s.email || null
    state.authExpiresAt = s.expires_at || null
    return true
  } catch {
    return false
  }
}

function clearAuthSession() {
  state.authToken = null
  state.authRefreshToken = null
  state.authEmail = null
  state.authExpiresAt = null
  state.classId = null
  state.className = '클업'
  state.booted = false
  state.students = []
  state.activities = []
  state.levelTable = []
  localStorage.removeItem(AUTH_STORAGE_KEY)
}

// ==============================
// Supabase Auth 직접 호출 (REST)
// ==============================
async function loadAuthConfig() {
  if (state.authConfig) return state.authConfig
  const res = await fetch('/api/public-config')
  if (!res.ok) throw new Error('Supabase 설정을 불러오지 못했습니다')
  state.authConfig = await res.json()
  return state.authConfig
}

async function supabaseAuthCall(path, body) {
  const cfg = await loadAuthConfig()
  const url = cfg.supabase_url.replace(/\/+$/, '') + path
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: cfg.supabase_key,
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  if (!res.ok) {
    const msg = (data && (data.msg || data.error_description || data.error || data.message)) || `HTTP ${res.status}`
    throw new Error(translateAuthError(msg))
  }
  return data
}

function translateAuthError(msg) {
  const m = String(msg || '')
  if (/Invalid login credentials/i.test(m)) return '이메일 또는 비밀번호가 올바르지 않습니다'
  if (/User already registered/i.test(m)) return '이미 가입된 이메일입니다'
  if (/Password should be at least/i.test(m)) return '비밀번호는 최소 6자 이상이어야 합니다'
  if (/email.*invalid/i.test(m)) return '올바른 이메일 형식이 아닙니다'
  if (/rate limit/i.test(m)) return '잠시 후 다시 시도해주세요 (요청이 너무 많아요)'
  return m
}

async function signUp(email, password) {
  const data = await supabaseAuthCall('/auth/v1/signup', { email, password })
  // 이메일 확인이 꺼져있으면 session이 즉시 반환됨
  if (data && data.access_token) {
    applyAuthData(data)
    return { signedIn: true }
  }
  return { signedIn: false, needsEmailConfirm: true }
}

async function signIn(email, password) {
  const data = await supabaseAuthCall('/auth/v1/token?grant_type=password', {
    email, password,
  })
  applyAuthData(data)
  return { signedIn: true }
}

async function signOut() {
  const token = state.authToken
  if (token) {
    try {
      const cfg = await loadAuthConfig()
      await fetch(cfg.supabase_url.replace(/\/+$/, '') + '/auth/v1/logout', {
        method: 'POST',
        headers: {
          apikey: cfg.supabase_key,
          Authorization: `Bearer ${token}`,
        },
      })
    } catch {}
  }
  clearAuthSession()
}

function applyAuthData(data) {
  state.authToken = data.access_token
  state.authRefreshToken = data.refresh_token || null
  state.authEmail = (data.user && data.user.email) || null
  state.authExpiresAt = data.expires_at || (Math.floor(Date.now() / 1000) + (data.expires_in || 3600))
  saveAuthSession()
}

async function tryRefreshToken() {
  if (!state.authRefreshToken) return false
  try {
    const data = await supabaseAuthCall('/auth/v1/token?grant_type=refresh_token', {
      refresh_token: state.authRefreshToken,
    })
    applyAuthData(data)
    return true
  } catch {
    return false
  }
}

// ==============================
// 부팅: 내 학급 로드
// ==============================
async function bootstrap() {
  if (state.booted) return { ok: true }
  try {
    const data = await api('/api/my-class')
    if (data.my_class) {
      state.classId = data.my_class.id
      state.className = data.my_class.name || '클업'
      state.bonusXp = Number(data.my_class.bonus_xp || 0)
      state.booted = true
      return { ok: true, hasClass: true }
    }
    // 학급 없음 → 온보딩
    return { ok: true, hasClass: false, claimable: data.claimable_classes || [] }
  } catch (e) {
    console.error('bootstrap failed', e)
    if (e.code === 'NO_AUTH' || e.code === 'INVALID_TOKEN') {
      clearAuthSession()
      return { ok: false, needsLogin: true }
    }
    showToast('서버 연결 실패: ' + e.message, 'error')
    throw e
  }
}

// ==============================
// API 헬퍼 (Authorization 자동 첨부 + 401 재시도)
// ==============================
async function api(path, opts = {}) {
  return apiInner(path, opts, true)
}

async function apiInner(path, opts, allowRetry) {
  const headers = {
    'Content-Type': 'application/json',
    ...(opts.headers || {}),
  }
  if (state.authToken) headers.Authorization = `Bearer ${state.authToken}`

  const res = await fetch(path, { ...opts, headers })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    if (res.status === 401 && allowRetry) {
      const refreshed = await tryRefreshToken()
      if (refreshed) return apiInner(path, opts, false)
    }
    const e = new Error(err.error || `HTTP ${res.status}`)
    e.code = err.code
    e.status = res.status
    throw e
  }
  return res.json()
}

// ==============================
// 유틸리티
// ==============================
function getInitial(name) {
  if (!name) return '?'
  return name.trim().charAt(0)
}

// 아바타 내용: 사진 > 이모지 > 이름 첫 글자
//   - 사진: avatar_image (data:image/jpeg;base64,...)
//   - 이모지: avatar_emoji
//   - 그 외: 이름 첫 글자
function avatarContent(student) {
  if (student.avatar_image) {
    return `<img src="${student.avatar_image}" alt="" class="avatar-img" draggable="false" />`
  }
  if (student.avatar_emoji) return student.avatar_emoji
  return escapeHtml(getInitial(student.name))
}

// 학생이 사진을 가지고 있으면 true (배경 그라데이션 숨김용)
function hasAvatarImage(student) {
  return !!(student && student.avatar_image)
}

// 표시 이름: 닉네임이 있으면 우선, 본명은 작게 함께 노출
function displayNameHtml(student, opts = {}) {
  const { size = 'md' } = opts
  if (student.nickname) {
    return `
      <div class="display-name ${size}">
        <span class="nickname">${escapeHtml(student.nickname)}</span>
        <span class="real-name">${escapeHtml(student.name)}</span>
      </div>
    `
  }
  return `<div class="display-name ${size}"><span class="nickname">${escapeHtml(student.name)}</span></div>`
}

// 아바타 색상 팔레트 & 이모지 팔레트 (꾸미기 모달용)
const AVATAR_EMOJIS = [
  '🦊', '🐰', '🦁', '🐼', '🐯', '🐻', '🐨', '🐶',
  '🐱', '🦄', '🐸', '🐢', '🐧', '🐥', '🦉', '🦋',
  '🐙', '🦖', '🦕', '🐲', '🦒', '🦘', '🦔', '🐹',
  '🌸', '🌟', '⚡', '🔥', '🌈', '🍀', '👑', '🎮',
]

const AVATAR_COLORS = [
  '#FF6B9D', '#F472B6', '#EC4899', // 핑크 계열
  '#FB923C', '#F97316', '#EF4444', // 오렌지/레드
  '#FBBF24', '#FACC15', '#EAB308', // 옐로우
  '#34D399', '#22C55E', '#10B981', // 그린
  '#4ECDC4', '#06B6D4', '#0EA5E9', // 시안/블루
  '#60A5FA', '#3B82F6', '#6366F1', // 블루/인디고
  '#A78BFA', '#8B5CF6', '#7C3AED', // 퍼플
  '#94A3B8', '#64748B', '#475569', // 그레이
]

// avatar_color가 null이면 학생 번호/id 기반으로 결정적 fallback 색상 반환
function avatarColor(student) {
  if (student && student.avatar_color) return student.avatar_color
  // student.number가 있으면 그것을, 없으면 id의 hash로 인덱스 결정
  const key = student && (student.number || student.id || student.student_id) || ''
  let h = 0
  const s = String(key)
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  const idx = Math.abs(h) % AVATAR_COLORS.length
  return AVATAR_COLORS[idx]
}

function rankInfo(rank) {
  if (rank === 'gold') return { label: '골드', icon: '🥇', cls: 'rank-gold' }
  if (rank === 'silver') return { label: '실버', icon: '🥈', cls: 'rank-silver' }
  return { label: '브론즈', icon: '🥉', cls: 'rank-bronze' }
}

function escapeHtml(str) {
  if (str == null) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function formatTime(iso) {
  if (!iso) return ''
  // SQLite returns "YYYY-MM-DD HH:MM:SS" in UTC. Parse it safely.
  let d
  if (iso.includes('T')) {
    d = new Date(iso)
  } else {
    d = new Date(iso.replace(' ', 'T') + 'Z')
  }
  if (isNaN(d.getTime())) return iso
  const now = new Date()
  const diffMs = now - d
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return '방금 전'
  if (diffMin < 60) return `${diffMin}분 전`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}시간 전`
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${mm}/${dd} ${hh}:${mi}`
}

// 활동(점수 버튼) 이모지 라이브러리 — 카테고리별 100+ 개
// 교사가 자유롭게 골라서 활동에 붙일 수 있다.
const ACTIVITY_EMOJI_LIBRARY = [
  {
    label: '학습·과제',
    emojis: ['📝','📚','📖','✏️','🖊️','📓','📔','📒','📑','🧮','🔬','🔭','📐','📏','🗒️','📎','📌','🧾','🧠','💡'],
  },
  {
    label: '발표·태도',
    emojis: ['🎤','🙋','🙋‍♀️','🙋‍♂️','👋','🙇','🙇‍♀️','🙇‍♂️','🤝','👏','👍','👌','✋','💬','🗣️','👥','👀','🫶','💯','✨'],
  },
  {
    label: '예체능',
    emojis: ['🎨','🖌️','🎭','🎵','🎶','🎹','🎸','🥁','🎺','🎻','🎬','📷','⚽','🏀','🏐','⚾','🏸','🏓','🤸','🏃'],
  },
  {
    label: '리더십·협동',
    emojis: ['👑','🏆','🥇','🥈','🥉','🎖️','🏅','🧑‍🏫','🧩','🤲','💪','🌟','⭐','🔝','🚀','🗺️','🧭','🛡️','⚔️','🔥'],
  },
  {
    label: '생활·정리',
    emojis: ['🧹','🧼','🧽','🪥','🧺','♻️','🗑️','📅','📆','⏰','🕐','🪑','🎒','👟','👕','🧤','🦷','🍱','🥛','🍎'],
  },
  {
    label: '감정·칭찬',
    emojis: ['😀','😄','😊','🥰','😎','🤩','🥳','😇','🤓','🌈','🍀','🌸','🌻','💐','🎁','🎉','🎊','💖','💝','🌟'],
  },
  {
    label: '주의·감점',
    emojis: ['⚠️','❌','🚫','😅','😢','😭','😡','💢','🛑','⏳','😴','🙊','🙉','🙈','🫥','🪫','📵','🔕','🥲','🆘'],
  },
  {
    label: '기타',
    emojis: ['➕','➖','✅','☑️','🆗','🔄','🆕','❗','❓','💭','🎯','🎲','🃏','🎟️','🎫','🪄','🔮','🧿','🌍','🪐'],
  },
]

// 활동명 → 자동 추천 이모지 (규칙 기반). 정확한 매칭 없으면 NULL을 반환할 수도 있게 처리.
const ACTIVITY_EMOJI_RULES = [
  [/숙제|과제/, '📝'],
  [/출석|등교/, '✅'],
  [/지각/, '⏰'],
  [/결석/, '🪑'],
  [/독서|책 읽기|아침 독서/, '📚'],
  [/친구.*돕|돕기|도움|도와/, '🤝'],
  [/칭찬|쩐다|훌륭|폭풍|최고/, '🌟'],
  [/벌점|감점/, '⚠️'],
  [/발표|말하기|손들기/, '🎤'],
  [/청소|정리|정돈/, '🧹'],
  [/인사|예의|존중/, '👋'],
  [/그림|미술|색칠/, '🎨'],
  [/노래|음악|악기/, '🎵'],
  [/체육|운동|달리기/, '⚽'],
  [/수학|문제|연산/, '🧮'],
  [/영어|단어/, '🔤'],
  [/과학|실험|관찰/, '🔬'],
  [/한자|국어|글쓰기|일기/, '✏️'],
  [/리더|반장|모범/, '👑'],
  [/멘토|가르치/, '🧑‍🏫'],
  [/도전|모험|용기/, '🗺️'],
  [/협동|모둠|팀워크/, '🧩'],
  [/준비물|미비|놓고 옴/, '🎒'],
  [/방해|떠들|소란/, '🚫'],
  [/거짓말|험담/, '🙊'],
  [/직접|기타|커스텀|자유 입력/, '✏️'],
  [/레벨.*달성/, '🎉'],
  [/스킬 사용/, '✨'],
  [/선택/, '🎁'],
]

// 활동 객체 또는 활동명을 받아 보여줄 이모지를 결정
// - 객체일 때: emoji 컬럼이 있으면 그것을, 없으면 이름 기반 추천
// - 문자열일 때: 이름 기반 추천만 (백워드 호환)
function activityEmoji(input) {
  if (input && typeof input === 'object') {
    if (input.emoji) return input.emoji
    return suggestActivityEmoji(input.name || '') || '📌'
  }
  const name = String(input || '')
  return suggestActivityEmoji(name) || '📌'
}

function suggestActivityEmoji(name) {
  if (!name) return null
  for (const [re, em] of ACTIVITY_EMOJI_RULES) {
    if (re.test(name)) return em
  }
  return null
}

function skillEmoji(name) {
  if (!name) return '✨'
  if (name.includes('스티커') || name.includes('도장')) return '🌟'
  if (name.includes('간식') || name.includes('급식')) return '🍪'
  if (name.includes('자유석') || name.includes('자리')) return '💺'
  if (name.includes('코믹') || name.includes('책') || name.includes('도서')) return '📖'
  if (name.includes('음악')) return '🎵'
  if (name.includes('체육')) return '⚽'
  if (name.includes('숙제')) return '📝'
  if (name.includes('청소')) return '🧹'
  if (name.includes('보드게임')) return '🎲'
  if (name.includes('칭찬')) return '🏆'
  return '🎁'
}

function passiveEmoji(name) {
  if (!name) return '🛡️'
  if (name.includes('리더')) return '👑'
  if (name.includes('발표')) return '🎤'
  if (name.includes('인사')) return '👋'
  if (name.includes('모험가') || name.includes('초보')) return '🗡️'
  if (name.includes('마스터') || name.includes('전설')) return '🏅'
  if (name.includes('모둠') || name.includes('멘토')) return '🧑‍🏫'
  if (name.includes('도서') || name.includes('우대')) return '📚'
  if (name.includes('청소')) return '🧹'
  return '🛡️'
}

// ==============================
// 토스트
// ==============================
function showToast(text, type = 'success', emoji = null) {
  const container = document.getElementById('toast-container')
  const toast = document.createElement('div')
  toast.className = `toast ${type}`
  const defaultEmoji = type === 'success' ? '✅' : type === 'warning' ? '⚠️' : type === 'error' ? '❌' : type === 'level-up' ? '🎉' : '💬'
  toast.innerHTML = `<span class="toast-emoji">${emoji || defaultEmoji}</span><span class="toast-text">${escapeHtml(text)}</span>`
  container.appendChild(toast)
  setTimeout(() => {
    toast.style.transition = 'opacity 0.3s, transform 0.3s'
    toast.style.opacity = '0'
    toast.style.transform = 'translateY(-10px)'
    setTimeout(() => toast.remove(), 300)
  }, 2400)
}

// ==============================
// 모달
// ==============================
function showConfirm(title, message, onConfirm) {
  const container = document.getElementById('modal-container')
  container.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal">
        <div class="modal-title">${escapeHtml(title)}</div>
        <div style="text-align:center; color:var(--text-light); font-size:14px;">${escapeHtml(message)}</div>
        <div class="modal-actions">
          <button class="btn-cancel" id="modal-cancel">취소</button>
          <button class="btn-confirm" id="modal-confirm">확인</button>
        </div>
      </div>
    </div>
  `
  document.getElementById('modal-cancel').onclick = () => container.innerHTML = ''
  document.getElementById('modal-confirm').onclick = () => {
    container.innerHTML = ''
    onConfirm()
  }
}

// 닉네임 편집 모달
function showNicknameEditor(student) {
  const container = document.getElementById('modal-container')
  container.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal">
        <div class="modal-title">✏️ ${student.nickname ? '닉네임 수정' : '닉네임 정하기'}</div>
        <div style="text-align:center; color:var(--text-light); font-size:13px; margin-bottom:8px;">
          ${escapeHtml(student.name)} 학생의 닉네임을 입력해주세요.
        </div>
        <input type="text" id="nickname-input" maxlength="20" placeholder="예: 민달팽이"
          value="${escapeHtml(student.nickname || '')}"
          style="width:100%; padding:12px; border:2px solid #e5e7eb; border-radius:12px; font-family:inherit; font-size:16px; text-align:center;" />
        <div style="font-size:11px; color:var(--text-light); text-align:center; margin-top:8px;">
          ※ 비워두면 닉네임을 지웁니다.
        </div>
        <div class="modal-actions">
          <button class="btn-cancel" id="modal-cancel">취소</button>
          <button class="btn-confirm" id="modal-confirm">저장</button>
        </div>
      </div>
    </div>
  `
  const input = document.getElementById('nickname-input')
  setTimeout(() => { input.focus(); input.select() }, 50)

  document.getElementById('modal-cancel').onclick = () => container.innerHTML = ''
  document.getElementById('modal-confirm').onclick = async () => {
    const nickname = input.value.trim()
    try {
      await api(`/api/students/${student.id}/profile`, {
        method: 'PUT',
        body: JSON.stringify({ nickname: nickname || null }),
      })
      container.innerHTML = ''
      showToast(nickname ? `닉네임: ${nickname}` : '닉네임을 지웠어요', 'success', '✏️')
      await renderDetail(student.id)
    } catch (e) {
      showToast(e.message, 'error')
    }
  }
}

// 아바타 꾸미기 모달 (이모지 / 사진 / 색상 — 3가지 선택)
//  - 사진(avatar_image)이 설정되어 있으면 그것을 우선 표시
//  - 사진을 지우면 이모지/이름 첫글자로 자동 fallback
function showAvatarPicker(student) {
  const container = document.getElementById('modal-container')
  let pickedEmoji = student.avatar_emoji || ''
  let pickedColor = student.avatar_color || avatarColor(student)
  let pickedImage = student.avatar_image || ''   // data URL or ''
  let tab = pickedImage ? 'photo' : 'emoji'      // 'emoji' | 'photo'

  function previewHtml() {
    const hasImg = !!pickedImage
    const cls = hasImg ? 'avatar-photo' : (pickedEmoji ? 'avatar-emoji' : '')
    const bg = hasImg ? '' : `background: linear-gradient(135deg, ${pickedColor}, ${pickedColor}cc);`
    const content = hasImg
      ? `<img src="${pickedImage}" alt="" class="avatar-img" draggable="false" />`
      : (pickedEmoji ? pickedEmoji : escapeHtml(getInitial(student.name)))
    return `
      <div class="avatar avatar-lg ${cls}" id="avatar-preview" style="${bg}">
        ${content}
      </div>
    `
  }

  function emojiGridHtml() {
    return AVATAR_EMOJIS.map(em => `
      <button class="emoji-pick ${em === pickedEmoji && !pickedImage ? 'active' : ''}" data-emoji="${em}">${em}</button>
    `).join('')
  }

  function colorGridHtml() {
    return AVATAR_COLORS.map(col => `
      <button class="color-pick ${col === pickedColor ? 'active' : ''}" data-color="${col}"
        style="background: linear-gradient(135deg, ${col}, ${col}cc);"></button>
    `).join('')
  }

  function tabBodyHtml() {
    if (tab === 'photo') {
      return `
        <div class="picker-section">
          <div class="picker-label">사진</div>
          <div class="hint-text" style="margin-bottom:8px;">
            정사각형으로 자동 크롭(중앙)되고 200×200으로 줄여서 저장돼요. (개인정보 보호상 필요한 사진만 올려주세요)
          </div>
          <label class="avatar-photo-drop" id="photo-drop">
            <input type="file" id="photo-input" accept="image/*" hidden />
            <div class="avatar-photo-drop-inner">
              <i class="fa-solid fa-image"></i>
              <div class="file-drop-label">사진 선택</div>
              <div class="file-drop-name">파일을 선택하거나 여기로 드래그</div>
            </div>
          </label>
          ${pickedImage ? `
            <button class="btn-mini danger" id="photo-clear" style="margin-top:10px;">
              <i class="fa-solid fa-xmark"></i> 사진 제거
            </button>
          ` : ''}
        </div>
      `
    }
    return `
      <div class="picker-section">
        <div class="picker-label">캐릭터(이모지)</div>
        <div class="emoji-grid">
          <button class="emoji-pick ${!pickedEmoji && !pickedImage ? 'active' : ''}" data-emoji="">
            <span style="font-size:14px; color:var(--text-light);">없음</span>
          </button>
          ${emojiGridHtml()}
        </div>
      </div>

      <div class="picker-section">
        <div class="picker-label">배경 색</div>
        <div class="color-grid">${colorGridHtml()}</div>
      </div>
    `
  }

  function render() {
    container.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal modal-wide">
          <div class="modal-title">🎨 아바타 꾸미기</div>
          <div class="avatar-preview-wrap">${previewHtml()}</div>

          <div class="add-tabs" style="margin-bottom:14px;">
            <button class="add-tab ${tab === 'emoji' ? 'active' : ''}" data-tab="emoji">
              <i class="fa-solid fa-face-smile"></i> 이모지·색상
            </button>
            <button class="add-tab ${tab === 'photo' ? 'active' : ''}" data-tab="photo">
              <i class="fa-solid fa-camera"></i> 사진 업로드
            </button>
          </div>

          <div class="add-tab-body">
            ${tabBodyHtml()}
          </div>

          <div class="modal-actions">
            <button class="btn-cancel" id="modal-cancel">취소</button>
            <button class="btn-confirm" id="modal-confirm">저장</button>
          </div>
        </div>
      </div>
    `

    container.querySelectorAll('.add-tab').forEach(b => {
      b.onclick = () => { tab = b.dataset.tab; render() }
    })

    if (tab === 'emoji') {
      container.querySelectorAll('.emoji-pick').forEach(btn => {
        btn.onclick = () => {
          pickedEmoji = btn.dataset.emoji
          pickedImage = ''   // 이모지를 고르면 사진은 비움 (한 가지만 사용)
          render()
        }
      })
      container.querySelectorAll('.color-pick').forEach(btn => {
        btn.onclick = () => {
          pickedColor = btn.dataset.color
          render()
        }
      })
    } else {
      const fi = document.getElementById('photo-input')
      const drop = document.getElementById('photo-drop')
      fi.onchange = () => handlePhoto(fi.files?.[0])
      drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('drag-over') }
      drop.ondragleave = () => drop.classList.remove('drag-over')
      drop.ondrop = (e) => {
        e.preventDefault()
        drop.classList.remove('drag-over')
        handlePhoto(e.dataTransfer.files?.[0])
      }
      const clr = document.getElementById('photo-clear')
      if (clr) clr.onclick = () => {
        pickedImage = ''
        render()
        showToast('사진을 제거했어요. 저장 버튼을 눌러야 반영돼요.', 'success', '🧽')
      }
    }

    document.getElementById('modal-cancel').onclick = () => container.innerHTML = ''
    document.getElementById('modal-confirm').onclick = async () => {
      try {
        await api(`/api/students/${student.id}/profile`, {
          method: 'PUT',
          body: JSON.stringify({
            avatar_emoji: pickedImage ? null : (pickedEmoji || null),
            avatar_color: pickedColor,
            avatar_image: pickedImage || null,
          }),
        })
        container.innerHTML = ''
        showToast('아바타가 바뀌었어요!', 'success', '🎨')
        await renderDetail(student.id)
      } catch (e) {
        showToast(e.message, 'error')
      }
    }
  }

  // 사진 파일을 받아서 200x200 정사각형으로 중앙 크롭 + JPEG 압축
  async function handlePhoto(file) {
    if (!file) return
    if (!/^image\//.test(file.type)) {
      showToast('이미지 파일만 올릴 수 있어요', 'error')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      showToast('파일이 너무 커요 (최대 10MB)', 'error')
      return
    }
    try {
      const dataUrl = await compressImageToSquare(file, 200, 0.82)
      // 너무 큰 결과는 다시 한 번 더 압축
      let finalUrl = dataUrl
      if (finalUrl.length > 200_000) finalUrl = await compressImageToSquare(file, 180, 0.7)
      if (finalUrl.length > 200_000) finalUrl = await compressImageToSquare(file, 160, 0.6)
      pickedImage = finalUrl
      pickedEmoji = ''   // 사진을 올리면 이모지는 비움 (실제로 표시될 때 사진이 우선이긴 함)
      render()
      showToast('사진을 불러왔어요. 저장 버튼을 누르면 반영돼요!', 'success', '📷')
    } catch (e) {
      console.error(e)
      showToast('사진을 처리하지 못했어요', 'error')
    }
  }

  render()
}

// 이미지 파일을 정사각형(size×size)으로 중앙 크롭 + JPEG 압축
// → data URL 반환 (전역 헬퍼 — 어디서든 재사용 가능)
function compressImageToSquare(file, size = 200, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      try {
        // 중앙 정사각형 크롭
        const side = Math.min(img.naturalWidth, img.naturalHeight)
        const sx = (img.naturalWidth - side) / 2
        const sy = (img.naturalHeight - side) / 2

        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        // 부드러운 다운스케일
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size)

        URL.revokeObjectURL(url)
        // JPEG로 변환 (PNG보다 훨씬 작음)
        const dataUrl = canvas.toDataURL('image/jpeg', quality)
        resolve(dataUrl)
      } catch (e) {
        URL.revokeObjectURL(url)
        reject(e)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('이미지를 불러오지 못했어요'))
    }
    img.src = url
  })
}

// 특별 점수 부여: 점수 + 사유 직접 입력
function showCustomScorePrompt(studentId, baseName) {
  const container = document.getElementById('modal-container')
  container.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal">
        <div class="modal-title">✨ 특별 점수 부여</div>
        <div style="display:flex; flex-direction:column; gap:10px; margin-top:8px;">
          <div>
            <label style="font-size:12px; color:var(--text-light); font-weight:bold;">사유 (활동명)</label>
            <input type="text" id="custom-name" placeholder="예: 학급 회의 사회"
              style="width:100%; padding:10px; border:2px solid #e5e7eb; border-radius:10px; font-family:inherit; font-size:14px; margin-top:4px;" />
          </div>
          <div>
            <label style="font-size:12px; color:var(--text-light); font-weight:bold;">점수 (음수면 차감)</label>
            <input type="number" id="custom-delta" placeholder="예: 15 또는 -5" value="10"
              style="width:100%; padding:10px; border:2px solid #e5e7eb; border-radius:10px; font-family:inherit; font-size:14px; margin-top:4px;" />
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn-cancel" id="modal-cancel">취소</button>
          <button class="btn-confirm" id="modal-confirm">부여하기</button>
        </div>
      </div>
    </div>
  `
  const nameInput = document.getElementById('custom-name')
  const deltaInput = document.getElementById('custom-delta')
  setTimeout(() => nameInput.focus(), 50)

  document.getElementById('modal-cancel').onclick = () => container.innerHTML = ''
  document.getElementById('modal-confirm').onclick = () => {
    const name = nameInput.value.trim() || '특별 점수'
    const delta = Number(deltaInput.value) || 0
    if (delta === 0) {
      showToast('점수를 입력해주세요', 'warning')
      return
    }
    container.innerHTML = ''
    addScore(studentId, name, delta)
  }
}

// ==============================
// 헤더 갱신
// ==============================
function updateHeader() {
  const titleEl = document.getElementById('header-title')
  const titleText = document.getElementById('header-title-text')
  if (state.view === 'list') {
    titleText.innerHTML = '<span class="brand-ko">클업</span><span class="brand-en">CLASS UP</span>'
    titleEl.onclick = null
  } else {
    let label = ''
    if (state.view === 'detail') label = '캐릭터 시트'
    else if (state.view === 'logs') label = '활동 기록'
    else if (state.view === 'settings') label = '설정 - 레벨표'
    titleText.innerHTML = `<span class="back-arrow">←</span>${label}`
    titleEl.onclick = () => navigate('list')
  }
}

// ==============================
// 라우팅
// ==============================
async function navigate(view, params = {}) {
  state.view = view
  if (view === 'detail') state.currentStudentId = params.studentId
  updateHeader()
  const main = document.getElementById('main-view')
  main.innerHTML = '<div class="view-container hint-text">불러오는 중...</div>'

  try {
    if (!state.booted) await bootstrap()
    if (view === 'list') await renderList()
    else if (view === 'detail') await renderDetail(state.currentStudentId)
    else if (view === 'logs') await renderLogs()
    else if (view === 'settings') await renderSettings()
  } catch (e) {
    main.innerHTML = `<div class="view-container hint-text">오류: ${escapeHtml(e.message)}</div>`
  }

  window.scrollTo(0, 0)
}

// ==============================
// 화면 1: 학생 목록
// ==============================
async function renderList() {
  const students = await api(`/api/classes/${state.classId}/students`)
  state.students = students

  const main = document.getElementById('main-view')

  const className = escapeHtml(state.className || '클업')

  if (students.length === 0) {
    main.innerHTML = `
      <div class="view-container list-view">
        <div class="view-title">
          <span>🏰</span> ${className}
          <button class="btn-add-student" id="btn-add-student">+ 학생 추가</button>
        </div>
        <div class="empty-state">
          아직 학생이 없어요.<br/>
          오른쪽 위 <strong>+ 학생 추가</strong> 버튼으로 첫 번째 학생을 등록해보세요!
        </div>
      </div>
    `
    document.getElementById('btn-add-student').onclick = showAddStudentModal
    return
  }

  const cards = students.map(s => {
    const rank = rankInfo(s.rank)
    const pending = s.pending_choice_count > 0
    const hasImg = hasAvatarImage(s)
    const bgStyle = hasImg ? '' : `background: linear-gradient(135deg, ${avatarColor(s)}, ${avatarColor(s)}cc);`
    const avatarCls = hasImg ? 'avatar-photo' : (s.avatar_emoji ? 'avatar-emoji' : '')
    return `
      <div class="student-card card-v2 ${pending ? 'has-pending' : ''}" data-id="${s.id}">
        <div class="avatar avatar-card ${avatarCls}" style="${bgStyle}">
          ${avatarContent(s)}
        </div>
        ${displayNameHtml(s, { size: 'lg' })}
        <span class="rank-badge rank-badge-lg ${rank.cls}">${rank.icon} ${rank.label}</span>
        <span class="level-pill level-pill-sm">Lv.${s.level}</span>
      </div>
    `
  }).join('')

  // === 학급 전체 경험치 (학생 xp 합계 + 보정치) ===
  const totalStudentXp = students.reduce((sum, s) => sum + (Number(s.xp) || 0), 0)
  const bonusXp = Number(state.bonusXp) || 0
  const classTotalXp = totalStudentXp + bonusXp
  const bonusText = bonusXp
    ? ` · 보너스 ${bonusXp > 0 ? '+' : '−'}${Math.abs(bonusXp).toLocaleString()}`
    : ''

  // === 순위 (경험치 내림차순) ===
  const ranked = [...students].sort((a, b) => (Number(b.xp) || 0) - (Number(a.xp) || 0))
  const rankRows = ranked.map((s, i) => rankRowHtml(s, i)).join('')

  main.innerHTML = `
    <div class="view-container list-view">
      <div class="view-title">
        <span>🏰</span> ${className}
        <span class="class-meta">${students.length}명</span>
        <button class="btn-add-student" id="btn-add-student">+ 학생</button>
      </div>

      <div class="class-xp-banner">
        <div class="cxp-main">
          <div class="cxp-label"><span class="cxp-emoji">🏫</span> 학급 전체 경험치</div>
          <div class="cxp-value">${classTotalXp.toLocaleString()}<span class="cxp-unit">XP</span></div>
          <div class="cxp-breakdown">학생 합계 ${totalStudentXp.toLocaleString()}${bonusText}</div>
        </div>
        <button class="cxp-adjust-btn" id="btn-class-xp">
          <i class="fa-solid fa-scale-balanced"></i> 조정
        </button>
      </div>

      <div class="student-grid">${cards}</div>

      <div class="rank-banner">
        <div class="rank-banner-title"><span>🏆</span> 학급 순위</div>
        <ol class="rank-list">${rankRows}</ol>
      </div>
    </div>
  `

  document.getElementById('btn-add-student').onclick = showAddStudentModal
  document.getElementById('btn-class-xp').onclick = showClassXpModal

  main.querySelectorAll('.student-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.id
      navigate('detail', { studentId: id })
    })
  })

  main.querySelectorAll('.rank-item').forEach(item => {
    item.addEventListener('click', () => {
      navigate('detail', { studentId: item.dataset.id })
    })
  })
}

// 순위 배너의 한 줄 (i: 0-based 순위 인덱스)
function rankRowHtml(s, i) {
  const medals = ['🥇', '🥈', '🥉']
  const badge = i < 3
    ? `<span class="rank-medal">${medals[i]}</span>`
    : `<span class="rank-num">${i + 1}</span>`
  const hasImg = hasAvatarImage(s)
  const bgStyle = hasImg ? '' : `background: linear-gradient(135deg, ${avatarColor(s)}, ${avatarColor(s)}cc);`
  const avatarCls = hasImg ? 'avatar-photo' : (s.avatar_emoji ? 'avatar-emoji' : '')
  const rank = rankInfo(s.rank)
  const name = escapeHtml(s.nickname || s.name || '')
  return `
    <li class="rank-item ${i < 3 ? 'rank-top' : ''}" data-id="${s.id}">
      ${badge}
      <div class="rank-avatar avatar ${avatarCls}" style="${bgStyle}">${avatarContent(s)}</div>
      <div class="rank-info">
        <div class="rank-name">${name}</div>
        <div class="rank-sub">Lv.${s.level} · ${rank.icon} ${rank.label}</div>
      </div>
      <div class="rank-xp">${(Number(s.xp) || 0).toLocaleString()}<span class="rank-xp-unit">XP</span></div>
    </li>
  `
}

// ==============================
// 학급 전체 경험치 조정 모달 (보상 + / 차감 −)
//  - 개별 학생 xp 는 변하지 않고 학급 보정치(bonus_xp)만 조정
// ==============================
function showClassXpModal() {
  const container = document.getElementById('modal-container')
  const totalStudentXp = state.students.reduce((sum, s) => sum + (Number(s.xp) || 0), 0)
  const bonusXp = Number(state.bonusXp) || 0
  const classTotalXp = totalStudentXp + bonusXp
  container.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal">
        <div class="modal-title">🏫 학급 전체 경험치 조정</div>
        <div class="cxp-modal-current">
          현재 <strong>${classTotalXp.toLocaleString()} XP</strong>
          <span class="cxp-modal-hint">(학생 합계 ${totalStudentXp.toLocaleString()} · 보너스 ${bonusXp.toLocaleString()})</span>
        </div>
        <div class="cxp-preset-row">
          <button class="cxp-preset cxp-plus" data-v="100">+100</button>
          <button class="cxp-preset cxp-plus" data-v="500">+500</button>
          <button class="cxp-preset cxp-plus" data-v="1000">+1000</button>
          <button class="cxp-preset cxp-minus" data-v="-100">−100</button>
          <button class="cxp-preset cxp-minus" data-v="-500">−500</button>
          <button class="cxp-preset cxp-minus" data-v="-1000">−1000</button>
        </div>
        <div style="margin-top:10px;">
          <label style="font-size:12px; color:var(--text-light); font-weight:bold;">직접 입력 (음수면 차감)</label>
          <input type="number" id="cxp-delta" placeholder="예: 200 또는 -150"
            style="width:100%; padding:10px; border:2px solid var(--card-border-dim); border-radius:10px; font-family:inherit; font-size:14px; margin-top:4px; background:var(--bg-base); color:var(--text);" />
        </div>
        <div class="cxp-note">※ 개별 학생 경험치는 변하지 않고, 학급 전체 값만 조정됩니다.</div>
        <div class="modal-actions">
          <button class="btn-cancel" id="modal-cancel">취소</button>
          <button class="btn-confirm" id="modal-confirm">적용</button>
        </div>
      </div>
    </div>
  `
  const deltaInput = document.getElementById('cxp-delta')
  container.querySelectorAll('.cxp-preset').forEach(b => {
    b.onclick = () => { deltaInput.value = b.dataset.v; deltaInput.focus() }
  })
  document.getElementById('modal-cancel').onclick = () => { container.innerHTML = '' }
  document.getElementById('modal-confirm').onclick = async () => {
    const delta = Math.trunc(Number(deltaInput.value) || 0)
    if (!delta) { showToast('조정할 경험치를 입력해주세요', 'warning'); return }
    container.innerHTML = ''
    await adjustClassXp(delta)
  }
  setTimeout(() => deltaInput.focus(), 50)
}

async function adjustClassXp(delta) {
  try {
    const res = await api(`/api/classes/${state.classId}/class-xp`, {
      method: 'POST',
      body: JSON.stringify({ delta }),
    })
    state.bonusXp = Number(res.bonus_xp || 0)
    delta > 0 ? Sound.scoreUp() : Sound.scoreDown()
    showToast(
      `학급 경험치 ${delta > 0 ? '+' : '−'}${Math.abs(delta).toLocaleString()} 적용`,
      delta > 0 ? 'success' : 'warning',
      delta > 0 ? '🎁' : '➖',
    )
    await renderList()
  } catch (e) {
    showToast('조정 실패: ' + e.message, 'error')
  }
}

// ==============================
// 학생 추가 모달 (한 명 / 붙여넣기 / 엑셀 업로드 3개 탭)
// ==============================
function showAddStudentModal() {
  const container = document.getElementById('modal-container')
  let tab = 'single'        // 'single' | 'paste' | 'file'
  let parsedNames = []      // 미리보기에 보여줄 이름 배열 (paste / file 공용)

  function render() {
    container.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal modal-wide">
          <div class="modal-title">👤 학생 추가</div>

          <div class="add-tabs">
            <button class="add-tab ${tab === 'single' ? 'active' : ''}" data-tab="single">
              <i class="fa-solid fa-user-plus"></i> 한 명씩
            </button>
            <button class="add-tab ${tab === 'paste' ? 'active' : ''}" data-tab="paste">
              <i class="fa-solid fa-paste"></i> 붙여넣기
            </button>
            <button class="add-tab ${tab === 'file' ? 'active' : ''}" data-tab="file">
              <i class="fa-solid fa-file-excel"></i> 엑셀 파일
            </button>
          </div>

          <div class="add-tab-body">
            ${tabBody()}
          </div>

          <div class="modal-actions">
            <button type="button" class="btn-cancel" id="add-student-cancel">취소</button>
            ${actionButton()}
          </div>
        </div>
      </div>
    `

    // 탭 클릭 → 미리보기 초기화하고 다시 그리기
    container.querySelectorAll('.add-tab').forEach(b => {
      b.onclick = () => {
        tab = b.dataset.tab
        parsedNames = []
        render()
      }
    })
    document.getElementById('add-student-cancel').onclick = () => container.innerHTML = ''

    bindTabBody()
  }

  function tabBody() {
    if (tab === 'single') {
      return `
        <div class="add-mode-desc">학생 한 명을 빠르게 추가해요.</div>
        <label class="auth-label">
          <span>학생 이름</span>
          <input type="text" id="single-name" maxlength="20" placeholder="예: 김민준" />
        </label>
      `
    }
    if (tab === 'paste') {
      return `
        <div class="add-mode-desc">
          엑셀이나 한글 문서에서 이름들을 복사한 뒤 아래 칸에 붙여넣으세요.<br/>
          <strong>줄바꿈, 쉼표(,), 탭</strong>으로 자동 구분돼요.
        </div>
        <textarea id="paste-area" rows="7" placeholder="김민준&#10;이서연&#10;박지호&#10;...&#10;&#10;또는: 김민준, 이서연, 박지호"></textarea>
        ${previewHtml()}
      `
    }
    // file
    return `
      <div class="add-mode-desc">
        엑셀(.xlsx / .xls) 또는 CSV 파일을 업로드하세요.<br/>
        <strong>첫 번째 열의 모든 이름</strong>을 자동으로 읽어옵니다.
        (헤더 행에 "이름" 또는 "name"이 있으면 자동으로 건너뛰어요)
      </div>
      <label class="file-drop">
        <input type="file" id="file-input" accept=".xlsx,.xls,.csv" hidden />
        <div class="file-drop-inner">
          <i class="fa-solid fa-file-arrow-up"></i>
          <div class="file-drop-label">엑셀/CSV 파일 선택</div>
          <div class="file-drop-name" id="file-drop-name">파일을 선택하거나 여기로 드래그</div>
        </div>
      </label>
      ${previewHtml()}
    `
  }

  function previewHtml() {
    if (parsedNames.length === 0) return ''
    const preview = parsedNames.slice(0, 50)
    const more = parsedNames.length - preview.length
    return `
      <div class="preview-section">
        <div class="preview-title">
          <i class="fa-solid fa-list-check"></i> 추가될 학생 ${parsedNames.length}명
          ${parsedNames.length > 100 ? '<span class="preview-warn">⚠ 한 번에 100명까지만 가능해요</span>' : ''}
        </div>
        <div class="preview-chips">
          ${preview.map((n, i) => `<span class="preview-chip"><span class="preview-num">${i + 1}</span>${escapeHtml(n)}</span>`).join('')}
          ${more > 0 ? `<span class="preview-more">+${more}명 더</span>` : ''}
        </div>
      </div>
    `
  }

  function actionButton() {
    if (tab === 'single') {
      return `<button type="button" class="btn-confirm" id="action-btn">추가</button>`
    }
    const disabled = parsedNames.length === 0 || parsedNames.length > 100
    return `<button type="button" class="btn-confirm" id="action-btn" ${disabled ? 'disabled' : ''}>
      ${parsedNames.length > 0 ? `${parsedNames.length}명 전체 추가` : '추가'}
    </button>`
  }

  function bindTabBody() {
    if (tab === 'single') {
      const input = document.getElementById('single-name')
      setTimeout(() => input.focus(), 50)
      input.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          document.getElementById('action-btn').click()
        }
      }
      document.getElementById('action-btn').onclick = async () => {
        const name = input.value.trim()
        if (!name) return showToast('이름을 입력해주세요', 'error')
        await submitSingle(name)
      }
    } else if (tab === 'paste') {
      const ta = document.getElementById('paste-area')
      setTimeout(() => ta.focus(), 50)
      ta.oninput = () => {
        parsedNames = parseNamesFromText(ta.value)
        // 미리보기 + 버튼만 다시 그리기 (재초점 손실 방지)
        updatePreviewAndAction()
      }
      document.getElementById('action-btn').onclick = submitBulk
    } else {
      const fi = document.getElementById('file-input')
      const dropZone = document.querySelector('.file-drop')

      fi.onchange = () => handleFile(fi.files?.[0])
      // 드래그앤드롭
      dropZone.ondragover = (e) => { e.preventDefault(); dropZone.classList.add('drag-over') }
      dropZone.ondragleave = () => dropZone.classList.remove('drag-over')
      dropZone.ondrop = (e) => {
        e.preventDefault()
        dropZone.classList.remove('drag-over')
        handleFile(e.dataTransfer.files?.[0])
      }
      document.getElementById('action-btn').onclick = submitBulk
    }
  }

  function updatePreviewAndAction() {
    // 탭 본체 안에서 .preview-section과 액션 버튼만 다시 그림
    const body = container.querySelector('.add-tab-body')
    const oldPreview = body.querySelector('.preview-section')
    const previewWrap = document.createElement('div')
    previewWrap.innerHTML = previewHtml()
    const newPreview = previewWrap.firstElementChild
    if (oldPreview && newPreview) oldPreview.replaceWith(newPreview)
    else if (oldPreview && !newPreview) oldPreview.remove()
    else if (!oldPreview && newPreview) body.appendChild(newPreview)

    // 액션 버튼 다시 그리기
    const actions = container.querySelector('.modal-actions')
    const oldBtn = document.getElementById('action-btn')
    const tmp = document.createElement('div')
    tmp.innerHTML = actionButton()
    const newBtn = tmp.firstElementChild
    oldBtn.replaceWith(newBtn)
    newBtn.onclick = submitBulk
  }

  async function handleFile(file) {
    if (!file) return
    const nameEl = document.getElementById('file-drop-name')
    nameEl.textContent = file.name
    try {
      const names = await parseSpreadsheetFile(file)
      parsedNames = names
      updatePreviewAndAction()
      if (names.length === 0) {
        showToast('파일에서 이름을 찾지 못했어요', 'error')
      } else {
        showToast(`${names.length}명을 찾았어요!`, 'success', '📑')
      }
    } catch (e) {
      console.error(e)
      showToast('파일을 읽지 못했어요: ' + e.message, 'error')
    }
  }

  async function submitSingle(name) {
    const btn = document.getElementById('action-btn')
    btn.disabled = true
    btn.textContent = '추가 중...'
    try {
      await api(`/api/classes/${state.classId}/students`, {
        method: 'POST',
        body: JSON.stringify({ name }),
      })
      container.innerHTML = ''
      showToast(`${name} 학생이 추가되었어요!`, 'success', '👤')
      await renderList()
    } catch (err) {
      showToast(err.message, 'error')
      btn.disabled = false
      btn.textContent = '추가'
    }
  }

  async function submitBulk() {
    if (parsedNames.length === 0) {
      return showToast('추가할 이름이 없어요', 'error')
    }
    if (parsedNames.length > 100) {
      return showToast('한 번에 100명까지만 가능해요', 'error')
    }
    const btn = document.getElementById('action-btn')
    btn.disabled = true
    btn.textContent = '추가 중...'
    try {
      const r = await api(`/api/classes/${state.classId}/students/bulk`, {
        method: 'POST',
        body: JSON.stringify({ names: parsedNames }),
      })
      container.innerHTML = ''
      showToast(`${r.count}명을 한 번에 추가했어요!`, 'success', '🎉')
      await renderList()
    } catch (err) {
      showToast(err.message, 'error')
      btn.disabled = false
      btn.textContent = `${parsedNames.length}명 전체 추가`
    }
  }

  render()
}

// 텍스트(붙여넣기)에서 이름 배열 파싱
//  - 줄바꿈/쉼표/탭/세미콜론으로 분리
//  - 앞뒤 공백 제거, 빈 토큰 제외
//  - 번호("1.", "1)", "01")가 앞에 붙어 있으면 제거
function parseNamesFromText(text) {
  if (!text) return []
  return text
    .split(/[\n,;\t]+/)
    .map(s => s.trim())
    .map(s => s.replace(/^\d+\s*[.)、]\s*/, '')) // "1. 김민준" → "김민준"
    .map(s => s.replace(/^\d+\s+/, ''))            // "01 김민준" → "김민준" (출석번호 + 공백 + 이름)
    .map(s => s.trim())
    .filter(s => s.length > 0 && s.length <= 30)
}

// 엑셀/CSV 파일에서 이름 배열 파싱 (첫 번째 열만 사용)
async function parseSpreadsheetFile(file) {
  if (typeof XLSX === 'undefined') {
    throw new Error('엑셀 라이브러리를 불러오는 중이에요. 잠시 후 다시 시도해주세요.')
  }
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) throw new Error('빈 파일입니다')
  const sheet = wb.Sheets[sheetName]
  // header:1 → 배열의 배열, defval:'' → 빈 셀도 빈 문자열로
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: false })

  if (!rows.length) return []

  // 첫 행이 헤더("이름"/"name"/"성명")이면 건너뛰기
  const firstCell = String(rows[0][0] || '').trim().toLowerCase()
  const isHeader = /^(이름|성명|학생\s*명|name|student\s*name)$/i.test(firstCell)
  const dataRows = isHeader ? rows.slice(1) : rows

  // 첫 번째 열의 값만 모으기
  return dataRows
    .map(r => String(r[0] || '').trim())
    .map(s => s.replace(/^\d+\s*[.)、]\s*/, ''))
    .map(s => s.replace(/^\d+\s+/, ''))
    .map(s => s.trim())
    .filter(s => s.length > 0 && s.length <= 30)
}

// ==============================
// 화면 2: 학생 상세
// ==============================
async function renderDetail(id) {
  // 학생 데이터와 활동 목록을 병렬로 로드 (활동은 캐시)
  const [s, activities] = await Promise.all([
    api(`/api/students/${id}`),
    state.activities.length ? Promise.resolve(state.activities) : api(`/api/classes/${state.classId}/activities`),
  ])
  state.activities = activities
  const rank = rankInfo(s.rank)

  // XP 진행률 계산
  const cur = s.current_required_xp
  const nxt = s.next_required_xp
  let pct = 100
  let xpToNext = 0
  if (nxt != null) {
    const range = nxt - cur
    const into = s.xp - cur
    pct = range > 0 ? Math.max(0, Math.min(100, (into / range) * 100)) : 0
    xpToNext = nxt - s.xp
  }

  // HP 하트
  const hearts = []
  for (let i = 0; i < s.max_hp; i++) {
    const full = i < s.hp
    hearts.push(`<span class="heart ${full ? 'full' : 'empty'}">${full ? '❤️' : '🩶'}</span>`)
  }

  // 점수 버튼 (Supabase의 activities에서 로드. emoji 컬럼 > 이름 기반 자동)
  const scoreBtns = activities.map(a => {
    const emoji = activityEmoji(a)   // 객체를 통째로 → emoji 컬럼 우선
    if (a.is_custom_input) {
      return `
        <button class="score-btn custom" data-activity-id="${a.id}" data-custom="1" data-name="${escapeHtml(a.name)}">
          <div class="emoji">${emoji}</div>
          <div class="label">${escapeHtml(a.name)}</div>
          <div class="delta" style="background:rgba(192,132,252,0.2);color:#ddd6fe;border:1px solid rgba(192,132,252,0.4);">직접 입력</div>
        </button>
      `
    }
    const type = a.score_delta >= 0 ? 'positive' : 'negative'
    return `
      <button class="score-btn ${type}" data-activity-id="${a.id}" data-name="${escapeHtml(a.name)}" data-delta="${a.score_delta}">
        <div class="emoji">${emoji}</div>
        <div class="label">${escapeHtml(a.name)}</div>
        <div class="delta ${a.score_delta >= 0 ? 'delta-pos' : 'delta-neg'}">${a.score_delta >= 0 ? '+' : ''}${a.score_delta} XP</div>
      </button>
    `
  }).join('')

  // 선택 대기 (uid 기반)
  const choices = (s.pending_choices || []).map(pc => `
    <div class="choice-card">
      <div class="choice-title">🎁 Lv.${pc.level} 보상 선택</div>
      <div class="choice-sub">${escapeHtml(pc.reward_desc || '아래 두 보상 중 하나를 골라주세요')}</div>
      <div class="choice-options">
        <button class="choice-option" data-choice-uid="${pc.uid}" data-pick="A">
          <span class="opt-label">A</span>
          ${escapeHtml(pc.choice_a)}
        </button>
        <button class="choice-option" data-choice-uid="${pc.uid}" data-pick="B">
          <span class="opt-label">B</span>
          ${escapeHtml(pc.choice_b)}
        </button>
      </div>
    </div>
  `).join('')

  // 보유 스킬 (uid 기반)
  const skills = (s.skills || []).map(sk => `
    <div class="skill-card">
      <div class="skill-icon">${skillEmoji(sk.skill_name)}</div>
      <div class="skill-info">
        <div class="skill-name">${escapeHtml(sk.skill_name)}</div>
        <div class="skill-source">Lv.${sk.source_level} 보상</div>
      </div>
      <button class="use-btn" data-skill-uid="${sk.uid}" data-skill-name="${escapeHtml(sk.skill_name)}">사용하기</button>
    </div>
  `).join('')

  const passiveSkill = s.passive_skill || '없음'

  const main = document.getElementById('main-view')
  const heroHasImg = hasAvatarImage(s)
  const heroBgStyle = heroHasImg ? '' : `background: linear-gradient(135deg, ${avatarColor(s)}, ${avatarColor(s)}cc);`
  const heroAvatarCls = heroHasImg ? 'avatar-photo' : (s.avatar_emoji ? 'avatar-emoji' : '')
  main.innerHTML = `
    <div class="view-container">
      <!-- 캐릭터 헤로 -->
      <div class="detail-hero">
        <button class="detail-hero-delete" id="student-delete-btn" title="학생 삭제" aria-label="학생 삭제">
          <i class="fa-solid fa-trash-can"></i>
          <span>학생 삭제</span>
        </button>
        <button class="avatar avatar-lg ${heroAvatarCls}"
                id="avatar-edit-btn"
                style="${heroBgStyle}"
                title="아바타 꾸미기">
          ${avatarContent(s)}
          <span class="avatar-edit-icon">✏️</span>
        </button>
        <div class="detail-name-wrap">
          ${s.nickname
            ? `<div class="detail-nickname">${escapeHtml(s.nickname)}</div>
               <div class="detail-realname">${escapeHtml(s.name)}</div>`
            : `<div class="detail-nickname">${escapeHtml(s.name)}</div>
               <div class="detail-realname-empty">닉네임 없음</div>`
          }
          <button class="btn-edit-nickname" id="nickname-edit-btn">
            <i class="fa-solid fa-pen"></i> ${s.nickname ? '닉네임 수정' : '닉네임 정하기'}
          </button>
        </div>
        <div class="detail-badges">
          <span class="level-pill" style="font-size:14px; padding:4px 12px;">Lv.${s.level}</span>
          <span class="rank-badge ${rank.cls}" style="font-size:14px; padding:4px 12px;">${rank.icon} ${rank.label}</span>
        </div>

        <div class="hp-row">
          <span class="hp-label">HP</span>
          <div class="hp-hearts">${hearts.join('')}</div>
          <div class="hp-controls">
            <button id="hp-minus">−</button>
            <button id="hp-plus">+</button>
          </div>
        </div>

        <div class="xp-section">
          <div class="xp-info">
            <span class="xp-current">XP ${s.xp}</span>
            <span>${nxt != null ? `다음 레벨까지 ${xpToNext} XP` : '🌟 최고 레벨'}</span>
          </div>
          <div class="xp-bar-bg">
            <div class="xp-bar-fg" style="width: ${pct}%;"></div>
          </div>
        </div>
      </div>

      ${choices}

      <!-- 점수 주기 -->
      <div class="section-card">
        <div class="section-title"><span>⚡</span> 점수 주기</div>
        <div class="score-grid">${scoreBtns}</div>
      </div>

      <!-- 패시브 스킬 -->
      <div class="section-card">
        <div class="section-title"><span>🛡️</span> 패시브 스킬 (상시)</div>
        <div class="passive-card">
          <div class="passive-icon">${passiveEmoji(passiveSkill)}</div>
          <div class="passive-info">
            <div class="passive-label">현재 레벨 ${s.level} 패시브</div>
            <div class="passive-name">${escapeHtml(passiveSkill)}</div>
          </div>
        </div>
      </div>

      <!-- 보유 스킬 (해금) -->
      <div class="section-card">
        <div class="section-title">
          <span>🎁</span> 보유 스킬 (해금·소모)
          <span class="count-pill">${(s.skills || []).length}</span>
        </div>
        ${(s.skills || []).length === 0
          ? `<div class="empty-state">아직 보유한 스킬이 없어요.<br/>레벨을 올리면 스킬이 쌓여요!</div>`
          : `<div class="skill-list">${skills}</div>`}
      </div>
    </div>
  `

  // 이벤트 바인딩
  document.getElementById('avatar-edit-btn').onclick = () => showAvatarPicker(s)
  document.getElementById('nickname-edit-btn').onclick = () => showNicknameEditor(s)
  document.getElementById('student-delete-btn').onclick = () => {
    const displayName = s.nickname ? `${s.nickname} (${s.name})` : s.name
    showConfirm(
      `'${displayName}' 학생 삭제`,
      `정말 이 학생을 삭제할까요?\n학생의 모든 활동 기록·보유 스킬·아바타도 함께 사라지며, 되돌릴 수 없어요.`,
      async () => {
        try {
          await api(`/api/students/${s.id}`, { method: 'DELETE' })
          showToast(`${displayName} 학생을 삭제했어요`, 'success', '🗑️')
          state.activities = []  // 안전하게 캐시 초기화
          navigate('list')
        } catch (e) {
          showToast(e.message, 'error')
        }
      }
    )
  }

  main.querySelectorAll('.score-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.custom === '1') {
        showCustomScorePrompt(id, btn.dataset.name)
      } else {
        addScore(id, btn.dataset.name, Number(btn.dataset.delta))
      }
    })
  })

  document.getElementById('hp-minus').onclick = () => adjustHp(id, -1)
  document.getElementById('hp-plus').onclick = () => adjustHp(id, +1)

  main.querySelectorAll('.use-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const skillUid = btn.dataset.skillUid
      const name = btn.dataset.skillName
      showConfirm(
        `${name} 사용`,
        '이 스킬은 한 번 사용하면 사라집니다. 사용할까요?',
        () => useSkill(id, skillUid, name)
      )
    })
  })

  main.querySelectorAll('.choice-option').forEach(btn => {
    btn.addEventListener('click', () => {
      const choiceUid = btn.dataset.choiceUid
      const pick = btn.dataset.pick
      resolveChoice(id, choiceUid, pick)
    })
  })
}

async function addScore(studentId, name, delta) {
  try {
    const res = await api(`/api/students/${studentId}/score`, {
      method: 'POST',
      body: JSON.stringify({ activity_name: name, score_delta: delta }),
    })
    showToast(`${name} ${delta >= 0 ? '+' : ''}${delta} XP`, delta >= 0 ? 'success' : 'warning', activityEmoji(name))
    delta >= 0 ? Sound.scoreUp() : Sound.scoreDown()

    if (res.leveled_up) {
      setTimeout(() => Sound.levelUp(), 240)
      setTimeout(() => {
        showToast(`🎉 레벨 ${res.new_level} 달성!`, 'level-up', '🎉')
      }, 300)
      if (res.new_skills && res.new_skills.length > 0) {
        setTimeout(() => Sound.skillGet(), 640)
        res.new_skills.forEach((skillName, i) => {
          setTimeout(() => {
            showToast(`새 스킬: ${skillName}`, 'level-up', '🎁')
          }, 600 + i * 400)
        })
      }
      if (res.new_pending_choices && res.new_pending_choices.length > 0) {
        res.new_pending_choices.forEach((pc, i) => {
          setTimeout(() => {
            showToast(`Lv.${pc.level} 보상을 선택하세요!`, 'level-up', '✨')
          }, 600 + (res.new_skills?.length || 0) * 400 + i * 400)
        })
      }
    }

    await renderDetail(studentId)
  } catch (e) {
    showToast(e.message, 'error')
  }
}

async function adjustHp(studentId, delta) {
  try {
    await api(`/api/students/${studentId}/hp`, {
      method: 'POST',
      body: JSON.stringify({ delta }),
    })
    delta >= 0 ? Sound.hpUp() : Sound.hpDown()
    await renderDetail(studentId)
  } catch (e) {
    showToast(e.message, 'error')
  }
}

async function useSkill(studentId, skillUid, name) {
  try {
    await api(`/api/students/${studentId}/skills/${skillUid}/use`, { method: 'POST' })
    showToast(`${name} 스킬을 사용했어요!`, 'success', '✨')
    Sound.skillUse()
    await renderDetail(studentId)
  } catch (e) {
    showToast(e.message, 'error')
  }
}

async function resolveChoice(studentId, choiceUid, pick) {
  try {
    const res = await api(`/api/students/${studentId}/choices/${choiceUid}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ pick }),
    })
    showToast(`보상 획득: ${res.picked}`, 'level-up', '🎁')
    Sound.skillGet()
    await renderDetail(studentId)
  } catch (e) {
    showToast(e.message, 'error')
  }
}

// ==============================
// 화면 3: 활동 기록
// ==============================
async function renderLogs() {
  const logs = await api(`/api/classes/${state.classId}/logs?limit=300`)

  const main = document.getElementById('main-view')

  if (logs.length === 0) {
    main.innerHTML = `
      <div class="view-container">
        <div class="view-title"><span>📜</span> 활동 기록</div>
        <div class="empty-state">아직 활동이 없어요.</div>
      </div>
    `
    return
  }

  const items = logs.map(l => {
    let deltaHtml = ''
    if (l.log_type === 'score' && l.score_delta !== 0) {
      const cls = l.score_delta > 0 ? 'delta-pos' : 'delta-neg'
      deltaHtml = `<span class="log-delta ${cls}">${l.score_delta > 0 ? '+' : ''}${l.score_delta} XP</span>`
    } else if (l.log_type === 'level_up') {
      deltaHtml = `<span class="log-delta delta-pos">레벨업!</span>`
    } else if (l.log_type === 'skill_use') {
      deltaHtml = `<span class="log-delta" style="background:#fef3c7;color:#92400e;">사용</span>`
    } else if (l.log_type === 'skill_choice') {
      deltaHtml = `<span class="log-delta" style="background:#ede9fe;color:#6d28d9;">선택</span>`
    }

    const displayName = l.student_nickname || l.student_name
    const logStudent = {
      avatar_image: l.avatar_image,
      avatar_emoji: l.avatar_emoji,
      avatar_color: l.avatar_color,
      id: l.student_id,
      name: l.student_name,
    }
    const logHasImg = hasAvatarImage(logStudent)
    const logCls = logHasImg ? 'avatar-photo' : (l.avatar_emoji ? 'avatar-emoji' : '')
    const logBg = logHasImg ? '' : `background: linear-gradient(135deg, ${avatarColor(logStudent)}, ${avatarColor(logStudent)}cc);`
    return `
      <div class="log-item">
        <div class="log-avatar ${logCls}" style="${logBg}">
          ${avatarContent(logStudent)}
        </div>
        <div class="log-content">
          <div class="log-line1">
            <span class="log-type-icon">${activityEmoji(l.activity_name)}</span>
            <span class="log-name">${escapeHtml(displayName)}</span>
            <span class="log-activity">${escapeHtml(l.activity_name)}</span>
          </div>
          <div class="log-time">${formatTime(l.created_at)}</div>
        </div>
        ${deltaHtml}
      </div>
    `
  }).join('')

  main.innerHTML = `
    <div class="view-container">
      <div class="view-title">
        <span>📜</span> 활동 기록
        <span style="margin-left:auto; font-size:14px; color:var(--text-light); font-weight:normal;">${logs.length}건</span>
      </div>
      <div class="log-list">${items}</div>
    </div>
  `
}

// ==============================
// 화면 4: 설정 (활동 점수 / 스킬 내용만 편집)
// 게임 뼈대(레벨별 기준 XP, 등급 구간, HP 규칙)는 고정.
// ==============================
async function renderSettings() {
  const main = document.getElementById('main-view')

  main.innerHTML = `
    <div class="view-container">
      <div class="view-title"><span>⚙️</span> 교사 설정</div>

      <div class="settings-tabs">
        <button class="settings-tab ${state.settingsTab === 'activities' ? 'active' : ''}" data-tab="activities">
          ⚡ 활동 점수
        </button>
        <button class="settings-tab ${state.settingsTab === 'levels' ? 'active' : ''}" data-tab="levels">
          🏅 레벨·등급
        </button>
        <button class="settings-tab ${state.settingsTab === 'skills' ? 'active' : ''}" data-tab="skills">
          🎁 스킬 내용
        </button>
      </div>

      <div id="settings-body"></div>
    </div>
  `

  // 탭 전환
  main.querySelectorAll('.settings-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      state.settingsTab = btn.dataset.tab
      renderSettings()
    })
  })

  if (state.settingsTab === 'activities') {
    await renderActivitiesSettings()
  } else if (state.settingsTab === 'levels') {
    await renderLevelsSettings()
  } else {
    await renderSkillsSettings()
  }
}

// ----- 레벨 기준 XP / 등급 구간 편집 -----
//  각 레벨의 "기준 XP"(그 레벨이 되는 데 필요한 누적 경험치)와 "등급"을 바로 수정.
//  가독성: 등급별 색 구분 + 큰 입력칸 + 등급 3버튼(원탭) + 자동 저장.
async function renderLevelsSettings() {
  const body = document.getElementById('settings-body')
  body.innerHTML = '<div class="hint-text">불러오는 중...</div>'

  const levels = await api(`/api/classes/${state.classId}/level-table`)
  state.levelTable = levels

  const GRADES = [
    { key: '브론즈', rank: 'bronze', icon: '🥉' },
    { key: '실버', rank: 'silver', icon: '🥈' },
    { key: '골드', rank: 'gold', icon: '🥇' },
  ]

  const rows = levels.map(lv => {
    const rank = lv.rank
    const isFirst = lv.level === 1
    const segBtns = GRADES.map(g => `
      <button type="button" class="grade-seg-btn ${g.rank} ${lv.grade === g.key ? 'active' : ''}"
        data-grade="${g.key}" title="${g.key}">
        <span class="gseg-icon">${g.icon}</span><span class="gseg-label">${g.key}</span>
      </button>`).join('')
    return `
      <div class="level-edit-item rank-${rank}" data-level="${lv.level}">
        <div class="lvl-left">
          <span class="lvl-pill">Lv.${lv.level}</span>
        </div>
        <div class="lvl-xp">
          <label>기준 XP</label>
          <input type="number" class="f-minxp" value="${lv.min_xp}" min="0" step="10"
            ${isFirst ? 'readonly title="레벨 1은 항상 0"' : ''} />
        </div>
        <div class="lvl-grade">
          <label>등급</label>
          <div class="grade-seg">${segBtns}</div>
        </div>
      </div>
    `
  }).join('')

  body.innerHTML = `
    <div class="hint-text settings-hint-info">
      🏅 각 레벨이 되는 데 필요한 <b>기준 XP</b>와 <b>등급</b>을 직접 바꿀 수 있어요.<br/>
      • 기준 XP: 칸을 눌러 숫자 입력 → 다른 곳을 누르면 <b>자동 저장</b> (이전·다음 레벨 사이 값이어야 함)<br/>
      • 등급: <b>🥉/🥈/🥉 버튼을 한 번 누르면</b> 그 레벨 등급이 바로 바뀜 → 등급 구간 조절
    </div>
    <div class="level-edit-list">${rows}</div>
    <div class="hint-text" style="margin-top:8px;">
      💡 레벨 1의 기준 XP는 항상 0이에요. 바꾼 값은 모든 학생의 레벨·등급 계산에 바로 반영됩니다.
    </div>
  `

  // 기준 XP 자동 저장 (blur)
  body.querySelectorAll('.level-edit-item').forEach(item => {
    const level = Number(item.dataset.level)
    const xpInput = item.querySelector('.f-minxp')

    if (xpInput && !xpInput.readOnly) {
      xpInput.addEventListener('blur', async () => {
        const val = Math.trunc(Number(xpInput.value))
        const prev = (state.levelTable.find(l => l.level === level) || {}).min_xp
        if (val === prev) return
        try {
          await api(`/api/classes/${state.classId}/level-table/${level}`, {
            method: 'PUT',
            body: JSON.stringify({ min_xp: val }),
          })
          const row = state.levelTable.find(l => l.level === level)
          if (row) row.min_xp = val
          flashSaved(item)
        } catch (e) {
          showToast(e.message, 'error')
          xpInput.value = prev   // 실패 시 원복
        }
      })
    }

    // 등급 버튼 (원탭 저장)
    item.querySelectorAll('.grade-seg-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const grade = btn.dataset.grade
        const row = state.levelTable.find(l => l.level === level)
        if (row && row.grade === grade) return
        try {
          await api(`/api/classes/${state.classId}/level-table/${level}`, {
            method: 'PUT',
            body: JSON.stringify({ grade }),
          })
          if (row) { row.grade = grade; row.rank = grade === '골드' ? 'gold' : grade === '실버' ? 'silver' : 'bronze' }
          // 버튼 활성 상태 갱신
          item.querySelectorAll('.grade-seg-btn').forEach(b => b.classList.toggle('active', b === btn))
          // 행 색상 갱신
          item.className = `level-edit-item rank-${row ? row.rank : 'bronze'}`
          flashSaved(item)
        } catch (e) {
          showToast(e.message, 'error')
        }
      })
    })
  })
}

// 저장 성공 시 잔잔한 초록 플래시
function flashSaved(el) {
  el.style.transition = 'background 0.3s'
  el.style.background = 'rgba(74, 222, 128, 0.16)'
  setTimeout(() => { el.style.background = '' }, 600)
}

// ----- 활동 점수 편집 -----
async function renderActivitiesSettings() {
  const body = document.getElementById('settings-body')
  body.innerHTML = '<div class="hint-text">불러오는 중...</div>'

  const activities = await api(`/api/classes/${state.classId}/activities`)
  state.activities = activities

  // 각 활동 row를 그릴 때 emoji 컬럼(또는 자동 추천) 사용
  // - 이모지 박스 클릭 → 이모지 피커 모달
  // - 활동명 변경 시: emoji가 비어 있으면 새 이름으로 자동 추천된 이모지를 같이 저장
  const rows = activities.map(a => {
    const em = activityEmoji(a)
    return `
      <div class="activity-edit-item ${a.is_custom_input ? 'custom' : ''}" data-id="${a.id}" data-emoji="${escapeHtml(a.emoji || '')}">
        <button type="button" class="f-emoji emoji-edit-btn" title="이모지 바꾸기" aria-label="이모지 바꾸기">${em}</button>
        <input type="text" class="f-name" value="${escapeHtml(a.name)}" placeholder="활동명" />
        ${a.is_custom_input
          ? `<div class="custom-badge">직접 입력</div>`
          : `<input type="number" class="f-delta" value="${a.score_delta}" placeholder="점수" />`
        }
        ${a.is_custom_input
          ? `<button class="btn-mini" disabled style="opacity:0.4;cursor:not-allowed;">🗑</button>`
          : `<button class="btn-mini danger delete-act-btn">🗑</button>`
        }
      </div>
    `
  }).join('')

  body.innerHTML = `
    <div class="activity-edit-list">${rows}</div>
    <button class="btn-add-level" id="add-activity">＋ 새 활동 추가</button>
    <div class="hint-text" style="margin-top:8px;">
      💡 이모지를 누르면 100여 가지 중에서 바꿀 수 있어요.<br/>
      활동명을 바꾸면 이름에 어울리는 이모지가 자동으로 추천돼요. (이미 직접 골랐다면 그대로 유지)<br/>
      입력 후 다른 곳을 누르면 자동 저장됩니다. (점수는 음수도 가능)
    </div>
  `

  // 자동 저장 (blur 시)
  body.querySelectorAll('.activity-edit-item').forEach(item => {
    const id = item.dataset.id // UUID string
    const inputs = item.querySelectorAll('input')
    inputs.forEach(inp => {
      inp.addEventListener('blur', async () => {
        const name = item.querySelector('.f-name').value.trim()
        const deltaEl = item.querySelector('.f-delta')
        const payload = { name }
        if (deltaEl) payload.score_delta = Number(deltaEl.value) || 0
        if (!name) {
          showToast('활동명을 입력해주세요', 'warning')
          return
        }
        // 사용자가 이모지를 직접 안 골랐고(emoji 컬럼 NULL), 이름 변경으로 더 어울리는 이모지가 생기면 같이 저장
        const currentEmoji = item.dataset.emoji  // DB에 저장된 emoji (없으면 '')
        if (!currentEmoji) {
          const suggested = suggestActivityEmoji(name)
          if (suggested) {
            payload.emoji = suggested
            // 즉시 UI에도 반영
            item.querySelector('.f-emoji').textContent = suggested
            item.dataset.emoji = suggested
          }
        }
        try {
          await api(`/api/activities/${id}`, {
            method: 'PUT',
            body: JSON.stringify(payload),
          })
          state.activities = [] // 캐시 무효화
          // 잔잔한 저장 피드백
          item.style.transition = 'background 0.3s'
          item.style.background = 'rgba(74,222,128,0.15)'
          setTimeout(() => item.style.background = '', 600)
        } catch (e) {
          showToast(e.message, 'error')
        }
      })
    })
  })

  // 이모지 클릭 → 이모지 피커 모달
  body.querySelectorAll('.emoji-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.activity-edit-item')
      const id = item.dataset.id
      const name = item.querySelector('.f-name').value
      const currentEmoji = btn.textContent.trim()
      showEmojiPicker({
        title: `'${name || '활동'}' 이모지 고르기`,
        current: currentEmoji,
        onPick: async (newEmoji) => {
          btn.textContent = newEmoji
          item.dataset.emoji = newEmoji
          try {
            await api(`/api/activities/${id}`, {
              method: 'PUT',
              body: JSON.stringify({ emoji: newEmoji }),
            })
            state.activities = []
            showToast('이모지를 바꿨어요', 'success', newEmoji)
          } catch (e) {
            showToast(e.message, 'error')
          }
        },
        onClear: async () => {
          // NULL로 비우면 다음에 자동 추천이 다시 적용됨
          const auto = suggestActivityEmoji(name) || '📌'
          btn.textContent = auto
          item.dataset.emoji = ''
          try {
            await api(`/api/activities/${id}`, {
              method: 'PUT',
              body: JSON.stringify({ emoji: null }),
            })
            state.activities = []
            showToast('자동 추천 이모지로 돌렸어요', 'success', auto)
          } catch (e) {
            showToast(e.message, 'error')
          }
        },
      })
    })
  })

  // 삭제
  body.querySelectorAll('.delete-act-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.activity-edit-item')
      const id = item.dataset.id
      const name = item.querySelector('.f-name').value
      showConfirm(`'${name}' 활동 삭제`, '이 활동 버튼을 삭제할까요?', async () => {
        try {
          await api(`/api/activities/${id}`, { method: 'DELETE' })
          state.activities = []
          showToast('삭제됨', 'success', '🗑')
          await renderActivitiesSettings()
        } catch (e) {
          showToast(e.message, 'error')
        }
      })
    })
  })

  // 추가
  document.getElementById('add-activity').onclick = async () => {
    try {
      // 서버에서 이름 기반 자동 추천 emoji를 채워줌
      await api(`/api/classes/${state.classId}/activities`, {
        method: 'POST',
        body: JSON.stringify({
          name: '새 활동',
          score_delta: 10,
        }),
      })
      state.activities = []
      showToast('활동 추가됨', 'success', '➕')
      await renderActivitiesSettings()
    } catch (e) {
      showToast(e.message, 'error')
    }
  }
}

// ==============================
// 이모지 피커 모달 (카테고리별 100+ 개)
//   opts: { title, current, onPick(emoji), onClear() }
// ==============================
function showEmojiPicker({ title = '이모지 고르기', current = '', onPick, onClear } = {}) {
  const container = document.getElementById('modal-container')

  function render() {
    const sections = ACTIVITY_EMOJI_LIBRARY.map(sec => `
      <div class="picker-section">
        <div class="picker-label" style="font-size:12px;color:var(--text-muted, #94a3b8);margin-bottom:6px;">${escapeHtml(sec.label)}</div>
        <div class="emoji-grid">
          ${sec.emojis.map(em => `
            <button class="emoji-pick ${em === current ? 'active' : ''}" data-emoji="${em}" title="${em}">${em}</button>
          `).join('')}
        </div>
      </div>
    `).join('')

    container.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal modal-wide">
          <div class="modal-title">${escapeHtml(title)}</div>
          <div class="emoji-picker-current">
            <span class="hint-text" style="margin:0 8px 0 0;">현재:</span>
            <span class="emoji-picker-current-em">${current || '📌'}</span>
          </div>
          <div class="emoji-picker-scroll">${sections}</div>
          <div class="modal-actions">
            <button class="btn-cancel" id="emoji-picker-cancel">닫기</button>
            ${onClear ? `<button class="btn-mini" id="emoji-picker-clear">↺ 자동 추천으로</button>` : ''}
          </div>
        </div>
      </div>
    `

    container.querySelectorAll('.emoji-pick').forEach(b => {
      b.addEventListener('click', async () => {
        const em = b.dataset.emoji
        container.innerHTML = ''
        try { await onPick?.(em) } catch (e) { console.error(e) }
      })
    })
    document.getElementById('emoji-picker-cancel').onclick = () => container.innerHTML = ''
    const clearBtn = document.getElementById('emoji-picker-clear')
    if (clearBtn) clearBtn.onclick = async () => {
      container.innerHTML = ''
      try { await onClear?.() } catch (e) { console.error(e) }
    }
  }

  render()
}

// ----- 스킬 내용 편집 -----
// 레벨/XP/등급/선택형 여부 구조는 고정. 스킬 이름·보상 설명·선택지 텍스트만 수정 가능.
async function renderSkillsSettings() {
  const body = document.getElementById('settings-body')
  body.innerHTML = '<div class="hint-text">불러오는 중...</div>'

  const levels = await api(`/api/classes/${state.classId}/level-table`)
  state.levelTable = levels

  // 해금 스킬이 있거나 선택형인 레벨만 편집 대상으로 표시
  const editableLevels = levels.filter(lv => lv.unlock_skill || lv.is_choice)

  const rows = editableLevels.map(lv => {
    const rank = lv.rank
    const rankBadge = rank === 'gold' ? '🥇' : rank === 'silver' ? '🥈' : '🥉'

    if (lv.is_choice) {
      return `
        <div class="skill-edit-item choice" data-level="${lv.level}">
          <div class="skill-edit-head">
            <span class="level-pill">Lv.${lv.level}</span>
            <span class="rank-badge rank-${rank}">${rankBadge} ${rank === 'gold' ? '골드' : rank === 'silver' ? '실버' : '브론즈'}</span>
            <span class="choice-tag">A/B 선택형</span>
          </div>
          <div class="skill-edit-row">
            <label>선택 A</label>
            <input type="text" class="f-choice-a" value="${escapeHtml(lv.choice_a || '')}" placeholder="예: 숙제 반값 할인권" />
          </div>
          <div class="skill-edit-row">
            <label>선택 B</label>
            <input type="text" class="f-choice-b" value="${escapeHtml(lv.choice_b || '')}" placeholder="예: 1일 자유석 이용권" />
          </div>
          <div class="skill-edit-row">
            <label>보상 설명</label>
            <input type="text" class="f-desc" value="${escapeHtml(lv.reward_desc || '')}" placeholder="둘 중 하나를 직접 선택" />
          </div>
        </div>
      `
    } else {
      return `
        <div class="skill-edit-item" data-level="${lv.level}">
          <div class="skill-edit-head">
            <span class="level-pill">Lv.${lv.level}</span>
            <span class="rank-badge rank-${rank}">${rankBadge} ${rank === 'gold' ? '골드' : rank === 'silver' ? '실버' : '브론즈'}</span>
            <span class="unlock-tag">자동 해금</span>
          </div>
          <div class="skill-edit-row">
            <label>스킬명</label>
            <input type="text" class="f-name" value="${escapeHtml(lv.unlock_skill || '')}" placeholder="예: 미니펫" />
          </div>
          <div class="skill-edit-row">
            <label>보상 설명</label>
            <input type="text" class="f-desc" value="${escapeHtml(lv.reward_desc || '')}" placeholder="예: 책상에 인형 1개 전시 허용" />
          </div>
        </div>
      `
    }
  }).join('')

  body.innerHTML = `
    <div class="hint-text" style="background:#fef3c7;border-radius:12px;margin-bottom:10px;padding:10px;color:#92400e;text-align:left;line-height:1.5;">
      🔒 <b>구조 고정</b>: 몇 레벨에 스킬이 해금되는지는 바꿀 수 없습니다.<br/>
      ✏️ <b>편집 가능</b>: 그 자리의 스킬 이름과 보상 설명만 자유롭게 수정·변경 가능합니다.
    </div>
    <div class="skill-edit-list">${rows}</div>
    <div class="hint-text" style="margin-top:8px;">
      입력 후 다른 곳을 누르면 자동 저장됩니다.
    </div>
  `

  // 자동 저장
  body.querySelectorAll('.skill-edit-item').forEach(item => {
    const level = Number(item.dataset.level)
    const isChoice = item.classList.contains('choice')
    const inputs = item.querySelectorAll('input')
    inputs.forEach(inp => {
      inp.addEventListener('blur', async () => {
        const reward_desc = item.querySelector('.f-desc').value.trim()
        const body = { reward_desc }
        if (isChoice) {
          body.choice_a = item.querySelector('.f-choice-a').value.trim()
          body.choice_b = item.querySelector('.f-choice-b').value.trim()
        } else {
          const name = item.querySelector('.f-name').value.trim()
          if (!name) {
            showToast('스킬명을 입력해주세요', 'warning')
            return
          }
          body.unlock_skill = name
        }
        try {
          await api(`/api/classes/${state.classId}/level-table/${level}/skill`, {
            method: 'PUT',
            body: JSON.stringify(body),
          })
          item.style.transition = 'background 0.3s'
          item.style.background = '#dcfce7'
          setTimeout(() => item.style.background = '', 600)
        } catch (e) {
          showToast(e.message, 'error')
        }
      })
    })
  })
}

// ==============================
// 로그인 / 회원가입 화면
// ==============================
function showAuthScreen(opts = {}) {
  document.getElementById('app-header').style.display = 'none'
  document.getElementById('modal-container').innerHTML = ''

  const mode = opts.mode || 'signin' // 'signin' | 'signup'
  const mainView = document.getElementById('main-view')
  mainView.innerHTML = `
    <div class="auth-screen">
      <div class="auth-card">
        <div class="auth-brand">
          <div class="auth-logo">🎮</div>
          <div class="auth-brand-name">
            <span class="brand-ko">클업</span>
            <span class="brand-en">CLASS UP</span>
          </div>
          <div class="auth-tagline">우리 반 RPG 학급경영</div>
        </div>

        <div class="auth-tabs">
          <button class="auth-tab ${mode === 'signin' ? 'active' : ''}" data-mode="signin">로그인</button>
          <button class="auth-tab ${mode === 'signup' ? 'active' : ''}" data-mode="signup">회원가입</button>
        </div>

        <form class="auth-form" id="auth-form">
          <label class="auth-label">
            <span>이메일</span>
            <input type="email" id="auth-email" required autocomplete="email"
                   placeholder="teacher@example.com" />
          </label>
          <label class="auth-label">
            <span>비밀번호 ${mode === 'signup' ? '<small>(6자 이상)</small>' : ''}</span>
            <input type="password" id="auth-password" required
                   autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}"
                   placeholder="••••••" minlength="6" />
          </label>

          <button type="submit" class="auth-submit" id="auth-submit">
            ${mode === 'signin' ? '로그인' : '회원가입 후 시작'}
          </button>
          <div class="auth-error" id="auth-error" style="display:none;"></div>
        </form>

        <div class="auth-footer">
          ${mode === 'signin'
            ? '아직 계정이 없으신가요? <button class="auth-link" data-switch="signup">회원가입</button>'
            : '이미 계정이 있으신가요? <button class="auth-link" data-switch="signin">로그인</button>'}
        </div>
      </div>
    </div>
  `

  mainView.querySelectorAll('.auth-tab').forEach(btn => {
    btn.onclick = () => showAuthScreen({ mode: btn.dataset.mode })
  })
  mainView.querySelectorAll('[data-switch]').forEach(btn => {
    btn.onclick = () => showAuthScreen({ mode: btn.dataset.switch })
  })

  const form = document.getElementById('auth-form')
  const errBox = document.getElementById('auth-error')
  const submitBtn = document.getElementById('auth-submit')

  form.onsubmit = async (e) => {
    e.preventDefault()
    errBox.style.display = 'none'
    const email = document.getElementById('auth-email').value.trim().toLowerCase()
    const password = document.getElementById('auth-password').value
    if (!email || !password) return

    submitBtn.disabled = true
    submitBtn.textContent = '잠시만요...'
    try {
      if (mode === 'signup') {
        const r = await signUp(email, password)
        if (r.signedIn) {
          await afterLogin()
        } else {
          errBox.textContent = '가입 완료! 이메일 확인이 필요할 수 있어요. 이메일 확인 후 로그인해주세요.'
          errBox.style.display = 'block'
          submitBtn.disabled = false
          submitBtn.textContent = mode === 'signin' ? '로그인' : '회원가입 후 시작'
        }
      } else {
        await signIn(email, password)
        await afterLogin()
      }
    } catch (err) {
      errBox.textContent = err.message || '로그인 실패'
      errBox.style.display = 'block'
      submitBtn.disabled = false
      submitBtn.textContent = mode === 'signin' ? '로그인' : '회원가입 후 시작'
    }
  }
}

// 로그인/세션복원 성공 후 부트스트랩 → 학급 있으면 list, 없으면 온보딩
async function afterLogin() {
  const result = await bootstrap()
  if (!result.ok && result.needsLogin) {
    showAuthScreen()
    return
  }
  if (result.hasClass) {
    showAppShell()
    navigate('list')
  } else {
    showOnboarding(result.claimable || [])
  }
}

function showAppShell() {
  const header = document.getElementById('app-header')
  header.style.display = ''
  // 로그아웃 버튼 바인딩 (중복 바인딩 방지를 위해 매번 재할당)
  document.getElementById('nav-logs').onclick = () => navigate('logs')
  document.getElementById('nav-settings').onclick = () => navigate('settings')
  document.getElementById('header-title').onclick = () => navigate('list')
  const soundBtn = document.getElementById('nav-sound')
  if (soundBtn) soundBtn.onclick = toggleSound
  updateSoundButton()
  document.getElementById('nav-logout').onclick = async () => {
    if (!confirm(`${state.authEmail || ''} 계정에서 로그아웃 하시겠습니까?`)) return
    await signOut()
    showAuthScreen({ mode: 'signin' })
  }
}

// ==============================
// 온보딩: 학급 없을 때
// ==============================
function showOnboarding(claimable) {
  document.getElementById('app-header').style.display = 'none'
  const mainView = document.getElementById('main-view')

  const claimableHtml = (claimable && claimable.length > 0)
    ? `
      <div class="onboard-section">
        <div class="onboard-section-title">기존 학급 가져오기</div>
        <div class="onboard-section-desc">아직 주인이 없는 학급이에요. 이미 만들어 둔 학급이 있다면 내 학급으로 가져올 수 있어요.</div>
        <div class="onboard-claim-list">
          ${claimable.map(c => `
            <div class="onboard-claim-item">
              <div class="onboard-claim-name">${escapeHtml(c.name)}</div>
              <button class="btn-claim" data-class-id="${c.id}">이 학급 가져오기</button>
            </div>
          `).join('')}
        </div>
      </div>
    `
    : ''

  mainView.innerHTML = `
    <div class="onboard-screen">
      <div class="onboard-card">
        <div class="onboard-welcome">
          <div class="onboard-logo">🎮</div>
          <div class="onboard-title">환영합니다, 선생님!</div>
          <div class="onboard-email">${escapeHtml(state.authEmail || '')}</div>
        </div>

        <div class="onboard-section">
          <div class="onboard-section-title">새 학급 만들기</div>
          <div class="onboard-section-desc">학급 이름을 입력하고 시작하세요. 예: 클업 5-2</div>
          <form id="onboard-create-form" class="onboard-create-form">
            <input type="text" id="onboard-class-name" placeholder="학급 이름 (예: 클업 5-2)" maxlength="40" required />
            <button type="submit" class="btn-onboard-create">학급 만들기</button>
          </form>
        </div>

        ${claimableHtml}

        <div class="onboard-footer">
          <button class="auth-link" id="onboard-logout">다른 계정으로 로그인</button>
        </div>
      </div>
    </div>
  `

  const form = document.getElementById('onboard-create-form')
  form.onsubmit = async (e) => {
    e.preventDefault()
    const name = document.getElementById('onboard-class-name').value.trim()
    if (!name) return
    const btn = form.querySelector('button[type=submit]')
    btn.disabled = true
    btn.textContent = '만드는 중...'
    try {
      const r = await api('/api/classes', {
        method: 'POST',
        body: JSON.stringify({ name }),
      })
      state.classId = r.class.id
      state.className = r.class.name
      state.booted = true
      showAppShell()
      navigate('list')
      showToast(`'${r.class.name}' 학급이 만들어졌어요!`, 'success', '🎉')
    } catch (err) {
      showToast(err.message, 'error')
      btn.disabled = false
      btn.textContent = '학급 만들기'
    }
  }

  // 학급 가져오기
  mainView.querySelectorAll('.btn-claim').forEach(btn => {
    btn.onclick = async () => {
      const classId = btn.dataset.classId
      if (!confirm('이 학급을 내 학급으로 가져옵니다. 계속할까요?')) return
      btn.disabled = true
      btn.textContent = '가져오는 중...'
      try {
        const r = await api(`/api/classes/${classId}/claim`, { method: 'POST' })
        state.classId = r.class.id
        state.className = r.class.name
        state.booted = true
        showAppShell()
        navigate('list')
        showToast(`'${r.class.name}' 학급을 가져왔어요!`, 'success', '🎉')
      } catch (err) {
        showToast(err.message, 'error')
        btn.disabled = false
        btn.textContent = '이 학급 가져오기'
      }
    }
  })

  document.getElementById('onboard-logout').onclick = async () => {
    await signOut()
    showAuthScreen({ mode: 'signin' })
  }
}

// ==============================
// 헤더 버튼 & 진입점
// ==============================
document.addEventListener('DOMContentLoaded', async () => {
  // 세션 복원 시도
  const hasSession = loadAuthSession()
  if (hasSession) {
    try {
      await afterLogin()
      return
    } catch (e) {
      // 세션 만료 등
      clearAuthSession()
    }
  }
  showAuthScreen({ mode: 'signin' })
})
