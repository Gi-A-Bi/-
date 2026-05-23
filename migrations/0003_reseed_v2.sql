-- 기존 데이터를 v2 사양에 맞게 재구성
-- (마이그레이션 시 한 번만 실행되어 학급 1의 레벨표/활동을 교체)

-- 학급 1이 없으면 생성
INSERT OR IGNORE INTO classes (id, name, teacher_name) VALUES (1, '3학년 2반', '김선생');

-- ===== 레벨표 v2: 30 레벨 =====
DELETE FROM level_table WHERE class_id = 1;

-- 등급 구간: 레벨 1~6 브론즈, 7~12 실버, 13~30 골드
-- 해금 스킬: Lv1 기본 진급 선물 / Lv3 나만의 닉네임 / Lv5 [선택] / Lv7 미니펫 / Lv9 실수 만회 /
--           Lv10 [선택] / Lv13 일일 DJ / Lv15 베프 인증 / Lv18 자리 다시 뽑기 / Lv20 [선택] /
--           Lv22 과제 면제 / Lv25 체육왕 / Lv28 제티왕 / Lv30 전설의 귀환
-- 패시브: Lv1~2 "도서 대여/1인1역 자격", Lv3 이상 "나만의 닉네임"

INSERT INTO level_table (class_id, level, required_xp, rank, unlock_skill, passive_skill, is_choice, choice_a, choice_b, reward_desc) VALUES
  (1, 1,  0,    'bronze', '기본 진급 선물', '도서 대여/1인1역 자격', 0, NULL, NULL, '진급을 축하하는 작은 선물'),
  (1, 2,  150,  'bronze', NULL,           '도서 대여/1인1역 자격', 0, NULL, NULL, NULL),
  (1, 3,  300,  'bronze', '나만의 닉네임',  '나만의 닉네임',         0, NULL, NULL, '교사가 인정한 자신만의 별명 사용권'),
  (1, 4,  500,  'bronze', NULL,           '나만의 닉네임',         0, NULL, NULL, NULL),
  (1, 5,  700,  'bronze', NULL,           '나만의 닉네임',         1, '숙제 반값 할인권', '1일 자유석 이용권', '둘 중 하나를 직접 선택'),
  (1, 6,  950,  'bronze', NULL,           '나만의 닉네임',         0, NULL, NULL, NULL),
  (1, 7,  1200, 'silver', '미니펫(인형 전시)', '나만의 닉네임',     0, NULL, NULL, '책상에 인형 1개 전시 허용'),
  (1, 8,  1450, 'silver', NULL,           '나만의 닉네임',         0, NULL, NULL, NULL),
  (1, 9,  1700, 'silver', '실수 만회(1회 방어)', '나만의 닉네임',   0, NULL, NULL, '벌점/실수 1회를 막아주는 방어권'),
  (1, 10, 1950, 'silver', NULL,           '나만의 닉네임',         1, '간식 요정', '코믹 패스', '둘 중 하나를 직접 선택'),
  (1, 11, 2300, 'silver', NULL,           '나만의 닉네임',         0, NULL, NULL, NULL),
  (1, 12, 2650, 'silver', NULL,           '나만의 닉네임',         0, NULL, NULL, NULL),
  (1, 13, 3000, 'gold',   '일일 DJ(신청곡)',  '나만의 닉네임',      0, NULL, NULL, '하루 동안 음악 신청곡 1곡 재생'),
  (1, 14, 3350, 'gold',   NULL,             '나만의 닉네임',      0, NULL, NULL, NULL),
  (1, 15, 3700, 'gold',   '베프 인증(짝꿍 선택)', '나만의 닉네임', 0, NULL, NULL, '다음 자리 바꿀 때 짝꿍 직접 선택'),
  (1, 16, 4050, 'gold',   NULL,             '나만의 닉네임',      0, NULL, NULL, NULL),
  (1, 17, 4400, 'gold',   NULL,             '나만의 닉네임',      0, NULL, NULL, NULL),
  (1, 18, 4750, 'gold',   '자리 다시 뽑기(1회권)', '나만의 닉네임',0, NULL, NULL, '자리 배치 결과를 1회 다시 뽑을 수 있음'),
  (1, 19, 5100, 'gold',   NULL,             '나만의 닉네임',      0, NULL, NULL, NULL),
  (1, 20, 5450, 'gold',   NULL,             '나만의 닉네임',      1, '급식 프리패스', '보드게임 마스터', '둘 중 하나를 직접 선택'),
  (1, 21, 5950, 'gold',   NULL,             '나만의 닉네임',      0, NULL, NULL, NULL),
  (1, 22, 6450, 'gold',   '과제 면제(1회권)',  '나만의 닉네임',     0, NULL, NULL, '과제 1회 면제권'),
  (1, 23, 6950, 'gold',   NULL,             '나만의 닉네임',      0, NULL, NULL, NULL),
  (1, 24, 7450, 'gold',   NULL,             '나만의 닉네임',      0, NULL, NULL, NULL),
  (1, 25, 7950, 'gold',   '체육왕(체육종목 선택 1회권)', '나만의 닉네임', 0, NULL, NULL, '체육 시간 1회, 종목을 직접 선택'),
  (1, 26, 8450, 'gold',   NULL,             '나만의 닉네임',      0, NULL, NULL, NULL),
  (1, 27, 8950, 'gold',   NULL,             '나만의 닉네임',      0, NULL, NULL, NULL),
  (1, 28, 9450, 'gold',   '제티왕(우유에 제티 타먹기)', '나만의 닉네임', 0, NULL, NULL, '우유에 제티 1회 타먹기 권리'),
  (1, 29, 9950, 'gold',   NULL,             '나만의 닉네임',      0, NULL, NULL, NULL),
  (1, 30, 10450,'gold',   '전설의 귀환',      '나만의 닉네임',      0, NULL, NULL, '학급의 전설로 기록');

-- ===== 활동 점수표 v2: 12개 =====
DELETE FROM activities WHERE class_id = 1;

INSERT INTO activities (class_id, name, score_delta, emoji, is_custom_input, sort_order) VALUES
  (1, '숙제 제출',          30,  '📝', 0, 1),
  (1, '친구 돕기',          20,  '🤝', 0, 2),
  (1, '출석 체크',          10,  '✅', 0, 3),
  (1, '1인 1역 완수',       10,  '🧹', 0, 4),
  (1, '아침 독서',          10,  '📚', 0, 5),
  (1, '깨끗한 청소',        20,  '🧽', 0, 6),
  (1, '특별 폭풍 칭찬',     30,  '🌟', 0, 7),
  (1, '급식 잔반 제로',     10,  '🍱', 0, 8),
  (1, '훌륭한 발표',        10,  '🎤', 0, 9),
  (1, '실수 복구',          -10, '🔧', 0, 10),
  (1, '벌점',               -10, '⚠️', 0, 11),
  (1, '특별 점수 부여',     0,   '✨', 1, 12); -- 교사가 직접 입력

-- ===== 기존 학생 데이터 정리 =====
-- 시드 학생들의 보유 스킬/선택 대기를 초기화 (레벨표가 바뀌었으므로)
DELETE FROM student_skills WHERE student_id IN (SELECT id FROM students WHERE class_id = 1);
DELETE FROM pending_choices WHERE student_id IN (SELECT id FROM students WHERE class_id = 1);

-- 학생 XP를 새 레벨표에 맞게 조정 (기존 XP가 너무 낮아 의미 있는 분포가 안 나옴)
UPDATE students SET xp = 80   WHERE id = 1 AND class_id = 1;  -- 김민준 Lv.1
UPDATE students SET xp = 420  WHERE id = 2 AND class_id = 1;  -- 이서연 Lv.3
UPDATE students SET xp = 750  WHERE id = 3 AND class_id = 1;  -- 박지호 Lv.5 → 선택 대기
UPDATE students SET xp = 1300 WHERE id = 4 AND class_id = 1;  -- 최예린 Lv.7
UPDATE students SET xp = 200  WHERE id = 5 AND class_id = 1;  -- 정도윤 Lv.2
UPDATE students SET xp = 2000 WHERE id = 6 AND class_id = 1;  -- 강하은 Lv.10 → 선택 대기

-- 시연용 보유 스킬: Lv5/Lv10 도달자에게는 선택 대기, 나머지는 그동안 받았을 자동 해금 스킬 부여
-- 이서연(Lv.3): 진급 선물, 닉네임
INSERT INTO student_skills (student_id, skill_name, source_level) VALUES
  (2, '기본 진급 선물', 1),
  (2, '나만의 닉네임', 3);

-- 박지호(Lv.5): 진급 선물, 닉네임 + Lv5 선택 대기
INSERT INTO student_skills (student_id, skill_name, source_level) VALUES
  (3, '기본 진급 선물', 1),
  (3, '나만의 닉네임', 3);
INSERT INTO pending_choices (student_id, level, choice_a, choice_b) VALUES
  (3, 5, '숙제 반값 할인권', '1일 자유석 이용권');

-- 최예린(Lv.7): 진급 선물, 닉네임, Lv5 선택은 이미 골랐다고 가정(A), 미니펫
INSERT INTO student_skills (student_id, skill_name, source_level) VALUES
  (4, '기본 진급 선물', 1),
  (4, '나만의 닉네임', 3),
  (4, '숙제 반값 할인권', 5),
  (4, '미니펫(인형 전시)', 7);

-- 강하은(Lv.10): 모든 자동 해금 + Lv5 선택 완료(B) + Lv10 선택 대기
INSERT INTO student_skills (student_id, skill_name, source_level) VALUES
  (6, '기본 진급 선물', 1),
  (6, '나만의 닉네임', 3),
  (6, '1일 자유석 이용권', 5),
  (6, '미니펫(인형 전시)', 7),
  (6, '실수 만회(1회 방어)', 9);
INSERT INTO pending_choices (student_id, level, choice_a, choice_b) VALUES
  (6, 10, '간식 요정', '코믹 패스');

-- 김민준(Lv.1): 진급 선물만
INSERT INTO student_skills (student_id, skill_name, source_level) VALUES
  (1, '기본 진급 선물', 1);

-- 정도윤(Lv.2): 진급 선물만
INSERT INTO student_skills (student_id, skill_name, source_level) VALUES
  (5, '기본 진급 선물', 1);
