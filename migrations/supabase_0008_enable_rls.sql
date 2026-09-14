-- =============================================================================
--  전 테이블 Row Level Security 적용
-- =============================================================================
--  배경
--   Table Editor에서 모든 테이블이 UNRESTRICTED 상태였다. RLS가 꺼져 있으면
--   anon 키만으로 Supabase REST API에 직접 접근해 모든 학급의 학생 데이터를
--   읽고 쓸 수 있다. anon 키는 /api/public-config 로 브라우저에 공개되므로
--   사실상 누구나 접근 가능한 상태였다.
--
--  방침
--   이 앱은 브라우저가 DB에 직접 접근하지 않는다. 모든 데이터 요청은
--   Cloudflare Worker의 /api/* 를 거치고, Worker가 로그인 토큰과 학급
--   소유자를 대조한 뒤 service_role 키로 DB를 호출한다.
--   따라서 정책(policy)은 만들지 않는다. RLS만 켜면
--     - anon 키(브라우저)  → 어떤 행도 읽고 쓸 수 없음
--     - service_role(서버) → RLS를 우회하므로 기존 동작 그대로
--   가 되어, 서버를 우회하는 경로만 차단된다.
--
--  적용 순서 (순서를 지킬 것)
--   1. Cloudflare Pages 환경변수에 SUPABASE_SERVICE_KEY 추가
--      (Supabase > Project Settings > API Keys > service_role)
--   2. 이 브랜치를 배포 (Worker가 service_role 키로 호출하도록 변경됨)
--   3. 그다음 이 마이그레이션 실행
--
--   순서를 바꾸면 Worker가 anon 키로 호출하는 상태에서 RLS가 켜져
--   앱이 동작하지 않는다.
-- =============================================================================

ALTER TABLE activities    ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE badges        ENABLE ROW LEVEL SECURITY;
ALTER TABLE classes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE levels        ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE students      ENABLE ROW LEVEL SECURITY;

-- 확인용: 아래 쿼리에서 모든 행의 rowsecurity 가 true 여야 한다.
--   select tablename, rowsecurity from pg_tables where schemaname = 'public';
