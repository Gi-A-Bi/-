-- =============================================================================
-- 클업 멀티테넌트 마이그레이션
-- Supabase SQL Editor에서 이 SQL을 한 번 실행해 주세요.
-- =============================================================================

-- 1) classes 테이블에 owner_email 컬럼 추가 (이미 있으면 그냥 통과)
ALTER TABLE classes
  ADD COLUMN IF NOT EXISTS owner_email TEXT;

-- 2) owner_email 으로 빠른 조회 인덱스
CREATE INDEX IF NOT EXISTS idx_classes_owner_email
  ON classes (owner_email);

-- 참고:
--  - 기존 '클업 4-1' 학급(id = 00000000-0000-0000-0000-000000000001) 은 그대로 두고,
--    owner_email 만 NULL 상태입니다. 앱 로그인 후 "이 학급을 내 학급으로 가져오기"
--    버튼을 누르면 그 시점의 선생님 이메일이 owner_email 에 자동 채워집니다.
--  - 또는 아래 한 줄을 직접 실행해도 됩니다 (your-email@example.com 부분을 본인 이메일로):
--    UPDATE classes
--       SET owner_email = 'your-email@example.com'
--     WHERE id = '00000000-0000-0000-0000-000000000001';
