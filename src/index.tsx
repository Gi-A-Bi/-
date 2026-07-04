import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { renderer } from './renderer'
import type {
  Bindings,
  Variables,
  StudentRow,
  LevelRow,
  ActivityRow,
  ActivityLogRow,
  ClassRow,
  OwnedSkill,
  UsedSkill,
  BadgeRow,
  EarnedBadge,
  ShopItemRow,
  CouponItem,
} from './types'
import {
  calcLevel,
  nextLevel,
  gradeToRank,
  parseUnlockSkill,
  shortUid,
} from './types'
import { makeSupabase } from './supabase'

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

app.use('/api/*', cors())
app.use(renderer)

// =================================================================
// 메인 페이지 (SPA 쉘) - 로그인 화면도 클라이언트가 그림
// =================================================================
app.get('/', (c) => {
  return c.render(
    <div id="app">
      <header class="app-header" id="app-header" style="display:none;">
        <div class="header-inner">
          <div class="header-title" id="header-title">
            <span class="logo-icon">🎮</span>
            <span id="header-title-text">
              <span class="brand-ko">클업</span>
              <span class="brand-en">CLASS UP</span>
            </span>
          </div>
          <div class="header-actions">
            <button class="icon-btn" id="nav-sound" title="효과음" aria-label="효과음">
              <i class="fa-solid fa-volume-high"></i>
              <span class="icon-label">소리</span>
            </button>
            <button class="icon-btn" id="nav-logs" title="활동 기록" aria-label="활동 기록">
              <i class="fa-solid fa-clock-rotate-left"></i>
              <span class="icon-label">기록</span>
            </button>
            <button class="icon-btn" id="nav-settings" title="설정" aria-label="설정">
              <i class="fa-solid fa-sliders"></i>
              <span class="icon-label">설정</span>
            </button>
            <button class="icon-btn icon-btn-logout" id="nav-logout" title="로그아웃" aria-label="로그아웃">
              <i class="fa-solid fa-right-from-bracket"></i>
              <span class="icon-label">로그아웃</span>
            </button>
          </div>
        </div>
      </header>

      <main id="main-view"></main>

      <footer class="app-footer">
        개발자: 김민성 · 오류·문의: <a href="mailto:hwjjlover@gmail.com">hwjjlover@gmail.com</a>
      </footer>

      <div id="toast-container"></div>
      <div id="modal-container"></div>
    </div>
  )
})

// =================================================================
// Auth 미들웨어 - 모든 /api/* (단 /api/public-config 제외) 보호
// Authorization: Bearer <access_token> 헤더 검증
// Supabase /auth/v1/user 에 토큰을 보내 이메일 추출
// =================================================================
async function verifyToken(env: Bindings, token: string): Promise<
  | { ok: true; email: string; id: string }
  | { ok: false; status: 'invalid' | 'network' }
> {
  const url = env.SUPABASE_URL.replace(/\/+$/, '') + '/auth/v1/user'
  let res: Response
  try {
    res = await fetch(url, {
      headers: {
        apikey: env.SUPABASE_KEY,
        Authorization: `Bearer ${token}`,
      },
    })
  } catch (e) {
    return { ok: false, status: 'network' }
  }
  if (!res.ok) return { ok: false, status: 'invalid' }
  const user = await res.json().catch(() => null) as any
  if (!user || !user.email) return { ok: false, status: 'invalid' }
  return { ok: true, email: String(user.email).toLowerCase(), id: String(user.id) }
}

const requireAuth = async (c: any, next: any) => {
  const auth = c.req.header('Authorization') || ''
  const m = auth.match(/^Bearer\s+(.+)$/i)
  if (!m) return c.json({ error: '로그인이 필요합니다', code: 'NO_AUTH' }, 401)

  const result = await verifyToken(c.env, m[1])
  if (!result.ok) {
    if (result.status === 'network') {
      return c.json({ error: 'Supabase 연결 실패 (잠시 후 다시 시도해주세요)', code: 'AUTH_NETWORK' }, 503)
    }
    return c.json({ error: '세션이 만료되었습니다', code: 'INVALID_TOKEN' }, 401)
  }

  c.set('email', result.email)
  c.set('userId', result.id)
  await next()
}

// /api/public-config 외 모든 /api/* 에 Auth 적용
app.use('/api/me', requireAuth)
app.use('/api/my-class', requireAuth)
app.use('/api/classes', requireAuth)
app.use('/api/classes/*', requireAuth)
app.use('/api/students/*', requireAuth)
app.use('/api/activities/*', requireAuth)

// =================================================================
// Public: 프론트에서 Supabase Auth를 초기화할 때 필요한 anon key/url
// =================================================================
app.get('/api/public-config', (c) => {
  return c.json({
    supabase_url: c.env.SUPABASE_URL,
    supabase_key: c.env.SUPABASE_KEY,
  })
})

// =================================================================
// 현재 로그인 사용자
// =================================================================
app.get('/api/me', (c) => {
  return c.json({ email: c.get('email'), id: c.get('userId') })
})

// =================================================================
// 학급 소유권 검증 헬퍼
//  - 주어진 classId 가 현재 로그인 사용자의 학급인지 DB에서 직접 확인
//  - 통과 못 하면 403 응답 (라우트는 즉시 return)
// =================================================================
async function loadOwnedClass(c: any, classId: string): Promise<ClassRow | Response> {
  const sb = makeSupabase(c.env)
  const email = c.get('email') as string
  const rows = await sb.select<ClassRow>(
    'classes',
    `select=*&id=eq.${classId}&limit=1`,
  )
  const cls = rows[0]
  if (!cls) return c.json({ error: '학급을 찾을 수 없습니다' }, 404)
  if (!cls.owner_email || cls.owner_email.toLowerCase() !== email) {
    return c.json({ error: '권한이 없습니다', code: 'NOT_OWNER' }, 403)
  }
  return cls
}

// 학생 id 로부터 학급 소유권 검증 (학생 row를 미리 로드해서 함께 반환)
async function loadOwnedStudent(c: any, studentId: string): Promise<{ student: StudentRow; cls: ClassRow } | Response> {
  const sb = makeSupabase(c.env)
  const email = c.get('email') as string
  const studentRows = await sb.select<StudentRow>(
    'students',
    `select=*&id=eq.${studentId}&limit=1`,
  )
  const student = studentRows[0]
  if (!student) return c.json({ error: '학생을 찾을 수 없습니다' }, 404)

  const clsRows = await sb.select<ClassRow>(
    'classes',
    `select=*&id=eq.${student.class_id}&limit=1`,
  )
  const cls = clsRows[0]
  if (!cls || !cls.owner_email || cls.owner_email.toLowerCase() !== email) {
    return c.json({ error: '권한이 없습니다', code: 'NOT_OWNER' }, 403)
  }
  return { student, cls }
}

// 활동(점수버튼) id 로부터 학급 소유권 검증
async function loadOwnedActivity(c: any, activityId: string): Promise<{ activity: ActivityRow; cls: ClassRow } | Response> {
  const sb = makeSupabase(c.env)
  const email = c.get('email') as string
  const rows = await sb.select<ActivityRow>(
    'activities',
    `select=*&id=eq.${activityId}&limit=1`,
  )
  const activity = rows[0]
  if (!activity) return c.json({ error: '활동을 찾을 수 없습니다' }, 404)
  const clsRows = await sb.select<ClassRow>(
    'classes',
    `select=*&id=eq.${activity.class_id}&limit=1`,
  )
  const cls = clsRows[0]
  if (!cls || !cls.owner_email || cls.owner_email.toLowerCase() !== email) {
    return c.json({ error: '권한이 없습니다', code: 'NOT_OWNER' }, 403)
  }
  return { activity, cls }
}

// =================================================================
// 헬퍼: unlock_uses → 보유 스킬의 사용횟수 필드
//   0 = 계속 유지(상시), 1~3 = N회권
// =================================================================
function skillUsesFields(unlock_uses: number | null | undefined): Partial<OwnedSkill> {
  const u = Math.trunc(Number(unlock_uses))
  if (u === 0) return { permanent: true }
  const n = Number.isFinite(u) && u >= 1 ? Math.min(3, u) : 1
  return { uses_left: n, uses_total: n }
}

// =================================================================
// 헬퍼: 학생 row → enriched
// =================================================================
function enrichStudent(s: StudentRow, levelTable: LevelRow[]) {
  const cur = calcLevel(s.xp, levelTable)
  const nxt = nextLevel(s.xp, levelTable)
  const owned = Array.isArray(s.owned_skills) ? s.owned_skills : []
  const used = Array.isArray(s.used_skills) ? s.used_skills : []
  const pendingCount = owned.filter(sk => sk.pending).length
  return {
    ...s,
    owned_skills: owned,
    used_skills: used,
    level: cur.level,
    grade: cur.grade,
    rank: gradeToRank(cur.grade),
    passive_skill: cur.passive_skill,
    current_required_xp: cur.min_xp,
    next_level: nxt?.level ?? null,
    next_required_xp: nxt?.min_xp ?? null,
    skill_count: owned.length,
    pending_choice_count: pendingCount,
    max_hp: 3,
  }
}

// =================================================================
// 내 학급 찾기 (로그인 후 부트스트랩)
//   - owner_email = 내 이메일 인 학급 1건 반환
//   - 없으면 null (프론트가 온보딩 화면 표시)
//   - + claimable_classes: owner_email 이 비어있는 학급 목록 (기존 4-1 같은 것)
// =================================================================
app.get('/api/my-class', async (c) => {
  const sb = makeSupabase(c.env)
  const email = c.get('email')
  const [owned, claimable] = await Promise.all([
    sb.select<ClassRow>(
      'classes',
      `select=*&owner_email=eq.${encodeURIComponent(email)}&order=created_at.asc&limit=1`,
    ),
    sb.select<ClassRow>(
      'classes',
      `select=id,name,created_at&owner_email=is.null&order=created_at.asc`,
    ),
  ])
  return c.json({
    my_class: owned[0] || null,
    claimable_classes: claimable, // 아직 주인 없는 학급 (기존 4-1 등)
  })
})

// =================================================================
// 새 학급 만들기 (온보딩)
// =================================================================
app.post('/api/classes', async (c) => {
  const sb = makeSupabase(c.env)
  const email = c.get('email') as string
  const body = await c.req.json<{ name: string }>().catch(() => ({} as any))
  const name = (body.name || '').trim()
  if (!name) return c.json({ error: '학급 이름을 입력해주세요' }, 400)

  // 이미 학급이 있으면 추가 생성 금지 (1선생 = 1학급 정책)
  const existing = await sb.select<ClassRow>(
    'classes',
    `select=id&owner_email=eq.${encodeURIComponent(email)}&limit=1`,
  )
  if (existing[0]) {
    return c.json({ error: '이미 학급이 있습니다', code: 'ALREADY_HAS_CLASS' }, 400)
  }

  const inserted = await sb.insert<ClassRow>('classes', [{
    name,
    owner_email: email,
  }])
  const cls = inserted[0]
  if (!cls) return c.json({ error: '학급 생성에 실패했습니다' }, 500)

  // 신규 학급에는 기본 활동(점수버튼) 12개 시드 (기존 4-1과 동일 사양)
  const DEFAULT_ACTIVITIES = [
    { name: '발표/적극 참여', score: 100, emoji: '🎤', sort_order: 1 },
    { name: '과제/숙제 완료', score: 80,  emoji: '📝', sort_order: 2 },
    { name: '협동/도움',     score: 60,  emoji: '🤝', sort_order: 3 },
    { name: '예의/태도',     score: 50,  emoji: '🙇', sort_order: 4 },
    { name: '정리정돈',      score: 40,  emoji: '🧹', sort_order: 5 },
    { name: '독서/공부',     score: 30,  emoji: '📚', sort_order: 6 },
    { name: '인사/존중',     score: 20,  emoji: '👋', sort_order: 7 },
    { name: '기타 +(직접입력)', score: 0, emoji: '➕', sort_order: 8 },
    { name: '지각',          score: -20, emoji: '⏰', sort_order: 9 },
    { name: '준비물 미비',   score: -30, emoji: '🎒', sort_order: 10 },
    { name: '수업 방해',     score: -50, emoji: '🚫', sort_order: 11 },
    { name: '기타 -(직접입력)', score: 0, emoji: '➖', sort_order: 12 },
  ].map(a => ({ ...a, class_id: cls.id }))

  await sb.insert('activities', DEFAULT_ACTIVITIES, false)

  return c.json({ success: true, class: cls })
})

// =================================================================
// 기존 학급 '내 학급으로 가져오기' (claim)
//   - owner_email 이 비어있는 학급에만 가능
//   - 한 선생당 1학급이라, 이미 본인 학급 있으면 거절
// =================================================================
app.post('/api/classes/:id/claim', async (c) => {
  const id = c.req.param('id')
  const sb = makeSupabase(c.env)
  const email = c.get('email') as string

  const existing = await sb.select<ClassRow>(
    'classes',
    `select=id&owner_email=eq.${encodeURIComponent(email)}&limit=1`,
  )
  if (existing[0]) {
    return c.json({ error: '이미 학급이 있습니다', code: 'ALREADY_HAS_CLASS' }, 400)
  }

  const rows = await sb.select<ClassRow>(
    'classes',
    `select=*&id=eq.${id}&limit=1`,
  )
  const cls = rows[0]
  if (!cls) return c.json({ error: '학급을 찾을 수 없습니다' }, 404)
  if (cls.owner_email) {
    return c.json({ error: '이미 주인이 있는 학급입니다' }, 400)
  }

  const updated = await sb.update<ClassRow>(
    'classes',
    { owner_email: email },
    `id=eq.${id}`,
  )
  return c.json({ success: true, class: updated[0] })
})

// =================================================================
// 학급 전체 경험치(bonus_xp) 조정
//   - "학급 전체 경험치" = 모든 학생 xp 합계 + bonus_xp
//   - delta 양수 = 학급 보상, 음수 = 학급 차감
//   - 개별 학생의 xp 는 전혀 변하지 않고 이 보정치만 조정됨
// =================================================================
app.post('/api/classes/:classId/class-xp', async (c) => {
  const classId = c.req.param('classId')
  const owned = await loadOwnedClass(c, classId)
  if (owned instanceof Response) return owned

  const body = await c.req.json<{ delta: number }>().catch(() => ({} as any))
  const delta = Math.trunc(Number(body.delta || 0))
  if (!delta) return c.json({ error: '조정할 경험치를 입력해주세요' }, 400)

  const sb = makeSupabase(c.env)
  const current = Number((owned as ClassRow).bonus_xp || 0)
  const newBonus = current + delta
  await sb.update('classes', { bonus_xp: newBonus }, `id=eq.${classId}`, false)

  return c.json({ success: true, bonus_xp: newBonus, delta })
})

// =================================================================
// 학생 목록 (학급 소유권 검증)
// =================================================================
app.get('/api/classes/:classId/students', async (c) => {
  const classId = c.req.param('classId')
  const owned = await loadOwnedClass(c, classId)
  if (owned instanceof Response) return owned

  const sb = makeSupabase(c.env)
  const [students, levels] = await Promise.all([
    sb.select<StudentRow>(
      'students',
      `select=*&class_id=eq.${classId}&order=number.asc`,
    ),
    sb.select<LevelRow>('levels', 'select=*&order=level.asc'),
  ])

  const enriched = students.map(s => enrichStudent(s, levels))
  return c.json(enriched)
})

// =================================================================
// 학생 추가 (학급 소유권 검증)
// =================================================================
app.post('/api/classes/:classId/students', async (c) => {
  const classId = c.req.param('classId')
  const owned = await loadOwnedClass(c, classId)
  if (owned instanceof Response) return owned

  const body = await c.req.json<{ name: string; number?: number }>().catch(() => ({} as any))
  const name = (body.name || '').trim()
  if (!name) return c.json({ error: '이름을 입력해주세요' }, 400)

  const sb = makeSupabase(c.env)
  // 자동 번호 = 현재 최대 + 1
  let number = Number(body.number || 0)
  if (!number) {
    const rows = await sb.select<StudentRow>(
      'students',
      `select=number&class_id=eq.${classId}&order=number.desc&limit=1`,
    )
    number = (rows[0]?.number || 0) + 1
  }

  const inserted = await sb.insert<StudentRow>('students', [{
    class_id: classId,
    number,
    name,
    nickname: null,
    avatar_emoji: null,
    avatar_color: null,
    avatar_image: null,
    xp: 0,
    hp: 3,
    owned_skills: [],
    used_skills: [],
  }])
  return c.json({ success: true, student: inserted[0] })
})

// =================================================================
// 학생 일괄 추가 (붙여넣기 / 엑셀 업로드)
//  body: { names: string[] }  (이미 클라이언트에서 파싱 완료된 이름 배열)
//  - 중복 이름은 그대로 추가 (동명이인 가능)
//  - 출석번호는 (현재 최대 + 1)부터 순차 자동 부여
// =================================================================
app.post('/api/classes/:classId/students/bulk', async (c) => {
  const classId = c.req.param('classId')
  const owned = await loadOwnedClass(c, classId)
  if (owned instanceof Response) return owned

  const body = await c.req.json<{ names: string[] }>().catch(() => ({} as any))
  const rawNames = Array.isArray(body.names) ? body.names : []
  const names = rawNames
    .map(n => (typeof n === 'string' ? n.trim() : ''))
    .filter(n => n.length > 0 && n.length <= 30)

  if (names.length === 0) {
    return c.json({ error: '추가할 이름이 없습니다' }, 400)
  }
  if (names.length > 100) {
    return c.json({ error: '한 번에 최대 100명까지 추가할 수 있어요' }, 400)
  }

  const sb = makeSupabase(c.env)
  // 현재 최대 출석번호 확인
  const rows = await sb.select<StudentRow>(
    'students',
    `select=number&class_id=eq.${classId}&order=number.desc&limit=1`,
  )
  let nextNumber = (rows[0]?.number || 0) + 1

  const newStudents = names.map(name => ({
    class_id: classId,
    number: nextNumber++,
    name,
    nickname: null,
    avatar_emoji: null,
    avatar_color: null,
    avatar_image: null,
    xp: 0,
    hp: 3,
    owned_skills: [],
    used_skills: [],
  }))

  const inserted = await sb.insert<StudentRow>('students', newStudents)
  return c.json({
    success: true,
    count: inserted.length,
    students: inserted,
  })
})

// =================================================================
// 학생 삭제 (학급 소유권 검증)
// =================================================================
app.delete('/api/students/:id', async (c) => {
  const id = c.req.param('id')
  const result = await loadOwnedStudent(c, id)
  if (result instanceof Response) return result

  const sb = makeSupabase(c.env)
  // 학생의 활동기록도 함께 삭제
  await sb.delete('activity_logs', `student_id=eq.${id}`)
  await sb.delete('students', `id=eq.${id}`)
  return c.json({ success: true })
})

// =================================================================
// 학생 상세
// =================================================================
app.get('/api/students/:id', async (c) => {
  const id = c.req.param('id')
  const result = await loadOwnedStudent(c, id)
  if (result instanceof Response) return result
  const { student } = result

  const sb = makeSupabase(c.env)
  const levels = await sb.select<LevelRow>('levels', 'select=*&order=level.asc')
  const e = enrichStudent(student, levels)

  const owned = e.owned_skills
  const skills = owned
    .filter(s => !s.pending)
    .map(s => ({
      uid: s.uid,
      skill_name: s.name,
      source_level: s.level,
      acquired_at: s.acquired_at,
      permanent: !!s.permanent,
      uses_left: s.permanent ? null : (typeof s.uses_left === 'number' ? s.uses_left : 1),
      uses_total: s.permanent ? null : (typeof s.uses_total === 'number' ? s.uses_total : (typeof s.uses_left === 'number' ? s.uses_left : 1)),
      can_reselect: !!(s.from_choice && s.choice_a && s.choice_b),
    }))
  const usedList = (Array.isArray(e.used_skills) ? e.used_skills : []).map((u: UsedSkill) => ({
    key: u.uid || u.used_at,
    name: u.name,
    level: u.level,
    used_at: u.used_at,
  }))
  const pending_choices = owned
    .filter(s => s.pending && s.choice_a && s.choice_b)
    .map(s => ({
      uid: s.uid,
      level: s.level,
      choice_a: s.choice_a!,
      choice_b: s.choice_b!,
    }))

  // 획득 뱃지 — 정의(이름/이모지)와 합쳐서 내려줌. 삭제된 뱃지는 표시에서 제외.
  const badgeDefs = await sb.select<BadgeRow>(
    'badges',
    `select=*&class_id=eq.${student.class_id}`,
  ).catch(() => [] as BadgeRow[])
  const earnedIds = new Set((Array.isArray(e.badges) ? e.badges : []).map((eb: EarnedBadge) => eb.badge_id))
  const earnedBadges = (Array.isArray(e.badges) ? e.badges : [])
    .map((eb: EarnedBadge) => {
      const d = badgeDefs.find(b => b.id === eb.badge_id)
      return d ? {
        badge_id: eb.badge_id,
        name: d.name,
        emoji: d.emoji,
        description: d.description,
        auto: !!eb.auto,
        awarded_at: eb.awarded_at,
      } : null
    })
    .filter(Boolean)

  // 아직 못 딴 자동 뱃지의 진행도 (레벨/XP는 즉시 계산, 활동 횟수는 로그 집계)
  const badgeProgress: any[] = []
  for (const b of badgeDefs) {
    if (!b.auto_type || earnedIds.has(b.id)) continue
    let current = 0
    const target = Number(b.auto_value) || 1
    if (b.auto_type === 'level') current = e.level
    else if (b.auto_type === 'xp') current = e.xp
    else if (b.auto_type === 'activity_count' && b.auto_activity) {
      const rows = await sb.select(
        'activity_logs',
        `select=id&student_id=eq.${student.id}&type=eq.score&name=eq.${encodeURIComponent(b.auto_activity)}`,
      ).catch(() => [])
      current = rows.length
    }
    badgeProgress.push({
      badge_id: b.id,
      name: b.name,
      emoji: b.emoji,
      auto_type: b.auto_type,
      auto_activity: b.auto_activity,
      current: Math.min(current, target),
      target,
    })
  }

  return c.json({
    ...e, skills, pending_choices, used_list: usedList,
    earned_badges: earnedBadges, badge_progress: badgeProgress,
  })
})

// =================================================================
// 학생 프로필 수정 (닉네임/아바타)
// =================================================================
app.put('/api/students/:id/profile', async (c) => {
  const id = c.req.param('id')
  const result = await loadOwnedStudent(c, id)
  if (result instanceof Response) return result

  const body = await c.req.json<{
    nickname?: string | null
    avatar_emoji?: string | null
    avatar_color?: string | null
    avatar_image?: string | null   // Base64 data URL ("data:image/jpeg;base64,...") 또는 null로 제거
  }>()
  const sb = makeSupabase(c.env)

  const patch: Record<string, any> = {}
  if (body.nickname !== undefined) {
    patch.nickname = body.nickname ? body.nickname.trim() || null : null
  }
  if (body.avatar_emoji !== undefined) patch.avatar_emoji = body.avatar_emoji || null
  if (body.avatar_color !== undefined) patch.avatar_color = body.avatar_color || null
  if (body.avatar_image !== undefined) {
    // 너무 큰 이미지는 거부 (클라이언트에서 200x200 JPEG로 압축해 보내야 함)
    // data URL은 원본의 약 1.37배 크기. 250KB까지 허용 (안전 마진).
    if (body.avatar_image && body.avatar_image.length > 250_000) {
      return c.json({ error: '이미지가 너무 큽니다 (최대 약 180KB)' }, 400)
    }
    patch.avatar_image = body.avatar_image || null
  }

  const updated = await sb.update<StudentRow>('students', patch, `id=eq.${id}`)
  if (!updated[0]) return c.json({ error: '학생을 찾을 수 없습니다' }, 404)

  return c.json({
    success: true,
    nickname: updated[0].nickname,
    avatar_emoji: updated[0].avatar_emoji,
    avatar_color: updated[0].avatar_color,
    avatar_image: updated[0].avatar_image,
  })
})

// =================================================================
// 점수 부여
// =================================================================
// 한 학생에게 점수를 적용 (XP 갱신 + 레벨업 시 스킬 해금 + 자동 뱃지 판정 + 코인 자동 적립).
// 로그는 저장하지 않고 반환만 함 — 호출자가 모아서 한 번에 insert.
// coinRate: XP 몇 점당 코인 1개 (0 = 자동 적립 끔). 누적 XP가 기준선(rate, 2*rate, …)을
// 넘을 때마다 1코인 — XP를 깎아도 코인은 뺏지 않음 (재획득 악용은 교실 규모에서 무시).
async function applyScoreToStudent(
  sb: any,
  levels: LevelRow[],
  student: StudentRow,
  activityName: string,
  delta: number,
  autoBadges: BadgeRow[] = [],
  coinRate: number = 0,
) {
  const oldLevel = calcLevel(student.xp, levels).level
  const newXp = Math.max(0, student.xp + delta)
  const newLevel = calcLevel(newXp, levels).level

  const ownedNow: OwnedSkill[] = Array.isArray(student.owned_skills)
    ? [...student.owned_skills]
    : []
  const newSkills: string[] = []
  const newPendingChoices: { uid: string; level: number; choice_a: string; choice_b: string }[] = []
  const levelUpLogs: ActivityLogRow[] = []

  if (newLevel > oldLevel) {
    for (const lv of levels) {
      if (lv.level > oldLevel && lv.level <= newLevel) {
        levelUpLogs.push({
          class_id: student.class_id,
          student_id: student.id,
          type: 'level_up',
          name: `레벨 ${lv.level} 달성`,
          score: 0,
        })

        if (lv.unlock_skill) {
          const parsed = parseUnlockSkill(lv.unlock_skill)
          const uid = shortUid()
          const nowIso = new Date().toISOString()
          if (parsed.is_choice && parsed.choice_a && parsed.choice_b) {
            ownedNow.push({
              uid,
              name: lv.unlock_skill,
              level: lv.level,
              pending: true,
              choice_a: parsed.choice_a,
              choice_b: parsed.choice_b,
              acquired_at: nowIso,
              uses_seed: Math.trunc(Number(lv.unlock_uses ?? 1)),
            })
            newPendingChoices.push({
              uid,
              level: lv.level,
              choice_a: parsed.choice_a,
              choice_b: parsed.choice_b,
            })
          } else if (parsed.plain) {
            ownedNow.push({
              uid,
              name: parsed.plain,
              level: lv.level,
              acquired_at: nowIso,
              ...skillUsesFields(lv.unlock_uses),
            })
            newSkills.push(parsed.plain)
          }
        }
      }
    }
  }

  // === 자동 뱃지 판정 (레벨 도달 / 누적 XP / 활동 횟수) ===
  const earnedList: EarnedBadge[] = Array.isArray(student.badges) ? [...student.badges] : []
  const newBadges: { badge_id: string; name: string; emoji: string }[] = []
  const badgeLogs: ActivityLogRow[] = []
  for (const b of autoBadges) {
    if (earnedList.some(e => e.badge_id === b.id)) continue
    let ok = false
    if (b.auto_type === 'level') {
      ok = newLevel >= (b.auto_value || 0)
    } else if (b.auto_type === 'xp') {
      ok = newXp >= (b.auto_value || 0)
    } else if (b.auto_type === 'activity_count' && b.auto_activity && b.auto_activity === activityName) {
      // 이번 활동까지 포함해 해당 활동을 몇 번 했는지 (로그는 아직 저장 전이라 +1)
      const rows = await sb.select(
        'activity_logs',
        `select=id&student_id=eq.${student.id}&type=eq.score&name=eq.${encodeURIComponent(b.auto_activity)}`,
      )
      ok = rows.length + 1 >= (b.auto_value || 1)
    }
    if (ok) {
      earnedList.push({ badge_id: b.id, awarded_at: new Date().toISOString(), auto: true })
      newBadges.push({ badge_id: b.id, name: b.name, emoji: b.emoji })
      badgeLogs.push({
        class_id: student.class_id,
        student_id: student.id,
        type: 'badge',
        name: `뱃지 획득: ${b.emoji} ${b.name}`,
        score: 0,
      })
    }
  }

  // === 코인 자동 적립 (XP 기준선 통과 수만큼) ===
  let earnedCoins = 0
  if (coinRate > 0 && delta > 0) {
    earnedCoins = Math.max(0, Math.floor(newXp / coinRate) - Math.floor(student.xp / coinRate))
  }

  const patch: Record<string, any> = { xp: newXp, owned_skills: ownedNow }
  if (newBadges.length) patch.badges = earnedList
  if (earnedCoins > 0) patch.coins = (Number(student.coins) || 0) + earnedCoins
  await sb.update('students', patch, `id=eq.${student.id}`, false)

  const logs: ActivityLogRow[] = [
    {
      class_id: student.class_id,
      student_id: student.id,
      type: 'score',
      name: activityName || '점수',
      score: delta,
    },
    ...levelUpLogs,
    ...badgeLogs,
  ]
  if (earnedCoins > 0) {
    logs.push({
      class_id: student.class_id,
      student_id: student.id,
      type: 'coin',
      name: `코인 +${earnedCoins} (XP 자동 적립)`,
      score: 0,
    })
  }
  return { oldLevel, newLevel, newXp, newSkills, newPendingChoices, newBadges, earnedCoins, logs }
}

// 학급의 코인 자동 적립 비율 로드 (설정 없거나 마이그레이션 전이면 0 = 끔)
async function loadCoinRate(sb: any, classId: string): Promise<number> {
  try {
    const [cls] = await sb.select('classes', `select=draw_config&id=eq.${classId}&limit=1`)
    const rate = Math.trunc(Number(cls?.draw_config?.coin_rate || 0))
    return rate > 0 ? rate : 0
  } catch {
    return 0
  }
}

app.post('/api/students/:id/score', async (c) => {
  const id = c.req.param('id')
  const result = await loadOwnedStudent(c, id)
  if (result instanceof Response) return result
  const { student } = result

  const body = await c.req.json<{ activity_name: string; score_delta: number }>()
  const sb = makeSupabase(c.env)
  const [levels, autoBadges, coinRate] = await Promise.all([
    sb.select<LevelRow>('levels', 'select=*&order=level.asc'),
    loadAutoBadges(sb, student.class_id),
    loadCoinRate(sb, student.class_id),
  ])

  const r = await applyScoreToStudent(sb, levels, student, body.activity_name, Number(body.score_delta || 0), autoBadges, coinRate)
  await sb.insert('activity_logs', r.logs, false)

  return c.json({
    success: true,
    old_level: r.oldLevel,
    new_level: r.newLevel,
    new_xp: r.newXp,
    leveled_up: r.newLevel > r.oldLevel,
    new_skills: r.newSkills,
    new_pending_choices: r.newPendingChoices,
    new_badges: r.newBadges,
    earned_coins: r.earnedCoins,
  })
})

// =================================================================
// 점수 일괄 부여 — 선택한 여러 학생에게 같은 활동/점수를 한 번에
// =================================================================
app.post('/api/classes/:classId/score-batch', async (c) => {
  const classId = c.req.param('classId')
  const owned = await loadOwnedClass(c, classId)
  if (owned instanceof Response) return owned

  const body = await c.req.json<{ student_ids: string[]; activity_name: string; score_delta: number }>()
  const ids = Array.isArray(body.student_ids) ? body.student_ids.filter(Boolean) : []
  if (!ids.length) return c.json({ error: '학생을 선택해주세요' }, 400)
  const delta = Number(body.score_delta || 0)

  const sb = makeSupabase(c.env)
  const idList = ids.map((v) => encodeURIComponent(String(v))).join(',')
  const students = await sb.select<StudentRow>(
    'students',
    `select=*&class_id=eq.${classId}&id=in.(${idList})`,
  )
  if (!students.length) return c.json({ error: '학생을 찾을 수 없습니다' }, 404)

  const [levels, autoBadges, coinRate] = await Promise.all([
    sb.select<LevelRow>('levels', 'select=*&order=level.asc'),
    loadAutoBadges(sb, classId),
    loadCoinRate(sb, classId),
  ])

  const allLogs: ActivityLogRow[] = []
  const results: any[] = []
  for (const st of students) {
    const r = await applyScoreToStudent(sb, levels, st, body.activity_name, delta, autoBadges, coinRate)
    allLogs.push(...r.logs)
    results.push({
      id: st.id,
      new_xp: r.newXp,
      new_level: r.newLevel,
      leveled_up: r.newLevel > r.oldLevel,
      new_skills: r.newSkills,
      new_pending_choices: r.newPendingChoices,
      new_badges: r.newBadges,
      earned_coins: r.earnedCoins,
    })
  }
  await sb.insert('activity_logs', allLogs, false)

  return c.json({ success: true, count: results.length, results })
})

// =================================================================
// HP 조정
// =================================================================
app.post('/api/students/:id/hp', async (c) => {
  const id = c.req.param('id')
  const result = await loadOwnedStudent(c, id)
  if (result instanceof Response) return result
  const { student } = result

  const body = await c.req.json<{ delta: number }>()
  const sb = makeSupabase(c.env)
  const maxHp = 3
  const newHp = Math.max(0, Math.min(maxHp, (student.hp || 0) + Number(body.delta || 0)))
  await sb.update('students', { hp: newHp }, `id=eq.${id}`, false)
  return c.json({ success: true, hp: newHp })
})

// =================================================================
// 스킬 사용
// =================================================================
app.post('/api/students/:id/skills/:uid/use', async (c) => {
  const studentId = c.req.param('id')
  const skillUid = c.req.param('uid')
  const result = await loadOwnedStudent(c, studentId)
  if (result instanceof Response) return result
  const { student } = result

  const sb = makeSupabase(c.env)
  const owned: OwnedSkill[] = Array.isArray(student.owned_skills) ? student.owned_skills : []
  const used: UsedSkill[] = Array.isArray(student.used_skills) ? student.used_skills : []

  const target = owned.find(s => s.uid === skillUid)
  if (!target) return c.json({ error: '스킬을 찾을 수 없습니다' }, 404)
  if (target.pending) return c.json({ error: '아직 선택하지 않은 보상은 사용할 수 없습니다' }, 400)
  if (target.permanent) return c.json({ error: '상시 스킬은 소모되지 않아요', code: 'PERMANENT' }, 400)

  // 남은 횟수: 명시값 없으면 1회권으로 간주(기존 데이터 호환)
  const left = typeof target.uses_left === 'number' ? target.uses_left : 1

  let newOwned: OwnedSkill[]
  let newUsed: UsedSkill[] = used
  let usesLeft = 0
  let consumed = true

  if (left > 1) {
    // 아직 남음 → 1 차감하고 보유 유지
    usesLeft = left - 1
    consumed = false
    newOwned = owned.map(s => (s.uid === skillUid ? { ...s, uses_left: usesLeft } : s))
  } else {
    // 마지막 1회 → 완전 소모(used로 이동). 복구를 위해 정보 보관
    newOwned = owned.filter(s => s.uid !== skillUid)
    newUsed = [
      ...used,
      {
        uid: target.uid,
        name: target.name,
        level: target.level,
        used_at: new Date().toISOString(),
        uses_total: typeof target.uses_total === 'number' ? target.uses_total : 1,
        choice_a: target.choice_a,
        choice_b: target.choice_b,
        from_choice: target.from_choice,
      },
    ]
  }

  await sb.update(
    'students',
    { owned_skills: newOwned, used_skills: newUsed },
    `id=eq.${studentId}`,
    false,
  )
  await sb.insert('activity_logs', [{
    class_id: student.class_id,
    student_id: student.id,
    type: 'skill_use',
    name: consumed ? `${target.name} 스킬 사용` : `${target.name} 스킬 사용 (${usesLeft}회 남음)`,
    score: 0,
  }], false)

  return c.json({ success: true, consumed, uses_left: usesLeft })
})

// =================================================================
// 선택형 보상 결정
// =================================================================
app.post('/api/students/:id/choices/:uid/resolve', async (c) => {
  const studentId = c.req.param('id')
  const choiceUid = c.req.param('uid')
  const result = await loadOwnedStudent(c, studentId)
  if (result instanceof Response) return result
  const { student } = result

  const body = await c.req.json<{ pick: 'A' | 'B' }>()
  const sb = makeSupabase(c.env)
  const owned: OwnedSkill[] = Array.isArray(student.owned_skills) ? student.owned_skills : []
  const target = owned.find(s => s.uid === choiceUid)
  if (!target || !target.pending) return c.json({ error: '선택 대기 항목을 찾을 수 없습니다' }, 404)

  const picked = body.pick === 'A'
    ? (target.choice_a || target.name)
    : (target.choice_b || target.name)

  const newOwned: OwnedSkill[] = owned.map(s => {
    if (s.uid !== choiceUid) return s
    return {
      uid: s.uid, name: picked, level: s.level, acquired_at: s.acquired_at,
      ...skillUsesFields(s.uses_seed ?? 1),
      choice_a: s.choice_a, choice_b: s.choice_b, from_choice: true, uses_seed: s.uses_seed ?? 1,
    }
  })

  await sb.update('students', { owned_skills: newOwned }, `id=eq.${studentId}`, false)
  await sb.insert('activity_logs', [{
    class_id: student.class_id,
    student_id: student.id,
    type: 'skill_choice',
    name: `Lv.${target.level} 보상 선택: ${picked}`,
    score: 0,
  }], false)

  return c.json({ success: true, picked })
})

// =================================================================
// 사용한 스킬 복구 (used → owned 되돌리기)
//   - :key 는 학생 GET 의 used_list[].key (uid 또는 used_at)
// =================================================================
app.post('/api/students/:id/skills/:key/restore', async (c) => {
  const studentId = c.req.param('id')
  const key = decodeURIComponent(c.req.param('key'))
  const result = await loadOwnedStudent(c, studentId)
  if (result instanceof Response) return result
  const { student } = result

  const sb = makeSupabase(c.env)
  const owned: OwnedSkill[] = Array.isArray(student.owned_skills) ? student.owned_skills : []
  const used: UsedSkill[] = Array.isArray(student.used_skills) ? student.used_skills : []

  const idx = used.findIndex(u => (u.uid || u.used_at) === key)
  if (idx < 0) return c.json({ error: '복구할 스킬을 찾을 수 없습니다' }, 404)
  const u = used[idx]

  const total = typeof u.uses_total === 'number' && u.uses_total >= 1 ? Math.min(3, u.uses_total) : 1
  const restored: OwnedSkill = {
    uid: u.uid || shortUid(),
    name: u.name,
    level: u.level,
    acquired_at: new Date().toISOString(),
    uses_left: total,
    uses_total: total,
  }
  if (u.from_choice && u.choice_a && u.choice_b) {
    restored.from_choice = true
    restored.choice_a = u.choice_a
    restored.choice_b = u.choice_b
    restored.uses_seed = total
  }

  const newUsed = used.filter((_, i) => i !== idx)
  const newOwned = [...owned, restored]
  await sb.update('students', { owned_skills: newOwned, used_skills: newUsed }, `id=eq.${studentId}`, false)
  await sb.insert('activity_logs', [{
    class_id: student.class_id, student_id: student.id, type: 'skill_use',
    name: `${u.name} 스킬 복구`, score: 0,
  }], false)

  return c.json({ success: true })
})

// =================================================================
// 보상 다시 선택 (A/B 선택으로 얻은 스킬을 선택 대기로 되돌림)
// =================================================================
app.post('/api/students/:id/skills/:uid/reselect', async (c) => {
  const studentId = c.req.param('id')
  const skillUid = c.req.param('uid')
  const result = await loadOwnedStudent(c, studentId)
  if (result instanceof Response) return result
  const { student } = result

  const sb = makeSupabase(c.env)
  const owned: OwnedSkill[] = Array.isArray(student.owned_skills) ? student.owned_skills : []
  const target = owned.find(s => s.uid === skillUid)
  if (!target) return c.json({ error: '스킬을 찾을 수 없습니다' }, 404)
  if (!target.from_choice || !target.choice_a || !target.choice_b) {
    return c.json({ error: '선택형 보상이 아니에요', code: 'NOT_CHOICE' }, 400)
  }

  const newOwned = owned.map(s => {
    if (s.uid !== skillUid) return s
    return {
      uid: s.uid,
      name: `[선택] A.${s.choice_a} / B.${s.choice_b}`,
      level: s.level,
      pending: true,
      choice_a: s.choice_a,
      choice_b: s.choice_b,
      acquired_at: s.acquired_at,
      uses_seed: typeof s.uses_seed === 'number' ? s.uses_seed : 1,
    } as OwnedSkill
  })
  await sb.update('students', { owned_skills: newOwned }, `id=eq.${studentId}`, false)
  return c.json({ success: true })
})

// =================================================================
// 활동 로그
// =================================================================
app.get('/api/classes/:classId/logs', async (c) => {
  const classId = c.req.param('classId')
  const owned = await loadOwnedClass(c, classId)
  if (owned instanceof Response) return owned

  const limit = Number(c.req.query('limit') || 200)
  const sb = makeSupabase(c.env)
  const [logs, students] = await Promise.all([
    sb.select<ActivityLogRow>(
      'activity_logs',
      `select=*&class_id=eq.${classId}&order=created_at.desc,id.desc&limit=${limit}`,
    ),
    sb.select<StudentRow>(
      'students',
      `select=id,name,nickname,avatar_color,avatar_emoji,avatar_image&class_id=eq.${classId}`,
    ),
  ])

  const map = new Map(students.map(s => [s.id, s]))
  const enriched = logs.map(l => {
    const s = map.get(l.student_id) as Partial<StudentRow> | undefined
    return {
      ...l,
      log_type: l.type,
      activity_name: l.name,
      score_delta: l.score,
      student_name: s?.name ?? '',
      student_nickname: s?.nickname ?? null,
      avatar_color: s?.avatar_color ?? null,
      avatar_emoji: s?.avatar_emoji ?? null,
      avatar_image: s?.avatar_image ?? null,
    }
  })

  return c.json(enriched)
})

// =================================================================
// 레벨표 (전역 - 모든 학급이 공통으로 사용)
//  학급 소유권 검증은 하되, levels 자체는 공통 테이블
// =================================================================
app.get('/api/classes/:classId/level-table', async (c) => {
  const classId = c.req.param('classId')
  const owned = await loadOwnedClass(c, classId)
  if (owned instanceof Response) return owned

  const sb = makeSupabase(c.env)
  const levels = await sb.select<LevelRow>('levels', 'select=*&order=level.asc')
  const mapped = levels.map(lv => {
    const parsed = parseUnlockSkill(lv.unlock_skill)
    return {
      level: lv.level,
      required_xp: lv.min_xp,
      min_xp: lv.min_xp,
      grade: lv.grade,
      rank: gradeToRank(lv.grade),
      passive_skill: lv.passive_skill,
      unlock_skill: lv.unlock_skill,
      unlock_uses: lv.unlock_uses ?? 1,
      is_choice: parsed.is_choice ? 1 : 0,
      choice_a: parsed.choice_a,
      choice_b: parsed.choice_b,
      reward_desc: parsed.plain,
    }
  })
  return c.json(mapped)
})

app.put('/api/classes/:classId/level-table/:level/skill', async (c) => {
  const classId = c.req.param('classId')
  const owned = await loadOwnedClass(c, classId)
  if (owned instanceof Response) return owned

  const level = Number(c.req.param('level'))
  const body = await c.req.json<{
    unlock_skill?: string | null
    passive_skill?: string | null
    choice_a?: string | null
    choice_b?: string | null
    reward_desc?: string | null
    unlock_uses?: number
  }>()
  const sb = makeSupabase(c.env)

  const existingRows = await sb.select<LevelRow>('levels', `select=*&level=eq.${level}&limit=1`)
  const existing = existingRows[0]
  if (!existing) return c.json({ error: '해당 레벨이 없습니다' }, 404)

  const patch: Record<string, any> = {}
  if (body.unlock_skill !== undefined) {
    patch.unlock_skill = body.unlock_skill || null
  } else if (body.choice_a !== undefined || body.choice_b !== undefined) {
    const cur = parseUnlockSkill(existing.unlock_skill)
    const a = body.choice_a !== undefined ? body.choice_a : cur.choice_a
    const b = body.choice_b !== undefined ? body.choice_b : cur.choice_b
    if (a && b) patch.unlock_skill = `[선택] A.${a} / B.${b}`
  } else if (body.reward_desc !== undefined) {
    patch.unlock_skill = body.reward_desc || null
  }
  if (body.passive_skill !== undefined) patch.passive_skill = body.passive_skill || null
  if (body.unlock_uses !== undefined) {
    const u = Math.trunc(Number(body.unlock_uses))
    patch.unlock_uses = u === 0 ? 0 : Math.min(3, Math.max(1, Number.isFinite(u) ? u : 1))
  }

  if (Object.keys(patch).length === 0) return c.json({ success: true, no_changes: true })

  await sb.update('levels', patch, `level=eq.${level}`, false)
  return c.json({ success: true })
})

// =================================================================
// 레벨 기준 XP / 등급 수정 (전역 levels 테이블)
//   - body: { min_xp?, grade? }
//   - min_xp 는 이전 레벨보다 크고 다음 레벨보다 작아야 함(순서 보존)
//   - grade 는 브론즈/실버/골드 중 하나
// =================================================================
app.put('/api/classes/:classId/level-table/:level', async (c) => {
  const classId = c.req.param('classId')
  const owned = await loadOwnedClass(c, classId)
  if (owned instanceof Response) return owned

  const level = Number(c.req.param('level'))
  const body = await c.req.json<{ min_xp?: number; grade?: string }>().catch(() => ({} as any))
  const sb = makeSupabase(c.env)

  const all = await sb.select<LevelRow>('levels', 'select=*&order=level.asc')
  const target = all.find(l => l.level === level)
  if (!target) return c.json({ error: '해당 레벨이 없습니다' }, 404)

  const patch: Record<string, any> = {}

  if (body.grade !== undefined) {
    const g = String(body.grade).trim()
    if (!['브론즈', '실버', '골드', '다이아'].includes(g)) {
      return c.json({ error: '등급은 브론즈/실버/골드/다이아 중 하나여야 합니다' }, 400)
    }
    patch.grade = g
  }

  if (body.min_xp !== undefined) {
    const xp = Math.trunc(Number(body.min_xp))
    if (!Number.isFinite(xp) || xp < 0) {
      return c.json({ error: '기준 XP는 0 이상의 숫자여야 합니다' }, 400)
    }
    if (level === 1 && xp !== 0) {
      return c.json({ error: '레벨 1의 기준 XP는 0이어야 합니다' }, 400)
    }
    const prev = all.filter(l => l.level < level).sort((a, b) => b.level - a.level)[0]
    const next = all.filter(l => l.level > level).sort((a, b) => a.level - b.level)[0]
    if (prev && xp <= prev.min_xp) {
      return c.json({ error: `기준 XP는 이전 레벨(Lv.${prev.level} = ${prev.min_xp})보다 커야 해요` }, 400)
    }
    if (next && xp >= next.min_xp) {
      return c.json({ error: `기준 XP는 다음 레벨(Lv.${next.level} = ${next.min_xp})보다 작아야 해요` }, 400)
    }
    patch.min_xp = xp
  }

  if (Object.keys(patch).length === 0) return c.json({ success: true, no_changes: true })

  await sb.update('levels', patch, `level=eq.${level}`, false)
  return c.json({ success: true, ...patch })
})

// =================================================================
// 레벨 추가 (가장 높은 레벨 위에 새 레벨 1개 추가)
//   - body: { grade? }  (없으면 직전 최고 레벨의 등급을 이어받음)
//   - min_xp 는 직전 간격만큼 자동으로 더 높게 설정 (이후 편집 가능)
// =================================================================
app.post('/api/classes/:classId/level-table', async (c) => {
  const classId = c.req.param('classId')
  const owned = await loadOwnedClass(c, classId)
  if (owned instanceof Response) return owned

  const body = await c.req.json<{ grade?: string }>().catch(() => ({} as any))
  const sb = makeSupabase(c.env)

  const all = await sb.select<LevelRow>('levels', 'select=*&order=level.asc')
  if (all.length === 0) return c.json({ error: '레벨표가 비어 있습니다' }, 400)

  const sorted = [...all].sort((a, b) => a.level - b.level)
  const last = sorted[sorted.length - 1]
  const secondLast = sorted[sorted.length - 2]
  let gap = secondLast ? last.min_xp - secondLast.min_xp : 1000
  if (!Number.isFinite(gap) || gap <= 0) gap = 1000

  const newLevel = last.level + 1
  const newMinXp = last.min_xp + gap

  let grade = last.grade
  if (body.grade !== undefined) {
    const g = String(body.grade).trim()
    if (!['브론즈', '실버', '골드', '다이아'].includes(g)) {
      return c.json({ error: '등급은 브론즈/실버/골드/다이아 중 하나여야 합니다' }, 400)
    }
    grade = g
  }

  await sb.insert('levels', [{
    level: newLevel,
    min_xp: newMinXp,
    grade,
    unlock_skill: null,
    passive_skill: last.passive_skill ?? null,
  }], false)

  return c.json({
    success: true,
    level: newLevel,
    min_xp: newMinXp,
    grade,
    rank: gradeToRank(grade),
  })
})

// =================================================================
// 레벨 삭제 (가장 높은 레벨만, 기본 30레벨 아래로는 못 내려감)
// =================================================================
app.delete('/api/classes/:classId/level-table/:level', async (c) => {
  const classId = c.req.param('classId')
  const owned = await loadOwnedClass(c, classId)
  if (owned instanceof Response) return owned

  const level = Number(c.req.param('level'))
  const sb = makeSupabase(c.env)

  const all = await sb.select<LevelRow>('levels', 'select=level&order=level.desc&limit=1')
  const maxLevel = all[0]?.level ?? 0
  if (level !== maxLevel) {
    return c.json({ error: '가장 높은 레벨만 삭제할 수 있어요', code: 'NOT_TOP_LEVEL' }, 400)
  }
  if (maxLevel <= 30) {
    return c.json({ error: '기본 30레벨은 삭제할 수 없어요', code: 'MIN_LEVELS' }, 400)
  }

  await sb.delete('levels', `level=eq.${level}`)
  return c.json({ success: true, deleted_level: level })
})

// =================================================================
// 활동(점수 버튼) CRUD
// =================================================================
// 활동명 → 이모지 자동 추천 (서버에서도 한 번 매칭. NULL인 경우의 대체값)
function suggestActivityEmoji(name: string): string | null {
  const n = (name || '').toLowerCase()
  const rules: Array<[RegExp, string]> = [
    [/숙제/, '📝'],
    [/출석|등교/, '✅'],
    [/지각/, '⏰'],
    [/독서|책/, '📚'],
    [/돕기|친구/, '🤝'],
    [/칭찬|쩐다|훌륭|폭풍/, '🌟'],
    [/벌점|감점/, '⚠️'],
    [/발표|말하기/, '🎤'],
    [/청소/, '🧹'],
    [/인사/, '👋'],
    [/그림|미술/, '🎨'],
    [/노래|음악/, '🎵'],
    [/체육|운동/, '⚽'],
    [/수학|문제/, '🧮'],
    [/영어/, '🔤'],
    [/과학|실험/, '🔬'],
    [/리더/, '👑'],
    [/멘토/, '🧑‍🏫'],
    [/일기|글쓰기/, '✏️'],
    [/실수|틀림/, '😅'],
    [/도전|모험/, '🗺️'],
    [/협동|모둠/, '🧩'],
    [/직접|기타|커스텀/, '✏️'],
  ]
  for (const [re, em] of rules) if (re.test(name)) return em
  return null
}

app.get('/api/classes/:classId/activities', async (c) => {
  const classId = c.req.param('classId')
  const owned = await loadOwnedClass(c, classId)
  if (owned instanceof Response) return owned

  const sb = makeSupabase(c.env)
  const rows = await sb.select<ActivityRow>(
    'activities',
    `select=*&class_id=eq.${classId}&order=sort_order.asc`,
  )
  const mapped = rows.map(a => ({
    id: a.id,
    class_id: a.class_id,
    name: a.name,
    score_delta: a.score,
    score: a.score,
    emoji: a.emoji || suggestActivityEmoji(a.name),  // NULL이면 이름 기반 추천
    sort_order: a.sort_order,
    is_custom_input: a.score === 0 ? 1 : 0,
  }))
  return c.json(mapped)
})

app.post('/api/classes/:classId/activities', async (c) => {
  const classId = c.req.param('classId')
  const owned = await loadOwnedClass(c, classId)
  if (owned instanceof Response) return owned

  const body = await c.req.json<{
    name: string
    score_delta?: number
    score?: number
    emoji?: string | null
    is_custom_input?: number
  }>()
  const sb = makeSupabase(c.env)

  const existing = await sb.select<ActivityRow>(
    'activities',
    `select=sort_order&class_id=eq.${classId}&order=sort_order.desc&limit=1`,
  )
  const nextOrder = (existing[0]?.sort_order || 0) + 1
  const score = body.is_custom_input ? 0 : Number(body.score_delta ?? body.score ?? 0)
  // 클라이언트가 emoji를 보냈으면 그것을, 아니면 이름 기반 자동 추천 (없으면 NULL)
  const emoji = body.emoji !== undefined ? (body.emoji || null) : suggestActivityEmoji(body.name)

  const inserted = await sb.insert<ActivityRow>('activities', [{
    class_id: classId,
    name: body.name,
    score,
    emoji,
    sort_order: nextOrder,
  }])
  return c.json({ success: true, id: inserted[0]?.id, emoji })
})

app.put('/api/activities/:id', async (c) => {
  const id = c.req.param('id')
  const result = await loadOwnedActivity(c, id)
  if (result instanceof Response) return result

  const body = await c.req.json<{
    name?: string
    score_delta?: number
    score?: number
    emoji?: string | null
  }>()
  const sb = makeSupabase(c.env)
  const patch: Record<string, any> = {}
  if (body.name !== undefined) patch.name = body.name
  if (body.score_delta !== undefined) patch.score = Number(body.score_delta)
  else if (body.score !== undefined) patch.score = Number(body.score)
  if (body.emoji !== undefined) patch.emoji = body.emoji || null
  if (Object.keys(patch).length === 0) return c.json({ success: true, no_changes: true })

  await sb.update('activities', patch, `id=eq.${id}`, false)
  return c.json({ success: true })
})

app.delete('/api/activities/:id', async (c) => {
  const id = c.req.param('id')
  const result = await loadOwnedActivity(c, id)
  if (result instanceof Response) return result

  const sb = makeSupabase(c.env)
  await sb.delete('activities', `id=eq.${id}`)
  return c.json({ success: true })
})

// =================================================================
// 뱃지 — 정의(CRUD)는 교사가 설정에서, 수여는 수동 또는 자동(점수 부여 시 판정)
// =================================================================
const BADGE_AUTO_TYPES = ['level', 'xp', 'activity_count']
const BADGE_TABLE_HINT = '뱃지 테이블이 아직 없어요. Supabase SQL Editor에서 supabase_0005_badges.sql 을 실행해주세요.'

// 자동 조건이 있는 뱃지만 로드 (테이블이 아직 없으면 빈 배열 — 점수 주기가 막히면 안 됨)
async function loadAutoBadges(sb: any, classId: string): Promise<BadgeRow[]> {
  try {
    return await sb.select('badges', `select=*&class_id=eq.${classId}&auto_type=not.is.null`)
  } catch {
    return []
  }
}

// body의 자동 조건 필드를 검증/정규화. 잘못된 값이면 에러 문자열 반환.
function normalizeBadgeAuto(body: any): { auto_type: string | null; auto_value: number | null; auto_activity: string | null } | string {
  const type = body.auto_type || null
  if (!type) return { auto_type: null, auto_value: null, auto_activity: null }
  if (!BADGE_AUTO_TYPES.includes(type)) return '알 수 없는 자동 조건 유형입니다'
  const value = Math.trunc(Number(body.auto_value || 0))
  if (value < 1) return '자동 조건 값은 1 이상이어야 합니다'
  const activity = (body.auto_activity || '').trim() || null
  if (type === 'activity_count' && !activity) return '횟수를 셀 활동을 골라주세요'
  return { auto_type: type, auto_value: value, auto_activity: type === 'activity_count' ? activity : null }
}

app.get('/api/classes/:classId/badges', async (c) => {
  const classId = c.req.param('classId')
  const owned = await loadOwnedClass(c, classId)
  if (owned instanceof Response) return owned

  const sb = makeSupabase(c.env)
  try {
    const badges = await sb.select<BadgeRow>(
      'badges',
      `select=*&class_id=eq.${classId}&order=sort_order.asc,created_at.asc`,
    )
    return c.json(badges)
  } catch {
    return c.json({ error: BADGE_TABLE_HINT, code: 'no_badge_table' }, 500)
  }
})

app.post('/api/classes/:classId/badges', async (c) => {
  const classId = c.req.param('classId')
  const owned = await loadOwnedClass(c, classId)
  if (owned instanceof Response) return owned

  const body = await c.req.json<any>().catch(() => ({}))
  const name = (body.name || '').trim()
  if (!name) return c.json({ error: '뱃지 이름을 입력해주세요' }, 400)
  const auto = normalizeBadgeAuto(body)
  if (typeof auto === 'string') return c.json({ error: auto }, 400)

  const sb = makeSupabase(c.env)
  try {
    const inserted = await sb.insert<BadgeRow>('badges', [{
      class_id: classId,
      name,
      emoji: (body.emoji || '').trim() || '🏅',
      description: (body.description || '').trim() || null,
      ...auto,
      sort_order: Math.trunc(Number(body.sort_order || 0)),
    }])
    return c.json({ success: true, badge: inserted[0] })
  } catch {
    return c.json({ error: BADGE_TABLE_HINT, code: 'no_badge_table' }, 500)
  }
})

app.put('/api/classes/:classId/badges/:id', async (c) => {
  const classId = c.req.param('classId')
  const id = c.req.param('id')
  const owned = await loadOwnedClass(c, classId)
  if (owned instanceof Response) return owned

  const body = await c.req.json<any>().catch(() => ({}))
  const patch: Record<string, any> = {}
  if (body.name !== undefined) {
    const name = (body.name || '').trim()
    if (!name) return c.json({ error: '뱃지 이름을 입력해주세요' }, 400)
    patch.name = name
  }
  if (body.emoji !== undefined) patch.emoji = (body.emoji || '').trim() || '🏅'
  if (body.description !== undefined) patch.description = (body.description || '').trim() || null
  if (body.auto_type !== undefined) {
    const auto = normalizeBadgeAuto(body)
    if (typeof auto === 'string') return c.json({ error: auto }, 400)
    Object.assign(patch, auto)
  }
  if (!Object.keys(patch).length) return c.json({ error: '수정할 내용이 없습니다' }, 400)

  const sb = makeSupabase(c.env)
  const updated = await sb.update<BadgeRow>('badges', patch, `id=eq.${id}&class_id=eq.${classId}`)
  if (!updated[0]) return c.json({ error: '뱃지를 찾을 수 없습니다' }, 404)
  return c.json({ success: true, badge: updated[0] })
})

app.delete('/api/classes/:classId/badges/:id', async (c) => {
  const classId = c.req.param('classId')
  const id = c.req.param('id')
  const owned = await loadOwnedClass(c, classId)
  if (owned instanceof Response) return owned

  const sb = makeSupabase(c.env)
  await sb.delete('badges', `id=eq.${id}&class_id=eq.${classId}`)
  return c.json({ success: true })
})

// 수동 수여 (이미 갖고 있으면 그대로 성공 처리)
app.post('/api/students/:id/badges/:badgeId', async (c) => {
  const id = c.req.param('id')
  const badgeId = c.req.param('badgeId')
  const result = await loadOwnedStudent(c, id)
  if (result instanceof Response) return result
  const { student } = result

  const sb = makeSupabase(c.env)
  const found = await sb.select<BadgeRow>(
    'badges',
    `select=*&id=eq.${badgeId}&class_id=eq.${student.class_id}&limit=1`,
  ).catch(() => [] as BadgeRow[])
  const badge = found[0]
  if (!badge) return c.json({ error: '뱃지를 찾을 수 없습니다' }, 404)

  const earned: EarnedBadge[] = Array.isArray(student.badges) ? [...student.badges] : []
  if (!earned.some(e => e.badge_id === badgeId)) {
    earned.push({ badge_id: badgeId, awarded_at: new Date().toISOString(), auto: false })
    await sb.update('students', { badges: earned }, `id=eq.${id}`, false)
    await sb.insert('activity_logs', [{
      class_id: student.class_id,
      student_id: student.id,
      type: 'badge',
      name: `뱃지 획득: ${badge.emoji} ${badge.name}`,
      score: 0,
    }], false)
  }
  return c.json({ success: true, badges: earned })
})

// 수여 취소 (잘못 준 경우) — 자동 뱃지는 조건이 계속 충족되면 다음 점수 부여 때 다시 붙음
app.delete('/api/students/:id/badges/:badgeId', async (c) => {
  const id = c.req.param('id')
  const badgeId = c.req.param('badgeId')
  const result = await loadOwnedStudent(c, id)
  if (result instanceof Response) return result
  const { student } = result

  const earned: EarnedBadge[] = (Array.isArray(student.badges) ? student.badges : [])
    .filter(e => e.badge_id !== badgeId)
  const sb = makeSupabase(c.env)
  await sb.update('students', { badges: earned }, `id=eq.${id}`, false)
  return c.json({ success: true, badges: earned })
})

// =================================================================
// 카드팩 뽑기 — 보상 XP 목록에서 서버가 무작위 추첨 (학급별 설정 가능)
// =================================================================
const MIGRATION_0006_HINT = '데이터베이스 준비가 필요해요. Supabase SQL Editor에서 supabase_0006_draw_team_shop.sql 을 실행해주세요.'
const DEFAULT_DRAW_REWARDS = [20, 40, 60, 80, 100]

app.put('/api/classes/:classId/draw-config', async (c) => {
  const classId = c.req.param('classId')
  const owned = await loadOwnedClass(c, classId)
  if (owned instanceof Response) return owned

  const body = await c.req.json<{ rewards?: number[]; coin_rate?: number }>().catch(() => ({} as any))

  const sb = makeSupabase(c.env)
  // 기존 설정을 읽어와 병합 (rewards만 저장할 때 coin_rate가 날아가지 않도록)
  let current: { rewards: number[]; coin_rate?: number } = { rewards: DEFAULT_DRAW_REWARDS }
  try {
    const [cls] = await sb.select<ClassRow>('classes', `select=draw_config&id=eq.${classId}&limit=1`)
    if (cls?.draw_config?.rewards?.length) current = { ...cls.draw_config }
  } catch {
    return c.json({ error: MIGRATION_0006_HINT, code: 'no_migration_0006' }, 500)
  }

  if (body.rewards !== undefined) {
    const rewards = (Array.isArray(body.rewards) ? body.rewards : [])
      .map(v => Math.trunc(Number(v)))
      .filter(v => Number.isFinite(v) && v >= 1 && v <= 10000)
    if (!rewards.length) return c.json({ error: '보상 XP를 1개 이상 입력해주세요 (1~10000)' }, 400)
    if (rewards.length > 30) return c.json({ error: '보상은 최대 30개까지 가능해요' }, 400)
    current.rewards = rewards
  }

  if (body.coin_rate !== undefined) {
    const rate = Math.trunc(Number(body.coin_rate))
    if (!Number.isFinite(rate) || rate < 0 || rate > 100000) {
      return c.json({ error: '코인 비율은 0(끄기) ~ 100000 사이여야 해요' }, 400)
    }
    current.coin_rate = rate
  }

  try {
    await sb.update('classes', { draw_config: current }, `id=eq.${classId}`, false)
  } catch {
    return c.json({ error: MIGRATION_0006_HINT, code: 'no_migration_0006' }, 500)
  }
  return c.json({ success: true, rewards: current.rewards, coin_rate: current.coin_rate || 0 })
})

app.post('/api/students/:id/draw', async (c) => {
  const id = c.req.param('id')
  const result = await loadOwnedStudent(c, id)
  if (result instanceof Response) return result
  const { student } = result

  const sb = makeSupabase(c.env)
  const [cls] = await sb.select<ClassRow>('classes', `select=*&id=eq.${student.class_id}&limit=1`)
  const rewards = (cls?.draw_config?.rewards && cls.draw_config.rewards.length)
    ? cls.draw_config.rewards
    : DEFAULT_DRAW_REWARDS
  const reward = rewards[Math.floor(Math.random() * rewards.length)]
  const coinRate = Math.max(0, Math.trunc(Number(cls?.draw_config?.coin_rate || 0)))

  const [levels, autoBadges] = await Promise.all([
    sb.select<LevelRow>('levels', 'select=*&order=level.asc'),
    loadAutoBadges(sb, student.class_id),
  ])
  const r = await applyScoreToStudent(sb, levels, student, '🎁 카드팩 뽑기', reward, autoBadges, coinRate)
  await sb.insert('activity_logs', r.logs, false)

  return c.json({
    success: true,
    reward,
    new_xp: r.newXp,
    new_level: r.newLevel,
    leveled_up: r.newLevel > r.oldLevel,
    new_skills: r.newSkills,
    new_pending_choices: r.newPendingChoices,
    new_badges: r.newBadges,
    earned_coins: r.earnedCoins,
  })
})

// =================================================================
// 모둠전 — 학생별 모둠 지정 (모둠 순위는 클라이언트가 학생 목록으로 계산)
// =================================================================
app.put('/api/students/:id/team', async (c) => {
  const id = c.req.param('id')
  const result = await loadOwnedStudent(c, id)
  if (result instanceof Response) return result

  const body = await c.req.json<{ team: string | null }>().catch(() => ({} as any))
  const team = (body.team || '').trim() || null

  const sb = makeSupabase(c.env)
  try {
    await sb.update('students', { team }, `id=eq.${id}`, false)
  } catch {
    return c.json({ error: MIGRATION_0006_HINT, code: 'no_migration_0006' }, 500)
  }
  return c.json({ success: true, team })
})

// =================================================================
// 상점 — 코인 조정 / 상품 CRUD / 구매 / 쿠폰 사용
// =================================================================
app.post('/api/students/:id/coins', async (c) => {
  const id = c.req.param('id')
  const result = await loadOwnedStudent(c, id)
  if (result instanceof Response) return result
  const { student } = result

  const body = await c.req.json<{ delta: number }>().catch(() => ({} as any))
  const delta = Math.trunc(Number(body.delta || 0))
  if (!delta) return c.json({ error: '조정할 코인 수를 입력해주세요' }, 400)

  const newCoins = Math.max(0, (Number(student.coins) || 0) + delta)
  const sb = makeSupabase(c.env)
  try {
    await sb.update('students', { coins: newCoins }, `id=eq.${id}`, false)
  } catch {
    return c.json({ error: MIGRATION_0006_HINT, code: 'no_migration_0006' }, 500)
  }
  await sb.insert('activity_logs', [{
    class_id: student.class_id,
    student_id: student.id,
    type: 'coin',
    name: `코인 ${delta > 0 ? '+' : ''}${delta}`,
    score: 0,
  }], false)
  return c.json({ success: true, coins: newCoins })
})

app.get('/api/classes/:classId/shop', async (c) => {
  const classId = c.req.param('classId')
  const owned = await loadOwnedClass(c, classId)
  if (owned instanceof Response) return owned

  const sb = makeSupabase(c.env)
  try {
    const items = await sb.select<ShopItemRow>(
      'shop_items',
      `select=*&class_id=eq.${classId}&order=sort_order.asc,created_at.asc`,
    )
    return c.json(items)
  } catch {
    return c.json({ error: MIGRATION_0006_HINT, code: 'no_migration_0006' }, 500)
  }
})

app.post('/api/classes/:classId/shop', async (c) => {
  const classId = c.req.param('classId')
  const owned = await loadOwnedClass(c, classId)
  if (owned instanceof Response) return owned

  const body = await c.req.json<any>().catch(() => ({}))
  const name = (body.name || '').trim()
  if (!name) return c.json({ error: '상품 이름을 입력해주세요' }, 400)
  const price = Math.trunc(Number(body.price || 1))
  if (price < 1) return c.json({ error: '가격은 1코인 이상이어야 해요' }, 400)

  const sb = makeSupabase(c.env)
  try {
    const inserted = await sb.insert<ShopItemRow>('shop_items', [{
      class_id: classId,
      name,
      emoji: (body.emoji || '').trim() || '🎟️',
      price,
      sort_order: Math.trunc(Number(body.sort_order || 0)),
    }])
    return c.json({ success: true, item: inserted[0] })
  } catch {
    return c.json({ error: MIGRATION_0006_HINT, code: 'no_migration_0006' }, 500)
  }
})

app.put('/api/classes/:classId/shop/:id', async (c) => {
  const classId = c.req.param('classId')
  const id = c.req.param('id')
  const owned = await loadOwnedClass(c, classId)
  if (owned instanceof Response) return owned

  const body = await c.req.json<any>().catch(() => ({}))
  const patch: Record<string, any> = {}
  if (body.name !== undefined) {
    const name = (body.name || '').trim()
    if (!name) return c.json({ error: '상품 이름을 입력해주세요' }, 400)
    patch.name = name
  }
  if (body.emoji !== undefined) patch.emoji = (body.emoji || '').trim() || '🎟️'
  if (body.price !== undefined) {
    const price = Math.trunc(Number(body.price || 0))
    if (price < 1) return c.json({ error: '가격은 1코인 이상이어야 해요' }, 400)
    patch.price = price
  }
  if (!Object.keys(patch).length) return c.json({ error: '수정할 내용이 없습니다' }, 400)

  const sb = makeSupabase(c.env)
  const updated = await sb.update<ShopItemRow>('shop_items', patch, `id=eq.${id}&class_id=eq.${classId}`)
  if (!updated[0]) return c.json({ error: '상품을 찾을 수 없습니다' }, 404)
  return c.json({ success: true, item: updated[0] })
})

app.delete('/api/classes/:classId/shop/:id', async (c) => {
  const classId = c.req.param('classId')
  const id = c.req.param('id')
  const owned = await loadOwnedClass(c, classId)
  if (owned instanceof Response) return owned

  const sb = makeSupabase(c.env)
  await sb.delete('shop_items', `id=eq.${id}&class_id=eq.${classId}`)
  return c.json({ success: true })
})

// 구매 — 코인 차감 + 쿠폰함에 추가
app.post('/api/students/:id/purchase/:itemId', async (c) => {
  const id = c.req.param('id')
  const itemId = c.req.param('itemId')
  const result = await loadOwnedStudent(c, id)
  if (result instanceof Response) return result
  const { student } = result

  const sb = makeSupabase(c.env)
  const found = await sb.select<ShopItemRow>(
    'shop_items',
    `select=*&id=eq.${itemId}&class_id=eq.${student.class_id}&limit=1`,
  ).catch(() => [] as ShopItemRow[])
  const item = found[0]
  if (!item) return c.json({ error: '상품을 찾을 수 없습니다' }, 404)

  const coins = Number(student.coins) || 0
  if (coins < item.price) {
    return c.json({ error: `코인이 부족해요 (보유 ${coins} / 필요 ${item.price})` }, 400)
  }

  const coupons: CouponItem[] = Array.isArray(student.coupons) ? [...student.coupons] : []
  coupons.push({
    uid: shortUid(),
    item_id: item.id,
    name: item.name,
    emoji: item.emoji,
    price: item.price,
    bought_at: new Date().toISOString(),
  })
  await sb.update('students', { coins: coins - item.price, coupons }, `id=eq.${id}`, false)
  await sb.insert('activity_logs', [{
    class_id: student.class_id,
    student_id: student.id,
    type: 'purchase',
    name: `구매: ${item.emoji} ${item.name} (${item.price}코인)`,
    score: 0,
  }], false)
  return c.json({ success: true, coins: coins - item.price, coupons })
})

// 쿠폰 사용 (사용 처리만, 기록 유지)
app.post('/api/students/:id/coupons/:uid/use', async (c) => {
  const id = c.req.param('id')
  const uid = c.req.param('uid')
  const result = await loadOwnedStudent(c, id)
  if (result instanceof Response) return result
  const { student } = result

  const coupons: CouponItem[] = Array.isArray(student.coupons) ? [...student.coupons] : []
  const target = coupons.find(cp => cp.uid === uid && !cp.used_at)
  if (!target) return c.json({ error: '사용할 수 있는 쿠폰이 없습니다' }, 404)
  target.used_at = new Date().toISOString()

  const sb = makeSupabase(c.env)
  await sb.update('students', { coupons }, `id=eq.${id}`, false)
  await sb.insert('activity_logs', [{
    class_id: student.class_id,
    student_id: student.id,
    type: 'coupon_use',
    name: `쿠폰 사용: ${target.emoji} ${target.name}`,
    score: 0,
  }], false)
  return c.json({ success: true, coupons })
})

export default app
