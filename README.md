# 클업 (CLASS UP)

초등학교 교실 게이미피케이션 RPG 웹앱. 학생을 RPG 캐릭터로 보고 활동에 따라 XP/레벨/등급/스킬을 부여한다.

## 멀티테넌트 (선생님 로그인 + 학급 분리)

- **Supabase Auth (이메일+비밀번호)** 로 선생님 계정을 관리
- 각 선생님은 자기 학급(`classes.owner_email` 일치) 데이터만 보고 수정 가능
- 처음 로그인한 선생님은 **온보딩 화면**에서 학급 이름을 입력해 새 학급을 만들거나, 주인 없는 기존 학급을 "가져오기"
- 모든 `/api/*` 요청은 `Authorization: Bearer <access_token>` 헤더 필수. 미들웨어가 Supabase `/auth/v1/user` 에 토큰을 보내 검증한 뒤, 해당 이메일과 학급의 `owner_email` 을 매번 다시 대조해서 권한을 강제 (서버단 보안)

### 처음 한 번 해야 하는 일

1. **Supabase SQL Editor에서** `migrations/supabase_0001_owner_email.sql` 실행
   → `classes.owner_email` 컬럼 + 인덱스 생성
2. (선택) 기존 "클업 4-1" 학급(id `00000000-0000-0000-0000-000000000001`)을 본인 학급으로 가져오려면, 로그인 후 온보딩 화면의 "이 학급 가져오기" 버튼을 누르면 됨. 또는 SQL로 직접:
   ```sql
   UPDATE classes SET owner_email = 'your-email@example.com'
    WHERE id = '00000000-0000-0000-0000-000000000001';
   ```
3. Supabase Auth 설정에서 **Email confirmations** 를 꺼두면 회원가입 즉시 로그인되어 편함 (Authentication → Providers → Email → Confirm email OFF)

## 데이터 저장소

**Supabase** (PostgreSQL).
- `classes` (id, name, **owner_email**, created_at)
- `students` (class_id 로 학급 분리)
- `activities` (class_id 로 학급 분리, 점수 버튼)
- `activity_logs` (class_id 로 학급 분리)
- `levels` (전역 공통 — 모든 학급이 같은 레벨표 사용)

학생의 보유/사용 스킬은 `students.owned_skills` / `used_skills` JSON 컬럼.

환경변수 (`.dev.vars` 또는 Cloudflare Pages secret):
- `SUPABASE_URL`
- `SUPABASE_KEY` (anon publishable key)
- `DEFAULT_CLASS_ID` (호환용)

## 주요 API

### 인증 / 학급 라이프사이클

| 메서드 | 경로 | 인증 | 설명 |
|---|---|:-:|---|
| GET | `/api/public-config` | - | 프론트에 Supabase URL + anon key 전달 (Auth REST 호출용) |
| GET | `/api/me` | ✅ | 현재 로그인 사용자 이메일/ID |
| GET | `/api/my-class` | ✅ | 내 학급 (`owner_email = 내 이메일`) + 가져올 수 있는 학급 목록 |
| POST | `/api/classes` | ✅ | 새 학급 만들기. body: `{ name }`. 활동(점수버튼) 12개 자동 시드 |
| POST | `/api/classes/:id/claim` | ✅ | 주인 없는 기존 학급을 내 학급으로 가져오기 |

### 학생 / 게임 데이터 (모두 `owner_email` 검증)

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/classes/:classId/students` | 학생 목록 |
| POST | `/api/classes/:classId/students` | 학생 추가 (body: `{ name, number? }`) |
| GET | `/api/students/:id` | 학생 상세 (skills + pending_choices) |
| PUT | `/api/students/:id/profile` | 닉네임/아바타 |
| DELETE | `/api/students/:id` | 학생 삭제 (로그도 함께) |
| POST | `/api/students/:id/score` | XP 부여 + 자동 레벨업 + 보상 지급 |
| POST | `/api/students/:id/hp` | HP ±1 |
| POST | `/api/students/:id/skills/:uid/use` | 보유 스킬 사용 (소모) |
| POST | `/api/students/:id/choices/:uid/resolve` | A/B 보상 선택 |
| GET | `/api/classes/:classId/logs` | 활동 기록 |
| GET | `/api/classes/:classId/level-table` | 레벨/스킬 표 |
| PUT | `/api/classes/:classId/level-table/:level/skill` | 스킬 텍스트 수정 |
| GET/POST | `/api/classes/:classId/activities` | 활동 버튼 목록/추가 |
| PUT/DELETE | `/api/activities/:id` | 활동 버튼 수정/삭제 |

응답 코드:
- `401 NO_AUTH` — 토큰 없음
- `401 INVALID_TOKEN` — 잘못된/만료된 토큰
- `403 NOT_OWNER` — 다른 선생의 학급에 접근 시도
- `503 AUTH_NETWORK` — Supabase 호출 실패 (일시적 네트워크 이슈)

## 게임 규칙 (고정)

- 레벨 1~30, 등급: 브론즈(Lv1~6) / 실버(Lv7~12) / 골드(Lv13~30)
- 패시브: Lv1~2 "도서 대여 / 1인 1역 자격", Lv3+ "나만의 닉네임"
- HP 최대 3 (하트 모양)
- Lv5/10/20은 A/B 선택형 보상

## UI 디자인

다크 판타지 RPG (인벤토리 슬롯 + 보석 등급 배지 + 발광 XP 바). 로그인/온보딩도 같은 톤.

## 기술 스택

- Cloudflare Pages + Hono (TypeScript JSX)
- Supabase Auth (이메일/비번) + Supabase REST API
- Vanilla JS SPA, `localStorage`에 세션 보관 + `expires_at` 만료 시 자동 refresh

## 개발

```bash
npm run build
pm2 start ecosystem.config.cjs
curl http://localhost:3000/api/public-config
```

## 배포

1. Supabase SQL Editor에서 `migrations/supabase_0001_owner_email.sql` 1회 실행
2. Cloudflare Pages secret 등록: `SUPABASE_URL`, `SUPABASE_KEY`, `DEFAULT_CLASS_ID`
3. `npm run deploy`
