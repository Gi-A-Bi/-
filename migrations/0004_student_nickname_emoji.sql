-- 학생 프로필 확장: 닉네임과 이모지 아바타
ALTER TABLE students ADD COLUMN nickname TEXT;
ALTER TABLE students ADD COLUMN avatar_emoji TEXT;

-- 시드 학생들에게 예시 닉네임/이모지 부여
UPDATE students SET nickname = '민달팽이',  avatar_emoji = '🐢' WHERE id = 1 AND class_id = 1;
UPDATE students SET nickname = '서연공주',  avatar_emoji = '🦄' WHERE id = 2 AND class_id = 1;
UPDATE students SET nickname = '지호장군',  avatar_emoji = '🦁' WHERE id = 3 AND class_id = 1;
UPDATE students SET nickname = '예린토끼',  avatar_emoji = '🐰' WHERE id = 4 AND class_id = 1;
UPDATE students SET nickname = '도윤이',    avatar_emoji = '🦊' WHERE id = 5 AND class_id = 1;
UPDATE students SET nickname = '하은마법사', avatar_emoji = '🐼' WHERE id = 6 AND class_id = 1;
