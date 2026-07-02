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
2. **Supabase SQL Editor에서** `migrations/supabase_0002_avatar_image_and_activity_emoji.sql` 실행
   → `students.avatar_image` (학생 사진), `activities.emoji` (활동 버튼 이모지) 컬럼 추가
3. (선택) 기존 "클업 4-1" 학급(id `00000000-0000-0000-0000-000000000001`)을 본인 학급으로 가져오려면, 로그인 후 온보딩 화면의 "이 학급 가져오기" 버튼을 누르면 됨. 또는 SQL로 직접:
   ```sql
   UPDATE classes SET owner_email = 'your-email@example.com'
    WHERE id = '00000000-0000-0000-0000-000000000001';
   ```
4. Supabase Auth 설정에서 **Email confirmations** 를 꺼두면 회원가입 즉시 로그인되어 편함 (Authentication → Providers → Email → Confirm email OFF)
5. **Supabase SQL Editor에서** `migrations/supabase_0003_class_bonus_xp.sql` 실행
   → `classes.bonus_xp` 컬럼 추가 (학급 전체 경험치의 학급 단위 보상/차감용). 안 돌리면 학급 경험치 "조정" 시 오류.

## 데이터 저장소

**Supabase** (PostgreSQL).
- `classes` (id, name, **owner_email**, **bonus_xp**, created_at)
- `students` (class_id, name, nickname, **avatar_emoji / avatar_color / avatar_image**, xp, hp, owned/used_skills(JSON))
- `activities` (class_id, name, score, **emoji**, sort_order) — 점수 버튼
- `activity_logs` (class_id 로 학급 분리)
- `levels` (전역 공통 — 모든 학급이 같은 레벨표 사용)

학생의 보유/사용 스킬은 `students.owned_skills` / `used_skills` JSON 컬럼.
학생 프로필 사진(`avatar_image`)은 200×200 정사각형 JPEG로 클라이언트에서 압축 후 Base64 data URL 형태로 저장 (≤ 약 200KB).

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
| POST | `/api/classes/:classId/class-xp` | ✅ | 학급 전체 경험치 조정. body: `{ delta }` (양수=보상, 음수=차감). `classes.bonus_xp` 만 변경하고 개별 학생 xp 는 그대로 |

### 학생 / 게임 데이터 (모두 `owner_email` 검증)

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/classes/:classId/students` | 학생 목록 |
| POST | `/api/classes/:classId/students` | 학생 추가 (body: `{ name, number? }`) |
| POST | `/api/classes/:classId/students/bulk` | 학생 일괄 추가 (body: `{ names: string[] }`, 1~100명) |
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
| PUT | `/api/classes/:classId/level-table/:level` | 레벨 기준 XP(`min_xp`)·등급(`grade`) 수정. 순서 검증(이전<현재<다음). grade: 브론즈/실버/골드/다이아 |
| POST | `/api/classes/:classId/level-table` | 가장 높은 레벨 위에 새 레벨 1개 추가(min_xp 자동, grade 지정 가능) |
| DELETE | `/api/classes/:classId/level-table/:level` | 가장 높은 레벨 삭제(추가한 31+ 레벨만, 기본 30 이하는 보호) |
| GET/POST | `/api/classes/:classId/activities` | 활동 버튼 목록/추가 |
| PUT/DELETE | `/api/activities/:id` | 활동 버튼 수정/삭제 |

응답 코드:
- `401 NO_AUTH` — 토큰 없음
- `401 INVALID_TOKEN` — 잘못된/만료된 토큰
- `403 NOT_OWNER` — 다른 선생의 학급에 접근 시도
- `503 AUTH_NETWORK` — Supabase 호출 실패 (일시적 네트워크 이슈)

## 게임 규칙

- 레벨 1~30, 등급: 브론즈(Lv1~6) / 실버(Lv7~12) / 골드(Lv13~30) — **기본값**. 설정 > 레벨·등급 탭에서 레벨별 기준 XP와 등급을 자유롭게 조정 가능 (전역 `levels` 테이블)
- 등급은 **브론즈 / 실버 / 골드 / 다이아** 4종. 레벨은 Lv.30 위로 **원하는 만큼 추가/삭제** 가능(추가한 상위 레벨부터 삭제)
- 패시브: Lv1~2 "도서 대여 / 1인 1역 자격", Lv3+ "나만의 닉네임"
- HP 최대 3 (하트 모양)
- Lv5/10/20은 A/B 선택형 보상

## UI 디자인

다크 판타지 RPG (인벤토리 슬롯 + 보석 등급 배지 + 발광 XP 바). 로그인/온보딩도 같은 톤.

### 사용성 개선 (2026-06)

- **헤더 아이콘에 한글 라벨 병기** — `기록 / 설정 / 로그아웃` 텍스트가 항상 보여 직관적
- **본문 폰트** — Pretendard Variable (한글 가독성 표준), 자간/굵기 단계 정리
- **학생 일괄 등록** — 학생 추가 모달이 3개 탭으로 확장:
  1. **한 명씩** — 기존 입력 방식
  2. **붙여넣기** — 엑셀/한글에서 이름을 복사해 텍스트 영역에 붙여넣기. 줄바꿈 / 쉼표 / 탭 / 세미콜론으로 자동 구분, "1. 김민준" 같은 출석번호도 자동 제거. 추가 전에 칩으로 미리보기
  3. **엑셀 파일** — `.xlsx / .xls / .csv` 업로드 (드래그앤드롭 지원). 첫 번째 열의 모든 이름을 읽어옴. 첫 행이 "이름/성명/name" 헤더면 자동 건너뜀. SheetJS(`xlsx@0.18.5`)를 CDN으로 `defer` 로드
- **한 번에 최대 100명**까지 추가. 출석번호는 (현재 최대값 + 1)부터 순차 자동 부여

### 학생 관리·아바타·이모지 강화 (2026-06)

- **학생 삭제** — 학생 상세 페이지 우측 상단의 빨간 `🗑 학생 삭제` 버튼. 확인 모달 → 학생/활동기록/보유 스킬 모두 안전하게 정리. (목록으로 자동 복귀)
- **학생 프로필 사진 업로드** — 아바타 꾸미기 모달이 2개 탭으로 확장:
  1. **이모지·색상** — 기존 방식 (32개 캐릭터 이모지 + 24색 배경)
  2. **사진 업로드** — 클릭 또는 드래그앤드롭으로 이미지 선택. 클라이언트에서 **200×200 정사각형으로 중앙 크롭 + JPEG 압축(q≈0.8)** → ~10–50KB. 너무 크면 자동으로 더 압축. "사진 제거" 버튼으로 이모지 모드로 돌아가기.
  - 학생 카드 / 상세 헤더 / 활동 기록 줄 — 사진이 있으면 모든 곳에 동그란 프로필 사진이 표시
- **활동(점수 버튼) 이모지 라이브러리** — `activities.emoji` 컬럼 신설
  - 카테고리별 **160여 가지** 이모지 (학습/발표/예체능/리더십/생활/감정/주의/기타)
  - 새 활동을 만들거나 활동명을 바꾸면 **이름 기반으로 자동 추천** (예: "수학 문제 다 풀기" → 🧮, "발표 잘함" → 🎤, "지각" → ⏰)
  - 자동 추천이 마음에 안 들면 **이모지 버튼을 클릭해서 직접 선택** — 한 번 직접 고른 활동은 활동명을 바꿔도 그대로 유지 (선생님 의도 보존)
  - 선택기 모달 안의 `↺ 자동 추천으로` 버튼으로 다시 자동 추천 모드로 되돌릴 수 있음
  - 학생 상세의 점수 버튼, 활동 기록의 아이콘, 토스트 알림 — 모두 새 이모지가 자동 반영

### 학급 목록 가시성 · 학급 경험치 · 순위 (2026-07)

- **학생 목록 그리드 반응형** — 기존 고정 2열에서 `auto-fill`(카드 최소 130px)로 변경. 모바일은 2열 그대로, PC 등 넓은 화면에선 자동으로 여러 열이 되어 학생 전체가 **한눈에** 보임. 목록 화면(`.list-view`)만 데스크톱에서 폭을 넓히고(≥760px 940px, ≥1180px 1120px) 상세/기록/설정 화면은 읽기 좋은 폭 유지
- **학급 전체 경험치 배너** — 목록 상단에 `모든 학생 xp 합계 + bonus_xp` 를 크게 표시. 학생 합계와 보너스 보정치를 분리해서 보여줌
- **학급 경험치 조정 (보상 / 차감)** — 배너의 `조정` 버튼 → 모달. `+100/+500/+1000` (보상), `−100/−500/−1000` (차감) 프리셋 + 직접 입력. `classes.bonus_xp` 만 바뀌고 **개별 학생 경험치는 변하지 않음** (학급 단위 파티 보상 소진 등에 사용)
- **학급 순위 배너** — 경험치 내림차순으로 전 학생을 나열. 1~3위는 🥇🥈🥉 메달, 나머지는 순위 번호. 각 줄에 아바타/닉네임/레벨/등급/XP 표시, 클릭하면 해당 학생 상세로 이동. **학생 그리드 아래**에 배치
- **학생 카드 가독성 개편** — 아바타(이미지)·이름·등급 배지를 크게, 레벨은 작게 카드 하단으로. 사진 아바타는 넓은 둥근 사각형으로 얼굴이 크게 보이도록. "보유 스킬 개수" 줄과 깜빡이는 "선택!" 배지는 제거(보상 대기는 잔잔한 금색 테두리로만 표시)
- **레벨·등급 편집** — 설정에 `🏅 레벨·등급` 탭 신설. 레벨별 **기준 XP**(큰 입력칸, blur 시 자동 저장, 이전<현재<다음 순서 검증)와 **등급**(🥉/🥈/🥇 3버튼 원탭, 등급별 색 구분)을 쉽게 보고 수정. 바꾼 값은 모든 학생의 레벨·등급 계산에 즉시 반영

### 효과음 (2026-07)

- **은은한 효과음** — 점수 부여(+/−), 레벨업, 스킬/보상 획득, 스킬 사용, HP ±, 학급 경험치 조정 시 상황에 맞는 짧은 사운드 재생
- **Web Audio API로 실시간 합성** — 오디오 파일을 넣지 않아 용량 0. 낮은 음량 + 부드러운 attack/release 엔벨로프 + 짧은 길이로 조잡하거나 소란스럽지 않게 설계 (레벨업은 은은한 상승 아르페지오 등)
- **헤더의 🔊 소리 버튼**으로 켜기/끄기 (localStorage에 저장, 음소거 시 아이콘이 🔇 로 바뀌고 흐려짐). 첫 소리는 사용자의 클릭(버튼 조작) 이후 재생되므로 브라우저 자동재생 정책과도 호환

### 트레이딩 카드 디자인 (2026-07)

- **학생 목록을 트레이딩 카드(포켓몬 카드 스타일)로 개편** — 아바타(사진/이모지)가 카드를 꽉 채우고, 하단 어두운 그라데이션 위에 이름·등급을 얹어 가독성 유지
- 좌상단 **HP 하트**, 우상단 **Lv 칩**, 하단 **희귀도 별(★)** + 등급 배지, 보상 대기 시 `🎁 선택` 칩
- **등급별 카드 차별화** — 브론즈(동테)·실버(메탈)·골드(두꺼운 금테+발광+코너 장식)·**다이아(무지개 홀로그램+반짝이)**. 프레임·이름판 색·별 색이 등급 따라 달라짐
- **말랑 클레이 3D 질감** — 몰딩된 아트창(안쪽 하이라이트/그늘), 도톰한 그림자, 말랑한 칩·배지

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

- **프로덕션 URL**: https://classup.pages.dev
- **플랫폼**: Cloudflare Pages (BYOK — 사용자 본인 계정)
- **프로젝트명**: `classup`
- **상태**: ✅ Live (로그인 → 학급 클레임/생성 → 학생 관리 풀 가동)

### 재배포 절차
```bash
cd /home/user/webapp
npm run build
npx wrangler pages deploy dist --project-name classup --branch main
```

### Secret 관리
```bash
# 목록 보기
npx wrangler pages secret list --project-name classup

# 값 변경 (예: 키 회전)
echo "<new-value>" | npx wrangler pages secret put SUPABASE_KEY --project-name classup
```

### 처음 배포할 때 한 번만 했던 것
1. Supabase SQL Editor에서 `migrations/supabase_0001_owner_email.sql` 실행
2. Supabase SQL Editor에서 `migrations/supabase_0002_avatar_image_and_activity_emoji.sql` 실행
3. `npx wrangler pages project create classup --production-branch main`
4. Secret 3개 등록: `SUPABASE_URL`, `SUPABASE_KEY`, `DEFAULT_CLASS_ID`
