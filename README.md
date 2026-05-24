# 클업 (CLASS UP)

초등학교 교실 게이미피케이션 RPG 웹앱. 학생을 RPG 캐릭터로 보고 활동에 따라 XP/레벨/등급/스킬을 부여한다.

## 데이터 저장소

**Supabase** (PostgreSQL)에 모든 학생, 활동, 활동기록, 레벨 데이터가 저장됩니다.

- `classes`, `students`, `activities`, `levels`, `activity_logs` 5개 테이블
- 학생의 보유 스킬·사용한 스킬은 `students.owned_skills` / `students.used_skills` JSON 컬럼
- 선택형 보상(`[선택] A.xxx / B.yyy` 형태의 unlock_skill)은 백엔드에서 자동 파싱

환경변수 (.dev.vars 또는 Cloudflare Pages secret):
- `SUPABASE_URL`
- `SUPABASE_KEY`
- `DEFAULT_CLASS_ID` (기본 학급 UUID)

## 주요 API

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/bootstrap` | 기본 학급 + class_id |
| GET | `/api/classes/:classId/students` | 학생 목록(Level/Rank/Skill count 포함) |
| GET | `/api/students/:id` | 학생 상세 (skills + pending_choices) |
| PUT | `/api/students/:id/profile` | 닉네임/아바타 수정 |
| POST | `/api/students/:id/score` | XP 부여 + 자동 레벨업 + 보상 지급 |
| POST | `/api/students/:id/hp` | HP 조정 |
| POST | `/api/students/:id/skills/:uid/use` | 보유 스킬 사용 (소모) |
| POST | `/api/students/:id/choices/:uid/resolve` | 선택형 보상 A/B 결정 |
| GET | `/api/classes/:classId/logs` | 활동 기록 |
| GET | `/api/classes/:classId/level-table` | 레벨/스킬 표 (전체 30단계) |
| PUT | `/api/classes/:classId/level-table/:level/skill` | 스킬 텍스트 수정 |
| GET/POST/PUT/DELETE | `/api/[classes/:classId/]activities[/:id]` | 활동 점수 버튼 CRUD |

## 게임 규칙 (고정)

- 레벨 1~30, 등급: 브론즈(Lv1~6) / 실버(Lv7~12) / 골드(Lv13~30)
- 패시브: Lv1~2 "도서 대여 / 1인 1역 자격", Lv3+ "나만의 닉네임"
- HP 최대 3 (하트 모양)
- Lv5/10/20은 A/B 선택형 보상

## UI 디자인

다크 판타지 RPG (인벤토리 슬롯 + 보석 등급 배지 + 발광 XP 바)

## 기술 스택

- Cloudflare Pages + Hono (TypeScript JSX)
- Supabase REST API (fetch 직접 호출)
- Vanilla JS SPA + Tailwind CDN

## 개발

```bash
npm run build
pm2 start ecosystem.config.cjs
curl http://localhost:3000/api/bootstrap
```
