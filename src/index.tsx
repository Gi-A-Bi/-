import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { renderer } from './renderer'
import type {
  Bindings,
  StudentRow,
  LevelRow,
  StudentSkillRow,
  PendingChoiceRow,
  ActivityLogRow,
  ActivityRow,
} from './types'
import { calcLevel, nextLevel } from './types'

const app = new Hono<{ Bindings: Bindings }>()

app.use('/api/*', cors())
app.use(renderer)

// ===== 메인 페이지 (SPA 쉘) =====
app.get('/', (c) => {
  return c.render(
    <div id="app">
      {/* 헤더 */}
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

      {/* 메인 컨텐츠 영역 (JS가 화면 전환) */}
      <main id="main-view"></main>

      {/* 토스트 컨테이너 */}
      <div id="toast-container"></div>

      {/* 모달 컨테이너 */}
      <div id="modal-container"></div>
    </div>
  )
})

// =================================================================
// API 라우트
// =================================================================

// ----- 학급 (확장 대비) -----
app.get('/api/classes', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM classes ORDER BY id`
  ).all()
  return c.json(results)
})

// ----- 학생 목록 (학급별, 레벨/등급/패시브스킬 포함) -----
app.get('/api/classes/:classId/students', async (c) => {
  const classId = Number(c.req.param('classId'))

  const studentsRes = await c.env.DB.prepare(
    `SELECT * FROM students WHERE class_id = ? ORDER BY id`
  ).bind(classId).all<StudentRow>()
  const students = studentsRes.results

  const levelTableRes = await c.env.DB.prepare(
    `SELECT * FROM level_table WHERE class_id = ? ORDER BY level`
  ).bind(classId).all<LevelRow>()
  const levelTable = levelTableRes.results

  // 보유 스킬 갯수
  const skillCountRes = await c.env.DB.prepare(
    `SELECT student_id, COUNT(*) as cnt FROM student_skills
     WHERE student_id IN (SELECT id FROM students WHERE class_id = ?)
     GROUP BY student_id`
  ).bind(classId).all<{ student_id: number, cnt: number }>()
  const skillCountMap = new Map(skillCountRes.results.map(r => [r.student_id, r.cnt]))

  // 보류 중인 선택
  const pendingRes = await c.env.DB.prepare(
    `SELECT student_id, COUNT(*) as cnt FROM pending_choices
     WHERE student_id IN (SELECT id FROM students WHERE class_id = ?)
     GROUP BY student_id`
  ).bind(classId).all<{ student_id: number, cnt: number }>()
  const pendingMap = new Map(pendingRes.results.map(r => [r.student_id, r.cnt]))

  const enriched = students.map(s => {
    const lv = calcLevel(s.xp, levelTable)
    return {
      ...s,
      level: lv.level,
      rank: lv.rank,
      passive_skill: lv.passive_skill,
      skill_count: skillCountMap.get(s.id) || 0,
      pending_choice_count: pendingMap.get(s.id) || 0,
    }
  })

  return c.json(enriched)
})

// ----- 학생 상세 (캐릭터 시트) -----
app.get('/api/students/:id', async (c) => {
  const id = Number(c.req.param('id'))

  const student = await c.env.DB.prepare(
    `SELECT * FROM students WHERE id = ?`
  ).bind(id).first<StudentRow>()

  if (!student) return c.json({ error: '학생을 찾을 수 없습니다' }, 404)

  const levelTableRes = await c.env.DB.prepare(
    `SELECT * FROM level_table WHERE class_id = ? ORDER BY level`
  ).bind(student.class_id).all<LevelRow>()
  const levelTable = levelTableRes.results

  const skillsRes = await c.env.DB.prepare(
    `SELECT * FROM student_skills WHERE student_id = ? ORDER BY acquired_at DESC`
  ).bind(id).all<StudentSkillRow>()

  const pendingRes = await c.env.DB.prepare(
    `SELECT pc.*, lt.reward_desc
     FROM pending_choices pc
     LEFT JOIN level_table lt ON lt.class_id = ? AND lt.level = pc.level
     WHERE pc.student_id = ? ORDER BY pc.level ASC`
  ).bind(student.class_id, id).all<PendingChoiceRow & { reward_desc: string | null }>()

  const currentLv = calcLevel(student.xp, levelTable)
  const nextLv = nextLevel(student.xp, levelTable)

  return c.json({
    ...student,
    level: currentLv.level,
    rank: currentLv.rank,
    passive_skill: currentLv.passive_skill,
    current_required_xp: currentLv.required_xp,
    next_level: nextLv?.level ?? null,
    next_required_xp: nextLv?.required_xp ?? null,
    skills: skillsRes.results,
    pending_choices: pendingRes.results,
  })
})

// ----- 학생 프로필 수정 (닉네임, 아바타 이모지·색상) -----
app.put('/api/students/:id/profile', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json<{
    nickname?: string | null
    avatar_emoji?: string | null
    avatar_color?: string
  }>()

  const student = await c.env.DB.prepare(
    `SELECT * FROM students WHERE id = ?`
  ).bind(id).first<StudentRow>()
  if (!student) return c.json({ error: '학생을 찾을 수 없습니다' }, 404)

  const nickname = body.nickname !== undefined
    ? (body.nickname ? body.nickname.trim() || null : null)
    : student.nickname
  const avatar_emoji = body.avatar_emoji !== undefined
    ? (body.avatar_emoji || null)
    : student.avatar_emoji
  const avatar_color = body.avatar_color !== undefined
    ? (body.avatar_color || student.avatar_color)
    : student.avatar_color

  await c.env.DB.prepare(
    `UPDATE students SET nickname = ?, avatar_emoji = ?, avatar_color = ? WHERE id = ?`
  ).bind(nickname, avatar_emoji, avatar_color, id).run()

  return c.json({ success: true, nickname, avatar_emoji, avatar_color })
})

// ----- 점수 부여 -----
app.post('/api/students/:id/score', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json<{ activity_name: string, score_delta: number }>()

  const student = await c.env.DB.prepare(
    `SELECT * FROM students WHERE id = ?`
  ).bind(id).first<StudentRow>()
  if (!student) return c.json({ error: '학생을 찾을 수 없습니다' }, 404)

  const levelTableRes = await c.env.DB.prepare(
    `SELECT * FROM level_table WHERE class_id = ? ORDER BY level`
  ).bind(student.class_id).all<LevelRow>()
  const levelTable = levelTableRes.results

  const oldLevel = calcLevel(student.xp, levelTable).level
  const newXp = Math.max(0, student.xp + body.score_delta)
  const newLevelRow = calcLevel(newXp, levelTable)
  const newLevel = newLevelRow.level

  // XP 업데이트
  await c.env.DB.prepare(
    `UPDATE students SET xp = ? WHERE id = ?`
  ).bind(newXp, id).run()

  // 활동 기록
  await c.env.DB.prepare(
    `INSERT INTO activity_logs (student_id, class_id, log_type, activity_name, score_delta)
     VALUES (?, ?, 'score', ?, ?)`
  ).bind(id, student.class_id, body.activity_name, body.score_delta).run()

  // 레벨업 처리
  const newSkills: string[] = []
  const newPendingChoices: { level: number, choice_a: string, choice_b: string }[] = []
  if (newLevel > oldLevel) {
    // oldLevel+1 ~ newLevel 사이의 모든 레벨에 대해 보상 지급
    for (const lv of levelTable) {
      if (lv.level > oldLevel && lv.level <= newLevel) {
        // 레벨업 기록
        await c.env.DB.prepare(
          `INSERT INTO activity_logs (student_id, class_id, log_type, activity_name, score_delta)
           VALUES (?, ?, 'level_up', ?, 0)`
        ).bind(id, student.class_id, `레벨 ${lv.level} 달성`).run()

        if (lv.is_choice && lv.choice_a && lv.choice_b) {
          // 선택형: pending_choices에 추가
          await c.env.DB.prepare(
            `INSERT OR IGNORE INTO pending_choices (student_id, level, choice_a, choice_b)
             VALUES (?, ?, ?, ?)`
          ).bind(id, lv.level, lv.choice_a, lv.choice_b).run()
          newPendingChoices.push({ level: lv.level, choice_a: lv.choice_a, choice_b: lv.choice_b })
        } else if (lv.unlock_skill) {
          // 일반 해금 스킬 자동 지급
          await c.env.DB.prepare(
            `INSERT INTO student_skills (student_id, skill_name, source_level)
             VALUES (?, ?, ?)`
          ).bind(id, lv.unlock_skill, lv.level).run()
          newSkills.push(lv.unlock_skill)
        }
      }
    }
  }

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

// ----- HP 조정 -----
app.post('/api/students/:id/hp', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json<{ delta: number }>()

  const student = await c.env.DB.prepare(
    `SELECT * FROM students WHERE id = ?`
  ).bind(id).first<StudentRow>()
  if (!student) return c.json({ error: '학생을 찾을 수 없습니다' }, 404)

  const newHp = Math.max(0, Math.min(student.max_hp, student.hp + body.delta))
  await c.env.DB.prepare(`UPDATE students SET hp = ? WHERE id = ?`)
    .bind(newHp, id).run()

  return c.json({ success: true, hp: newHp })
})

// ----- 스킬 사용 (소모) -----
app.post('/api/students/:id/skills/:skillId/use', async (c) => {
  const studentId = Number(c.req.param('id'))
  const skillId = Number(c.req.param('skillId'))

  const skill = await c.env.DB.prepare(
    `SELECT * FROM student_skills WHERE id = ? AND student_id = ?`
  ).bind(skillId, studentId).first<StudentSkillRow>()
  if (!skill) return c.json({ error: '스킬을 찾을 수 없습니다' }, 404)

  const student = await c.env.DB.prepare(
    `SELECT class_id FROM students WHERE id = ?`
  ).bind(studentId).first<{ class_id: number }>()
  if (!student) return c.json({ error: '학생을 찾을 수 없습니다' }, 404)

  // 스킬 삭제
  await c.env.DB.prepare(`DELETE FROM student_skills WHERE id = ?`).bind(skillId).run()

  // 로그
  await c.env.DB.prepare(
    `INSERT INTO activity_logs (student_id, class_id, log_type, activity_name, score_delta)
     VALUES (?, ?, 'skill_use', ?, 0)`
  ).bind(studentId, student.class_id, `${skill.skill_name} 스킬 사용`).run()

  return c.json({ success: true })
})

// ----- 선택형 스킬 결정 -----
app.post('/api/students/:id/choices/:choiceId/resolve', async (c) => {
  const studentId = Number(c.req.param('id'))
  const choiceId = Number(c.req.param('choiceId'))
  const body = await c.req.json<{ pick: 'A' | 'B' }>()

  const choice = await c.env.DB.prepare(
    `SELECT * FROM pending_choices WHERE id = ? AND student_id = ?`
  ).bind(choiceId, studentId).first<PendingChoiceRow>()
  if (!choice) return c.json({ error: '선택을 찾을 수 없습니다' }, 404)

  const student = await c.env.DB.prepare(
    `SELECT class_id FROM students WHERE id = ?`
  ).bind(studentId).first<{ class_id: number }>()
  if (!student) return c.json({ error: '학생을 찾을 수 없습니다' }, 404)

  const picked = body.pick === 'A' ? choice.choice_a : choice.choice_b

  // 보유 스킬에 추가
  await c.env.DB.prepare(
    `INSERT INTO student_skills (student_id, skill_name, source_level)
     VALUES (?, ?, ?)`
  ).bind(studentId, picked, choice.level).run()

  // pending 제거
  await c.env.DB.prepare(`DELETE FROM pending_choices WHERE id = ?`).bind(choiceId).run()

  // 로그
  await c.env.DB.prepare(
    `INSERT INTO activity_logs (student_id, class_id, log_type, activity_name, score_delta)
     VALUES (?, ?, 'skill_choice', ?, 0)`
  ).bind(studentId, student.class_id, `Lv.${choice.level} 보상 선택: ${picked}`).run()

  return c.json({ success: true, picked })
})

// ----- 활동 기록 -----
app.get('/api/classes/:classId/logs', async (c) => {
  const classId = Number(c.req.param('classId'))
  const limit = Number(c.req.query('limit') || 200)

  const { results } = await c.env.DB.prepare(
    `SELECT al.*, s.name as student_name, s.nickname as student_nickname,
            s.avatar_color, s.avatar_emoji
     FROM activity_logs al
     JOIN students s ON s.id = al.student_id
     WHERE al.class_id = ?
     ORDER BY al.created_at DESC, al.id DESC
     LIMIT ?`
  ).bind(classId, limit).all()

  return c.json(results)
})

// ----- 레벨표 조회 -----
app.get('/api/classes/:classId/level-table', async (c) => {
  const classId = Number(c.req.param('classId'))
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM level_table WHERE class_id = ? ORDER BY level`
  ).bind(classId).all<LevelRow>()
  return c.json(results)
})

// ----- 레벨표 - 스킬 내용만 수정 (게임 뼈대 고정) -----
// 이름·보상 설명·선택지 텍스트만 변경 가능. required_xp/rank/level/is_choice 구조는 고정.
app.put('/api/classes/:classId/level-table/:level/skill', async (c) => {
  const classId = Number(c.req.param('classId'))
  const level = Number(c.req.param('level'))
  const body = await c.req.json<{
    unlock_skill?: string | null
    reward_desc?: string | null
    choice_a?: string | null
    choice_b?: string | null
  }>()

  const existing = await c.env.DB.prepare(
    `SELECT * FROM level_table WHERE class_id = ? AND level = ?`
  ).bind(classId, level).first<LevelRow>()
  if (!existing) return c.json({ error: '해당 레벨이 없습니다' }, 404)

  await c.env.DB.prepare(
    `UPDATE level_table
     SET unlock_skill = ?, reward_desc = ?, choice_a = ?, choice_b = ?
     WHERE class_id = ? AND level = ?`
  ).bind(
    body.unlock_skill !== undefined ? (body.unlock_skill || null) : existing.unlock_skill,
    body.reward_desc !== undefined ? (body.reward_desc || null) : existing.reward_desc,
    body.choice_a !== undefined ? (body.choice_a || null) : existing.choice_a,
    body.choice_b !== undefined ? (body.choice_b || null) : existing.choice_b,
    classId, level
  ).run()

  return c.json({ success: true })
})

// =================================================================
// 활동(점수 부여 버튼) CRUD - 교사가 설정에서 편집
// =================================================================

app.get('/api/classes/:classId/activities', async (c) => {
  const classId = Number(c.req.param('classId'))
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM activities WHERE class_id = ? ORDER BY sort_order, id`
  ).bind(classId).all()
  return c.json(results)
})

app.post('/api/classes/:classId/activities', async (c) => {
  const classId = Number(c.req.param('classId'))
  const body = await c.req.json<{
    name: string
    score_delta: number
    emoji?: string
    is_custom_input?: number
  }>()

  // 다음 sort_order 계산
  const max = await c.env.DB.prepare(
    `SELECT COALESCE(MAX(sort_order), 0) as m FROM activities WHERE class_id = ?`
  ).bind(classId).first<{ m: number }>()
  const nextOrder = (max?.m || 0) + 1

  const res = await c.env.DB.prepare(
    `INSERT INTO activities (class_id, name, score_delta, emoji, is_custom_input, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    classId,
    body.name,
    body.score_delta || 0,
    body.emoji || '⭐',
    body.is_custom_input ? 1 : 0,
    nextOrder
  ).run()

  return c.json({ success: true, id: res.meta.last_row_id })
})

app.put('/api/activities/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json<{
    name?: string
    score_delta?: number
    emoji?: string
  }>()

  const existing = await c.env.DB.prepare(
    `SELECT * FROM activities WHERE id = ?`
  ).bind(id).first<ActivityRow>()
  if (!existing) return c.json({ error: '활동이 없습니다' }, 404)

  await c.env.DB.prepare(
    `UPDATE activities SET name = ?, score_delta = ?, emoji = ? WHERE id = ?`
  ).bind(
    body.name ?? existing.name,
    body.score_delta !== undefined ? body.score_delta : existing.score_delta,
    body.emoji ?? existing.emoji,
    id
  ).run()

  return c.json({ success: true })
})

app.delete('/api/activities/:id', async (c) => {
  const id = Number(c.req.param('id'))
  await c.env.DB.prepare(`DELETE FROM activities WHERE id = ?`).bind(id).run()
  return c.json({ success: true })
})

export default app
