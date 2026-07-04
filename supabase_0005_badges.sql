-- =============================================================================
-- 뱃지 기능 (supabase_0005)
-- Supabase 대시보드 → SQL Editor 에서 실행하세요.
-- =============================================================================

-- 1) 뱃지 정의 테이블 (학급별로 선생님이 만드는 뱃지 목록)
CREATE TABLE IF NOT EXISTS badges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  name text NOT NULL,
  emoji text NOT NULL DEFAULT '🏅',
  description text,
  -- 자동 부여 조건: NULL=수동(교사가 직접 수여)
  --   'level'          → 레벨이 auto_value 이상이 되면
  --   'xp'             → 누적 XP가 auto_value 이상이 되면
  --   'activity_count' → auto_activity 활동을 auto_value 번 하면
  auto_type text,
  auto_value integer,
  auto_activity text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_badges_class ON badges(class_id);

-- 2) 학생이 획득한 뱃지 목록 (JSON 배열: [{badge_id, awarded_at, auto}])
ALTER TABLE students ADD COLUMN IF NOT EXISTS badges jsonb NOT NULL DEFAULT '[]';
