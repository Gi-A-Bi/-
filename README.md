# 우리반 모험단 (Class Adventure)

## 프로젝트 개요
- **이름**: 우리반 모험단
- **목적**: 초등학교 교사용 **학급경영 게임화 웹앱**. 학생을 RPG 캐릭터처럼 다루어 XP·레벨·등급·스킬로 학급 활동을 게임화한다.
- **사용 환경**: 스마트폰 우선의 반응형 모바일 웹앱 (단일 학급, 추후 멀티 학급 확장 대비 구조)

## 주요 기능 (완료)
- ✅ **학생 목록** — 그리드 카드: 아바타·이름·레벨·등급 배지·보유 스킬 수 표시, 선택 대기 시 펄스 배지
- ✅ **학생 상세 캐릭터 시트** — 큰 아바타, Lv/등급, HP 하트 3개(±버튼), XP 진행바, 다음 레벨까지 남은 XP
- ✅ **점수 주기 버튼 6종** — 숙제 제출(+20), 출석 체크(+10), 아침 독서(+10), 친구 돕기(+20), 폭풍 칭찬(+30), 벌점(-10)
- ✅ **자동 레벨/등급 계산** — XP 변동 시 즉시 레벨·등급·패시브 스킬 재계산
- ✅ **레벨업 시 해금 스킬 자동 지급** — 보유 스킬에 누적
- ✅ **Lv.5·10·20 선택형 보상** — A/B 두 보상 중 학생이 직접 선택, 도달 시 강조 UI(글로우 펄스)와 펄스 배지로 안내
- ✅ **소모성 스킬 사용** — "사용하기" 버튼으로 보유 목록에서 제거하고 활동 기록에 자동 기록
- ✅ **패시브 스킬 표시** — 현재 레벨에 정의된 상시 효과를 캐릭터 시트에 항상 노출
- ✅ **활동 기록 화면** — 점수 부여·레벨업·스킬 사용·선택 보상 모두 시간 역순으로 표시(아바타, 활동 아이콘, "n분 전" 형식)
- ✅ **설정(레벨표 편집)** — 필요 XP, 등급(브론즈/실버/골드), 해금 스킬, 패시브 스킬, 선택형 보상 A/B를 자유롭게 추가·수정·삭제
- ✅ **D1 데이터베이스 영속화** — 새로고침/재시작 후에도 모든 기록 보존
- ✅ **토스트 알림** — 점수 부여, 레벨업 🎉, 새 스킬 획득 🎁, 선택 보상 등을 연속 애니메이션 토스트로 안내
- ✅ **게임 느낌의 컬러풀 UI** — 보라/핑크/노랑 그라데이션 배경, 한국어 게임체 폰트(Jua/Gaegu), 등급별 메탈릭 배지, 카드 펄스/글로우 애니메이션

## 접속 URL
- **로컬 미리보기**: http://localhost:3000
- **공개 미리보기**: (GetServiceUrl로 생성된 sandbox URL)

## API 엔드포인트 (기능 진입 경로)
| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/classes` | 학급 목록 (확장 대비) |
| GET | `/api/classes/:classId/students` | 학생 목록 (레벨/등급/패시브/스킬수/선택대기수 포함) |
| GET | `/api/students/:id` | 학생 상세 (XP진행도/보유스킬/선택대기) |
| POST | `/api/students/:id/score` | 점수 부여 `{activity_name, score_delta}` — 레벨업·스킬지급·선택대기 자동 처리 |
| POST | `/api/students/:id/hp` | HP 조정 `{delta}` |
| POST | `/api/students/:id/skills/:skillId/use` | 보유 스킬 사용 (소모) |
| POST | `/api/students/:id/choices/:choiceId/resolve` | 선택형 보상 결정 `{pick: 'A'|'B'}` |
| GET | `/api/classes/:classId/logs?limit=N` | 활동 기록 (시간 역순) |
| GET | `/api/classes/:classId/level-table` | 레벨표 조회 |
| PUT | `/api/classes/:classId/level-table/:level` | 레벨 행 추가/수정 |
| DELETE | `/api/classes/:classId/level-table/:level` | 레벨 행 삭제 |

## 데이터 구조 (Cloudflare D1 / SQLite)
- **classes**: `id, name, teacher_name` — 학급 단위 (멀티 학급 확장 대비)
- **students**: `id, class_id, name, avatar_color, xp, hp, max_hp` — 모든 학생은 학급에 소속
- **level_table**: `class_id, level, required_xp, rank, unlock_skill, passive_skill, is_choice, choice_a, choice_b` — **학급별로** 자유롭게 편집 가능
- **student_skills**: `student_id, skill_name, source_level` — 보유한 해금 스킬(누적·소모)
- **pending_choices**: `student_id, level, choice_a, choice_b` — 선택 대기 중인 보상
- **activity_logs**: `student_id, class_id, log_type, activity_name, score_delta, created_at` — `log_type: score|skill_use|level_up|skill_choice`

**핵심 비즈니스 로직** (서버 측):
1. `POST /api/students/:id/score` 호출 → XP 갱신 → 새 레벨 계산 → `oldLevel+1 ~ newLevel` 사이 모든 레벨의 보상을 한 번에 처리
2. 각 레벨: `is_choice=1`이면 `pending_choices`에 추가, 아니면 `unlock_skill`을 `student_skills`에 즉시 지급
3. 모든 단계가 `activity_logs`에 자동 기록

## 예시 학생 (시드 데이터)
| 이름 | XP | 레벨 | 등급 | 특이사항 |
|---|---|---|---|---|
| 김민준 | 35 | 1 | 🥉 브론즈 | 시작 |
| 이서연 | 175 | 3 | 🥉 브론즈 | 스킬 2개 보유 |
| 박지호 | 380 | 5 | 🥈 실버 | **Lv.5 선택 대기 중!** |
| 최예린 | 600 | 6 | 🥈 실버 | 스킬 4개 보유 |
| 정도윤 | 90 | 2 | 🥉 브론즈 | HP 1 (낮음) |
| 강하은 | 1320 | 9 | 🥈 실버 | 스킬 8개 보유 |

## 사용 가이드
1. **메인 화면**: 학생 카드를 누르면 캐릭터 시트로 이동. 노란 펄스 배지("선택!")가 있으면 그 학생이 보상 선택 대기 중.
2. **점수 주기**: 캐릭터 시트의 6개 활동 버튼을 탭 → 즉시 XP 변화, 레벨업 시 토스트 알림이 순차로 나옴.
3. **스킬 사용**: 보유 스킬 카드의 "사용하기" 버튼 → 확인 모달 → 스킬이 사라지고 활동 기록에 남음.
4. **선택형 보상**: 노란 발광 카드에서 A/B 중 하나를 탭 → 선택된 스킬이 보유 목록에 추가.
5. **헤더 📜 버튼**: 모든 학생의 활동 기록(시간 역순).
6. **헤더 ⚙️ 버튼**: 레벨표 편집(필요 XP·등급·해금 스킬·패시브·선택형 보상 자유 수정, 새 레벨 추가).

## 아직 구현하지 않은 것 / 향후 확장 방향
- ⏳ **멀티 학급 / 다중 교사** — 스키마는 `class_id`로 분리되어 있어 곧바로 확장 가능. 현재는 학급 1개 고정(`state.classId = 1`).
- ⏳ **교사 로그인/인증** — 현재는 인증 없음. 추후 Cloudflare Access나 외부 OAuth로 학급별 권한 분리.
- ⏳ **학생 추가/수정/삭제 UI** — 현재는 시드 6명. 학생 CRUD 화면 추가 가능.
- ⏳ **HP 회복 활동 / HP 룰** — 현재는 ± 수동 조정. "벌점 시 HP 차감" 등 규칙 자동화 가능.
- ⏳ **통계/순위** — 학급 평균 레벨, 활동 빈도 차트.
- ⏳ **CSV 내보내기 / 학기 초기화** — 학기 종료 시 데이터 백업·리셋.
- ⏳ **푸시 알림(PWA)** — 모바일 홈 화면 추가, 오프라인 캐시.

## 추천 다음 단계
1. **학생 CRUD UI** 추가 → 시드 없이도 학급 개설 가능하게.
2. **여러 학급/교사 지원** — 학급 선택 화면 추가, `state.classId`를 URL/스토리지로 관리.
3. **간단한 인증** — 교사 로그인(Cloudflare Access나 패스코드).
4. **PWA 매니페스트** + 서비스 워커로 모바일 홈에 설치 가능하게.
5. **활동 버튼 자체를 교사가 편집**할 수 있게 (현재는 코드 상수, 향후 `class_id`별 활동 테이블).

## 기술 스택
- **백엔드**: Hono (Cloudflare Pages Functions)
- **DB**: Cloudflare D1 (로컬은 SQLite, `--local` 모드)
- **프론트엔드**: 순수 JS SPA (CDN: Font Awesome, Google Fonts(Jua/Gaegu))
- **빌드**: Vite + `@hono/vite-build/cloudflare-pages`
- **프로세스 매니저**: PM2

## 배포 상태
- **로컬 개발**: ✅ PM2로 실행 중 (`wrangler pages dev` + local D1)
- **Cloudflare Pages**: ❌ 아직 배포 안 됨 (요청 시 배포)
- **최종 업데이트**: 2026-05-23

## 로컬 개발 명령
```bash
# DB 초기화 (스키마 + 시드)
npm run db:reset

# 빌드
npm run build

# 실행 (PM2)
pm2 start ecosystem.config.cjs
pm2 logs --nostream

# 종료
pm2 delete webapp
```
