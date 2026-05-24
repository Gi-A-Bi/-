import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { renderer } from './renderer'
import type {
  Bindings,
  StudentRow,
  LevelRow,
  ActivityRow,
  ActivityLogRow,
  OwnedSkill,
  UsedSkill,
} from './types'
import {
  calcLevel,
  nextLevel,
  gradeToRank,
  parseUnlockSkill,
  shortUid,
} from './types'
import { makeSupabase } from './supabase'

const app = new Hono<{ Bindings: Bindings }>()

app.use('/api/*', cors())
app.use(renderer)

// =================================================================
// 메인 페이지 (SPA 쉘)
// =================================================================
app.get('/', (c) => {
  return c.render(
    <div id="app">
      <header class="app-header">
        <div class="header-inner">
          <div class="header-title" id="header-title">
            <span class="logo-icon">🎮</span>
            <span id="header-title-text">
              <span class="brand-ko">클업</span>
              <span class="brand-en">CLASS UP</span>
            </span>
          </div>
          <div class="header-actions">
            <button class="icon-btn" id="nav-logs" title="활동 기록">📜</button>
            <button class="icon-btn" id="nav-settings" title="설정">⚙️</button>
          </div>
        </div>
      </header>

      <main id="main-view"></main>

      <div id="toast-container"></div>
      <div id="modal-container"></div>
    </div>
  )
})

// =================================================================
// 헬퍼: 학생 row → enriched (level/rank/passive/skill_count 등 부착)
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
// 학급 정보
// =================================================================
app.get('/api/classes', async (c) => {
  const sb = makeSupabase(c.env)
  const rows = await sb.select('classes', 'select=*&order=created_at.asc')
  return c.json(rows)
})

// 기본 학급 ID 반환 (프론트 부트스트랩)
app.get('/api/bootstrap', async (c) => {
  const sb = makeSupabase(c.env)
  const cls = await sb.select('classes', 'select=*&order=created_at.asc&limit=1')
  return c.json({
    class: cls[0] || null,
    default_class_id: c.env.DEFAULT_CLASS_ID,
  })
})

// =================================================================
// 학생 목록
// =================================================================
app.get('/api/classes/:classId/students', async (c) => {
  const classId = c.req.param('classId')
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
// 학생 상세
// =================================================================
app.get('/api/students/:id', async (c) => {
  const id = c.req.param('id')
  const sb = makeSupabase(c.env)

  const rows = await sb.select<StudentRow>(
    'students',
    `select=*&id=eq.${id}&limit=1`,
  )
  const student = rows[0]
  if (!student) return c.json({ error: '학생을 찾을 수 없습니다' }, 404)

  const levels = await sb.select<LevelRow>('levels', 'select=*&order=level.asc')

  const e = enrichStudent(student, levels)

  // 프론트에서 사용하던 skills / pending_choices 분리 표현 호환
  const owned = e.owned_skills
  const skills = owned
    .filter(s => !s.pending)
    .map(s => ({
      uid: s.uid,
      skill_name: s.name,
      source_level: s.level,
      acquired_at: s.acquired_at,
    }))
  const pending_choices = owned
    .filter(s => s.pending && s.choice_a && s.choice_b)
    .map(s => ({
      uid: s.uid,
      level: s.level,
      choice_a: s.choice_a!,
      choice_b: s.choice_b!,
    }))

  return c.json({
    ...e,
    skills,
    pending_choices,
  })
})

// =================================================================
// 학생 프로필 수정 (닉네임/아바타)
// =================================================================
app.put('/api/students/:id/profile', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<{
    nickname?: string | null
    avatar_emoji?: string | null
    avatar_color?: string | null
  }>()
  const sb = makeSupabase(c.env)

  const patch: Record<string, any> = {}
  if (body.nickname !== undefined) {
    patch.nickname = body.nickname ? body.nickname.trim() || null : null
  }
  if (body.avatar_emoji !== undefined) {
    patch.avatar_emoji = body.avatar_emoji || null
  }
  if (body.avatar_color !== undefined) {
    patch.avatar_color = body.avatar_color || null
  }

  const updated = await sb.update<StudentRow>(
    'students',
    patch,
    `id=eq.${id}`,
  )
  if (!updated[0]) return c.json({ error: '학생을 찾을 수 없습니다' }, 404)

  return c.json({
    success: true,
    nickname: updated[0].nickname,
    avatar_emoji: updated[0].avatar_emoji,
    avatar_color: updated[0].avatar_color,
  })
})

// =================================================================
// 점수 부여 (XP 변경 + 활동 로그 + 레벨업 시 보유 스킬 자동 지급)
// =================================================================
app.post('/api/students/:id/score', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<{ activity_name: string; score_delta: number }>()
  const sb = makeSupabase(c.env)

  const studentRows = await sb.select<StudentRow>(
    'students',
    `select=*&id=eq.${id}&limit=1`,
  )
  const student = studentRows[0]
  if (!student) return c.json({ error: '학생을 찾을 수 없습니다' }, 404)

  const levels = await sb.select<LevelRow>('levels', 'select=*&order=level.asc')

  const oldLevel = calcLevel(student.xp, levels).level
  const newXp = Math.max(0, student.xp + Number(body.score_delta || 0))
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
        // 레벨업 로그
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
            })
            newSkills.push(parsed.plain)
          }
        }
      }
    }
  }

  // 학생 업데이트 (xp + owned_skills)
  await sb.update<StudentRow>(
    'students',
    { xp: newXp, owned_skills: ownedNow },
    `id=eq.${id}`,
    false,
  )

  // 점수 로그 + 레벨업 로그 한 번에 insert
  const logs: ActivityLogRow[] = [
    {
      class_id: student.class_id,
      student_id: student.id,
      type: 'score',
      name: body.activity_name || '점수',
      score: Number(body.score_delta || 0),
    },
    ...levelUpLogs,
  ]
  await sb.insert('activity_logs', logs, false)

  return c.json({
    success: true,
    old_level: oldLevel,
    new_level: newLevel,
    new_xp: newXp,
    leveled_up: newLevel > oldLevel,
    new_skills: newSkills,
    new_pending_choices: newPendingChoices,
  })
})

// =================================================================
// HP 조정
// =================================================================
app.post('/api/students/:id/hp', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<{ delta: number }>()
  const sb = makeSupabase(c.env)

  const rows = await sb.select<StudentRow>(
    'students',
    `select=*&id=eq.${id}&limit=1`,
  )
  const student = rows[0]
  if (!student) return c.json({ error: '학생을 찾을 수 없습니다' }, 404)

  const maxHp = 3
  const newHp = Math.max(0, Math.min(maxHp, (student.hp || 0) + Number(body.delta || 0)))

  await sb.update('students', { hp: newHp }, `id=eq.${id}`, false)
  return c.json({ success: true, hp: newHp })
})

// =================================================================
// 스킬 사용 (owned → used 이동 + activity_logs)
// =================================================================
app.post('/api/students/:id/skills/:uid/use', async (c) => {
  const studentId = c.req.param('id')
  const skillUid = c.req.param('uid')
  const sb = makeSupabase(c.env)

  const rows = await sb.select<StudentRow>(
    'students',
    `select=*&id=eq.${studentId}&limit=1`,
  )
  const student = rows[0]
  if (!student) return c.json({ error: '학생을 찾을 수 없습니다' }, 404)

  const owned: OwnedSkill[] = Array.isArray(student.owned_skills) ? student.owned_skills : []
  const used: UsedSkill[] = Array.isArray(student.used_skills) ? student.used_skills : []

  const target = owned.find(s => s.uid === skillUid)
  if (!target) return c.json({ error: '스킬을 찾을 수 없습니다' }, 404)
  if (target.pending) return c.json({ error: '아직 선택하지 않은 보상은 사용할 수 없습니다' }, 400)

  const newOwned = owned.filter(s => s.uid !== skillUid)
  const newUsed: UsedSkill[] = [
    ...used,
    {
      name: target.name,
      level: target.level,
      used_at: new Date().toISOString(),
    },
  ]

  await sb.update(
    'students',
    { owned_skills: newOwned, used_skills: newUsed },
    `id=eq.${studentId}`,
    false,
  )

  await sb.insert(
    'activity_logs',
    [{
      class_id: student.class_id,
      student_id: student.id,
      type: 'skill_use',
      name: `${target.name} 스킬 사용`,
      score: 0,
    }],
    false,
  )

  return c.json({ success: true })
})

// =================================================================
// 선택형 보상 결정
// =================================================================
app.post('/api/students/:id/choices/:uid/resolve', async (c) => {
  const studentId = c.req.param('id')
  const choiceUid = c.req.param('uid')
  const body = await c.req.json<{ pick: 'A' | 'B' }>()
  const sb = makeSupabase(c.env)

  const rows = await sb.select<StudentRow>(
    'students',
    `select=*&id=eq.${studentId}&limit=1`,
  )
  const student = rows[0]
  if (!student) return c.json({ error: '학생을 찾을 수 없습니다' }, 404)

  const owned: OwnedSkill[] = Array.isArray(student.owned_skills) ? student.owned_skills : []
  const target = owned.find(s => s.uid === choiceUid)
  if (!target || !target.pending) {
    return c.json({ error: '선택 대기 항목을 찾을 수 없습니다' }, 404)
  }

  const picked = body.pick === 'A'
    ? (target.choice_a || target.name)
    : (target.choice_b || target.name)

  const newOwned: OwnedSkill[] = owned.map(s => {
    if (s.uid !== choiceUid) return s
    return {
      uid: s.uid,
      name: picked,
      level: s.level,
      acquired_at: s.acquired_at,
      // pending/choice_a/choice_b 제거
    }
  })

  await sb.update(
    'students',
    { owned_skills: newOwned },
    `id=eq.${studentId}`,
    false,
  )

  await sb.insert(
    'activity_logs',
    [{
      class_id: student.class_id,
      student_id: student.id,
      type: 'skill_choice',
      name: `Lv.${target.level} 보상 선택: ${picked}`,
      score: 0,
    }],
    false,
  )

  return c.json({ success: true, picked })
})

// =================================================================
// 활동 로그
// =================================================================
app.get('/api/classes/:classId/logs', async (c) => {
  const classId = c.req.param('classId')
  const limit = Number(c.req.query('limit') || 200)
  const sb = makeSupabase(c.env)

  const [logs, students] = await Promise.all([
    sb.select<ActivityLogRow>(
      'activity_logs',
      `select=*&class_id=eq.${classId}&order=created_at.desc,id.desc&limit=${limit}`,
    ),
    sb.select<StudentRow>(
      'students',
      `select=id,name,nickname,avatar_color,avatar_emoji&class_id=eq.${classId}`,
    ),
  ])

  const map = new Map(students.map(s => [s.id, s]))
  const enriched = logs.map(l => {
    const s = map.get(l.student_id) as Partial<StudentRow> | undefined
    return {
      ...l,
      // 프론트 호환을 위해 기존 컬럼명 유지
      log_type: l.type,
      activity_name: l.name,
      score_delta: l.score,
      student_name: s?.name ?? '',
      student_nickname: s?.nickname ?? null,
      avatar_color: s?.avatar_color ?? null,
      avatar_emoji: s?.avatar_emoji ?? null,
    }
  })

  return c.json(enriched)
})

// =================================================================
// 레벨표 (구조는 고정. 클라이언트 표시용)
// =================================================================
app.get('/api/classes/:classId/level-table', async (c) => {
  const sb = makeSupabase(c.env)
  const levels = await sb.select<LevelRow>('levels', 'select=*&order=level.asc')
  // 프론트가 사용하던 필드(rank, required_xp, is_choice, choice_a, choice_b) 매핑
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
      is_choice: parsed.is_choice ? 1 : 0,
      choice_a: parsed.choice_a,
      choice_b: parsed.choice_b,
      reward_desc: parsed.plain,
    }
  })
  return c.json(mapped)
})

// 레벨표 - 스킬 내용 수정 (unlock_skill / passive_skill 만)
app.put('/api/classes/:classId/level-table/:level/skill', async (c) => {
  const level = Number(c.req.param('level'))
  const body = await c.req.json<{
    unlock_skill?: string | null
    passive_skill?: string | null
    // 호환을 위해 옛 필드도 받지만, choice_a/b가 들어오면 합쳐서 unlock_skill로 저장
    choice_a?: string | null
    choice_b?: string | null
    reward_desc?: string | null
  }>()
  const sb = makeSupabase(c.env)

  const existingRows = await sb.select<LevelRow>(
    'levels',
    `select=*&level=eq.${level}&limit=1`,
  )
  const existing = existingRows[0]
  if (!existing) return c.json({ error: '해당 레벨이 없습니다' }, 404)

  const patch: Record<string, any> = {}

  // unlock_skill 우선 적용. choice_a/b가 함께 들어오면 "[선택] A.x / B.y" 로 합성
  if (body.unlock_skill !== undefined) {
    patch.unlock_skill = body.unlock_skill || null
  } else if (body.choice_a !== undefined || body.choice_b !== undefined) {
    const cur = parseUnlockSkill(existing.unlock_skill)
    const a = body.choice_a !== undefined ? body.choice_a : cur.choice_a
    const b = body.choice_b !== undefined ? body.choice_b : cur.choice_b
    if (a && b) {
      patch.unlock_skill = `[선택] A.${a} / B.${b}`
    }
  } else if (body.reward_desc !== undefined) {
    patch.unlock_skill = body.reward_desc || null
  }

  if (body.passive_skill !== undefined) {
    patch.passive_skill = body.passive_skill || null
  }

  if (Object.keys(patch).length === 0) {
    return c.json({ success: true, no_changes: true })
  }

  await sb.update('levels', patch, `level=eq.${level}`, false)
  return c.json({ success: true })
})

// =================================================================
// 활동(점수 버튼) CRUD
// =================================================================
app.get('/api/classes/:classId/activities', async (c) => {
  const classId = c.req.param('classId')
  const sb = makeSupabase(c.env)
  const rows = await sb.select<ActivityRow>(
    'activities',
    `select=*&class_id=eq.${classId}&order=sort_order.asc`,
  )
  // 프론트 호환: score_delta 필드 매핑
  const mapped = rows.map(a => ({
    id: a.id,
    class_id: a.class_id,
    name: a.name,
    score_delta: a.score,
    score: a.score,
    sort_order: a.sort_order,
    is_custom_input: a.score === 0 ? 1 : 0,
  }))
  return c.json(mapped)
})

app.post('/api/classes/:classId/activities', async (c) => {
  const classId = c.req.param('classId')
  const body = await c.req.json<{
    name: string
    score_delta?: number
    score?: number
    is_custom_input?: number
  }>()
  const sb = makeSupabase(c.env)

  const existing = await sb.select<ActivityRow>(
    'activities',
    `select=sort_order&class_id=eq.${classId}&order=sort_order.desc&limit=1`,
  )
  const nextOrder = (existing[0]?.sort_order || 0) + 1

  const score = body.is_custom_input
    ? 0
    : Number(body.score_delta ?? body.score ?? 0)

  const inserted = await sb.insert<ActivityRow>(
    'activities',
    [{
      class_id: classId,
      name: body.name,
      score,
      sort_order: nextOrder,
    }],
  )

  return c.json({ success: true, id: inserted[0]?.id })
})

app.put('/api/activities/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<{
    name?: string
    score_delta?: number
    score?: number
  }>()
  const sb = makeSupabase(c.env)

  const patch: Record<string, any> = {}
  if (body.name !== undefined) patch.name = body.name
  if (body.score_delta !== undefined) patch.score = Number(body.score_delta)
  else if (body.score !== undefined) patch.score = Number(body.score)

  if (Object.keys(patch).length === 0) {
    return c.json({ success: true, no_changes: true })
  }

  await sb.update('activities', patch, `id=eq.${id}`, false)
  return c.json({ success: true })
})

app.delete('/api/activities/:id', async (c) => {
  const id = c.req.param('id')
  const sb = makeSupabase(c.env)
  await sb.delete('activities', `id=eq.${id}`)
  return c.json({ success: true })
})

export default app
