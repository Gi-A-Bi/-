// 타입 정의

export type Bindings = {
  DB: D1Database
}

export interface ClassRow {
  id: number
  name: string
  teacher_name: string | null
  created_at: string
}

export interface StudentRow {
  id: number
  class_id: number
  name: string
  avatar_color: string
  xp: number
  hp: number
  max_hp: number
  created_at: string
}

export interface LevelRow {
  id: number
  class_id: number
  level: number
  required_xp: number
  rank: 'bronze' | 'silver' | 'gold'
  unlock_skill: string | null
  passive_skill: string | null
  is_choice: number
  choice_a: string | null
  choice_b: string | null
}

export interface StudentSkillRow {
  id: number
  student_id: number
  skill_name: string
  source_level: number | null
  acquired_at: string
}

export interface PendingChoiceRow {
  id: number
  student_id: number
  level: number
  choice_a: string
  choice_b: string
  created_at: string
}

export interface ActivityLogRow {
  id: number
  student_id: number
  class_id: number
  log_type: 'score' | 'skill_use' | 'level_up' | 'skill_choice'
  activity_name: string
  score_delta: number
  created_at: string
}

// 레벨 계산: 현재 XP 이하 중 가장 높은 레벨
export function calcLevel(xp: number, levelTable: LevelRow[]): LevelRow {
  const sorted = [...levelTable].sort((a, b) => a.required_xp - b.required_xp)
  let current = sorted[0]
  for (const lv of sorted) {
    if (xp >= lv.required_xp) current = lv
    else break
  }
  return current
}

// 다음 레벨 정보
export function nextLevel(xp: number, levelTable: LevelRow[]): LevelRow | null {
  const sorted = [...levelTable].sort((a, b) => a.required_xp - b.required_xp)
  for (const lv of sorted) {
    if (lv.required_xp > xp) return lv
  }
  return null
}
