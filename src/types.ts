// =============================================================================
// 타입 정의 (Supabase 스키마 기준)
// =============================================================================

export type Bindings = {
  SUPABASE_URL: string
  SUPABASE_KEY: string
  DEFAULT_CLASS_ID: string
}

// Hono Variables (요청 컨텍스트에 미들웨어가 채워주는 값)
export type Variables = {
  email: string         // 로그인한 선생님 이메일 (소문자)
  userId: string        // Supabase Auth user id
  classOwnerVerified?: true   // 라우트 핸들러 안에서 owner 검증을 통과했는지 마킹용
}

// ----- Supabase 테이블 row 타입 -----
export interface ClassRow {
  id: string
  name: string
  owner_email: string | null
  created_at?: string
}

// Supabase에서는 owned_skills / used_skills가 학생 row 내부의 JSON 배열
export interface OwnedSkill {
  uid: string              // 보유 스킬 식별자 (클라이언트/서버 양쪽 사용)
  name: string             // 실제 표시 이름 (선택 후에는 picked 값)
  level: number            // 어느 레벨에서 획득했는지
  pending?: boolean        // 아직 A/B 선택을 안 한 상태
  choice_a?: string
  choice_b?: string
  acquired_at: string      // ISO timestamp
}

export interface UsedSkill {
  name: string
  level: number
  used_at: string
}

export interface StudentRow {
  id: string
  class_id: string
  number: number
  name: string
  nickname: string | null
  avatar_emoji: string | null
  avatar_color: string | null
  xp: number
  hp: number
  owned_skills: OwnedSkill[]
  used_skills: UsedSkill[]
  created_at?: string
}

export interface ActivityRow {
  id: string
  class_id: string
  name: string
  score: number
  sort_order: number
}

export interface LevelRow {
  level: number
  min_xp: number
  grade: '브론즈' | '실버' | '골드' | string
  unlock_skill: string | null
  passive_skill: string | null
}

export interface ActivityLogRow {
  id?: string
  class_id: string
  student_id: string
  type: 'score' | 'skill_use' | 'level_up' | 'skill_choice'
  name: string
  score: number
  created_at?: string
}

// ----- 클라이언트로 내려보낼 enriched 타입(참고용) -----
export interface ParsedSkillInfo {
  is_choice: boolean
  choice_a: string | null
  choice_b: string | null
  plain: string | null   // 선택형이 아닐 때의 일반 스킬 이름
}

// =============================================================================
// 유틸: grade → rank(영문)
// =============================================================================
export function gradeToRank(grade: string): 'bronze' | 'silver' | 'gold' {
  if (grade === '실버' || /silver/i.test(grade)) return 'silver'
  if (grade === '골드' || /gold/i.test(grade)) return 'gold'
  return 'bronze'
}

// =============================================================================
// unlock_skill 문자열을 파싱
//  - "[선택] A.숙제 반값 할인권 / B.1일 자유석 이용권" → choice
//  - 그 외 → 일반 스킬
// =============================================================================
export function parseUnlockSkill(raw: string | null | undefined): ParsedSkillInfo {
  if (!raw) return { is_choice: false, choice_a: null, choice_b: null, plain: null }
  const trimmed = raw.trim()
  // [선택] A.xxx / B.yyy   또는   [선택] A. xxx / B. yyy
  const m = trimmed.match(/^\[선택\]\s*A\.?\s*(.+?)\s*\/\s*B\.?\s*(.+)$/)
  if (m) {
    return {
      is_choice: true,
      choice_a: m[1].trim(),
      choice_b: m[2].trim(),
      plain: null,
    }
  }
  return { is_choice: false, choice_a: null, choice_b: null, plain: trimmed }
}

// =============================================================================
// 레벨 계산
// =============================================================================
export function calcLevel(xp: number, levelTable: LevelRow[]): LevelRow {
  const sorted = [...levelTable].sort((a, b) => a.min_xp - b.min_xp)
  let current = sorted[0]
  for (const lv of sorted) {
    if (xp >= lv.min_xp) current = lv
    else break
  }
  return current
}

export function nextLevel(xp: number, levelTable: LevelRow[]): LevelRow | null {
  const sorted = [...levelTable].sort((a, b) => a.min_xp - b.min_xp)
  for (const lv of sorted) {
    if (lv.min_xp > xp) return lv
  }
  return null
}

// 짧은 uid 생성 (보유 스킬 식별자용)
export function shortUid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}
