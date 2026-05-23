-- 기본 학급 1개 생성 (확장 시 여러 학급으로 확장 가능)
INSERT OR IGNORE INTO classes (id, name, teacher_name) VALUES
  (1, '3학년 2반', '김선생');

-- 기본 레벨표 (학급 1)
INSERT OR IGNORE INTO level_table (class_id, level, required_xp, rank, unlock_skill, passive_skill, is_choice, choice_a, choice_b) VALUES
  (1, 1, 0,    'bronze', NULL,           '초보 모험가',     0, NULL, NULL),
  (1, 2, 50,   'bronze', '칭찬 스티커',     '인사 잘하기',     0, NULL, NULL),
  (1, 3, 120,  'bronze', '칭찬 도장',       '발표 우선권',     0, NULL, NULL),
  (1, 4, 220,  'bronze', '자리 바꾸기 패스', '청소 면제권 1회', 0, NULL, NULL),
  (1, 5, 350,  'silver', NULL,           '리더 자격',       1, '숙제 반값 할인권', '1일 자유석 이용권'),
  (1, 6, 520,  'silver', '간식 쿠폰',       '도서관 우대',     0, NULL, NULL),
  (1, 7, 720,  'silver', '음악 신청권',     '모둠장 자격',     0, NULL, NULL),
  (1, 8, 950,  'silver', '체육 우선권',     '발표 마스터',     0, NULL, NULL),
  (1, 9, 1200, 'silver', '특별 칭찬장',     '멘토 자격',       0, NULL, NULL),
  (1, 10,1500, 'gold',   NULL,           '학급 전설',       1, '간식 요정 쿠폰',   '코믹북 열람 패스');

-- 예시 학생 6명 (XP·HP·아바타 색상 다양하게)
INSERT OR IGNORE INTO students (id, class_id, name, avatar_color, xp, hp, max_hp) VALUES
  (1, 1, '김민준', '#FF6B9D', 35,   3, 3),  -- Lv.1 브론즈
  (2, 1, '이서연', '#4ECDC4', 175,  3, 3),  -- Lv.3 브론즈
  (3, 1, '박지호', '#FFD93D', 380,  2, 3),  -- Lv.5 실버 (선택 대기 상태)
  (4, 1, '최예린', '#A78BFA', 600,  3, 3),  -- Lv.6 실버
  (5, 1, '정도윤', '#FB923C', 90,   1, 3),  -- Lv.2 브론즈
  (6, 1, '강하은', '#34D399', 1320, 3, 3);  -- Lv.9 실버

-- 학생들에게 일부 보유 스킬 미리 부여 (시연용)
INSERT OR IGNORE INTO student_skills (student_id, skill_name, source_level) VALUES
  (2, '칭찬 스티커', 2),
  (2, '칭찬 도장', 3),
  (4, '칭찬 스티커', 2),
  (4, '칭찬 도장', 3),
  (4, '자리 바꾸기 패스', 4),
  (4, '간식 쿠폰', 6),
  (6, '칭찬 스티커', 2),
  (6, '칭찬 도장', 3),
  (6, '자리 바꾸기 패스', 4),
  (6, '간식 쿠폰', 6),
  (6, '음악 신청권', 7),
  (6, '체육 우선권', 8),
  (6, '특별 칭찬장', 9);

-- 박지호는 Lv.5에 도달했으므로 선택 대기 상태
INSERT OR IGNORE INTO pending_choices (student_id, level, choice_a, choice_b) VALUES
  (3, 5, '숙제 반값 할인권', '1일 자유석 이용권');

-- 강하은도 Lv.5 선택을 이미 받은 상태로 가정 (선택 A를 받음)
INSERT OR IGNORE INTO student_skills (student_id, skill_name, source_level) VALUES
  (6, '숙제 반값 할인권', 5);

-- 초기 활동 기록 몇 개
INSERT OR IGNORE INTO activity_logs (student_id, class_id, log_type, activity_name, score_delta) VALUES
  (1, 1, 'score', '출석 체크', 10),
  (1, 1, 'score', '아침 독서', 10),
  (1, 1, 'score', '숙제 제출', 20),
  (2, 1, 'score', '폭풍 칭찬', 30),
  (3, 1, 'score', '친구 돕기', 20),
  (6, 1, 'score', '폭풍 칭찬', 30);
