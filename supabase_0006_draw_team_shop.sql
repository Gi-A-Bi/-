-- =============================================================================
-- 카드팩 뽑기 + 모둠전 + 상점 (supabase_0006)
-- Supabase 대시보드 → SQL Editor 에서 실행하세요.
-- =============================================================================

-- 1) 카드팩 뽑기 설정 (학급별 보상 XP 목록 — 교사가 설정에서 수정)
ALTER TABLE classes ADD COLUMN IF NOT EXISTS draw_config jsonb NOT NULL
  DEFAULT '{"rewards":[20,40,60,80,100]}';

-- 2) 모둠전 (학생별 모둠 이름)
ALTER TABLE students ADD COLUMN IF NOT EXISTS team text;

-- 3) 상점 (코인 + 쿠폰함)
ALTER TABLE students ADD COLUMN IF NOT EXISTS coins integer NOT NULL DEFAULT 0;
ALTER TABLE students ADD COLUMN IF NOT EXISTS coupons jsonb NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS shop_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  name text NOT NULL,
  emoji text NOT NULL DEFAULT '🎟️',
  price integer NOT NULL DEFAULT 1,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shop_items_class ON shop_items(class_id);

-- 다른 테이블과 동일하게 서버단 보안(owner_email 검사) 사용 — RLS 끔
ALTER TABLE shop_items DISABLE ROW LEVEL SECURITY;

-- API 서버가 새 구조를 바로 인식하도록 갱신
NOTIFY pgrst, 'reload schema';
