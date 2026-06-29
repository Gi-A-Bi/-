-- =============================================================================
-- 1) 학생 프로필 이미지 (Base64 data URL 저장)
--    - 이모지/이름 첫글자 fallback과 함께, 사진 업로드도 가능하게 함
--    - 클라이언트에서 캔버스로 200x200 정사각형 리사이즈 + JPEG 압축 후 저장
-- =============================================================================
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS avatar_image text;
-- (Postgres의 row size 한계로 너무 큰 이미지는 막아둠 — 클라이언트에서 ~50KB로 압축)

-- =============================================================================
-- 2) 활동(점수 버튼)에 이모지/아이콘 컬럼 추가
--    - 이름 기반 자동 추천 + 교사가 수동으로 변경 가능
--    - NULL이면 클라이언트가 이름 기반 자동 매칭 (하위 호환)
-- =============================================================================
ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS emoji text;

-- 기존 활동들에 이름 기반으로 이모지 한 번에 채워주기
-- (활동명에 특정 키워드가 있으면 거기에 맞는 이모지 자동 부여)
UPDATE activities SET emoji = '📝' WHERE emoji IS NULL AND name LIKE '%숙제%';
UPDATE activities SET emoji = '✅' WHERE emoji IS NULL AND name LIKE '%출석%';
UPDATE activities SET emoji = '📚' WHERE emoji IS NULL AND (name LIKE '%독서%' OR name LIKE '%아침 독서%');
UPDATE activities SET emoji = '🤝' WHERE emoji IS NULL AND name LIKE '%돕기%';
UPDATE activities SET emoji = '🌟' WHERE emoji IS NULL AND name LIKE '%칭찬%';
UPDATE activities SET emoji = '⚠️' WHERE emoji IS NULL AND name LIKE '%벌점%';
UPDATE activities SET emoji = '🎤' WHERE emoji IS NULL AND name LIKE '%발표%';
UPDATE activities SET emoji = '🧹' WHERE emoji IS NULL AND name LIKE '%청소%';
UPDATE activities SET emoji = '👋' WHERE emoji IS NULL AND name LIKE '%인사%';
UPDATE activities SET emoji = '✏️' WHERE emoji IS NULL AND name LIKE '%직접 입력%';
-- 그 외에는 NULL로 두고 클라이언트가 동적으로 매칭
