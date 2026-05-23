-- 활동(점수 부여 버튼) 테이블: 학급별로 교사가 자유롭게 수정
CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  score_delta INTEGER NOT NULL,
  emoji TEXT,
  is_custom_input INTEGER DEFAULT 0, -- 1이면 교사가 점수를 직접 입력하는 특별 버튼
  sort_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_activities_class ON activities(class_id, sort_order);

-- 레벨표에 reward_desc 추가 (해금 스킬의 보상 설명)
ALTER TABLE level_table ADD COLUMN reward_desc TEXT;
