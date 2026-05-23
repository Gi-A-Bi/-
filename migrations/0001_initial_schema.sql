-- 학급(반) 테이블 - 확장 대비: 추후 교사별/학급별 분리 가능
CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  teacher_name TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 학생 테이블
CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  avatar_color TEXT DEFAULT '#FF6B9D',
  xp INTEGER DEFAULT 0,
  hp INTEGER DEFAULT 3,
  max_hp INTEGER DEFAULT 3,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE
);

-- 레벨표 (학급별로 커스터마이즈 가능)
CREATE TABLE IF NOT EXISTS level_table (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER NOT NULL,
  level INTEGER NOT NULL,
  required_xp INTEGER NOT NULL,
  rank TEXT NOT NULL, -- 'bronze' | 'silver' | 'gold'
  unlock_skill TEXT,   -- 해금 스킬 이름 (단일)
  passive_skill TEXT,  -- 패시브 스킬 이름 (단일)
  is_choice INTEGER DEFAULT 0, -- 1이면 두 보상 중 선택
  choice_a TEXT,
  choice_b TEXT,
  FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
  UNIQUE(class_id, level)
);

-- 학생이 보유한 해금 스킬 (소모성, 누적)
CREATE TABLE IF NOT EXISTS student_skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  skill_name TEXT NOT NULL,
  source_level INTEGER,  -- 어느 레벨에서 얻었는지
  acquired_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
);

-- 보류 중인 선택형 스킬 (레벨 5/10/20 도달 시)
CREATE TABLE IF NOT EXISTS pending_choices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  level INTEGER NOT NULL,
  choice_a TEXT NOT NULL,
  choice_b TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  UNIQUE(student_id, level)
);

-- 활동 기록 (점수 부여, 스킬 사용 모두)
CREATE TABLE IF NOT EXISTS activity_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  class_id INTEGER NOT NULL,
  log_type TEXT NOT NULL, -- 'score' | 'skill_use' | 'level_up' | 'skill_choice'
  activity_name TEXT NOT NULL,
  score_delta INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_students_class ON students(class_id);
CREATE INDEX IF NOT EXISTS idx_skills_student ON student_skills(student_id);
CREATE INDEX IF NOT EXISTS idx_logs_class_time ON activity_logs(class_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_student_time ON activity_logs(student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_level_table_class ON level_table(class_id, level);
CREATE INDEX IF NOT EXISTS idx_pending_student ON pending_choices(student_id);
