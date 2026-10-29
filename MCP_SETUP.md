# 클업 읽기 전용 MCP

이 변경은 MCP 서버 코드를 추가합니다. **배포만으로 활성화되지는 않습니다.**
`MCP_ENABLED=true`와 `OAUTH_KV` 바인딩이 모두 있어야 연결할 수 있습니다.

## 비용 확인 후 활성화

1. Cloudflare 계정의 Workers 요금제가 Free인지 확인합니다. Paid/Enterprise라면 활성화하지 마세요. 무료 요청량은 기존 앱과 공유됩니다.
2. 기존 Supabase 프로젝트도 Free인지 확인하고 유료 전환·자동 결제 설정을 추가하지 마세요. MCP는 기존 Supabase를 SELECT로만 읽으며 새로운 DB나 AI API를 만들지 않습니다.
3. Cloudflare KV에 전용 네임스페이스 `classup-mcp-oauth`를 만들고 Pages의 classup → Settings → Bindings에서 `OAUTH_KV`로 연결합니다. 기존 바인딩과 secret은 유지합니다. 토큰·동의 요청은 이 KV에 저장됩니다.
4. Pages의 환경변수 `MCP_ENABLED`를 `true`로 설정합니다. 승인된 분석 연결을 여는 단계이므로 소유자가 확인한 뒤 수행합니다.
5. 변경을 main에 반영해 재배포합니다. 기존 GitHub Actions가 빌드와 배포를 실행합니다. KV 바인딩 추가·환경변수 변경 후에도 재배포가 필요합니다.
6. `/mcp`에 인증 없이 요청했을 때 401과 OAuth 메타데이터 안내가 반환되는지 확인합니다. 인증 없이 학생 데이터를 반환하면 안 됩니다.
7. ChatGPT의 사용자 지정 MCP 연결에 서버 URL `https://classup.pages.dev/mcp`, 인증 방식 OAuth를 등록합니다. 제공되는 메뉴·계정 지원 여부를 먼저 확인하며 요금제 업그레이드는 하지 마세요.
8. 클업 승인 화면에서 기존 클업 계정으로 로그인한 뒤 연결 대상과 조회 범위를 확인하고 승인합니다. 비밀번호·토큰을 채팅에 붙이지 마세요.
9. `list_my_classes`와 `get_activity_summary`를 실제로 호출해 결과를 확인한 후에만 연결 완료로 판단합니다.

현재 배포 프로젝트는 wrangler 설정에서 KV를 선언하지 않으므로, 위 바인딩은 대시보드에서 관리합니다. wrangler에 바인딩을 옮기는 경우 실제 namespace ID를 사용하고 기존 환경변수/바인딩이 덮어써지지 않는지 확인하세요.

무료 요금제와 현재 공식 정책 기준으로 Cloudflare Pages Functions는 Workers 무료 요청량(하루 100,000회)을 공유합니다. KV는 무료 읽기 하루 100,000건, 쓰기·삭제·목록 하루 각 1,000건을 제공하며 초과하면 오류로 중단됩니다. 모든 MCP 호출은 일부 서버·DB·KV 사용량을 소모합니다. **유료 요금제에서 이 코드만으로 청구액 0원을 보장하지 않습니다.**

- https://developers.cloudflare.com/pages/functions/pricing/
- https://developers.cloudflare.com/kv/platform/pricing/

## 제공 도구

| 도구 | 반환 내용 |
|---|---|
| `list_my_classes` | 승인한 교사가 소유한 학급 ID·이름(최대 10학급) |
| `get_student_status` | 소유 학급 학생 ID·번호·XP·HP·모둠(최대 200명) |
| `get_activity_summary` | 한국 시간 기준 날짜별·학생 번호별·활동별 점수 기록 집계 |

학생의 이름·닉네임·사진·개인 메모 필드는 읽거나 반환하지 않습니다. 모둠명·활동명 등 사용자가 입력한 텍스트에는 개인정보를 입력하지 마세요. 기록을 학생 성향·능력·장애 등에 대한 판단으로 해석하지 마세요.

기간 집계는 기본 최근 7일, 최대 31일·500건입니다. 501번째 기록이 발견되면 `truncated:true`로 표시하며 전체 통계로 해석하지 않도록 안내합니다. 조회 기간을 줄여 다시 호출하세요. 취소된 기록은 DB에서 삭제되므로 집계에서 제외됩니다. 점수 기록에는 카드팩 보상도 포함될 수 있습니다.

기존 학생 GET API는 코인을 정산하므로 MCP에서 재사용하지 않습니다. 분석 경로는 SELECT만 실행합니다. 점수 부여·코인 정산·학생 변경·삭제 도구가 없습니다.

## 인증과 중단

Cloudflare OAuth Provider의 OAuth 2.1/PKCE·브라우저에 묶인 일회용 동의·만료 토큰을 사용합니다. Supabase 세션을 MCP 앱으로 전달하지 않고 전용 토큰을 발급합니다. MCP 권한은 `classup:read` 하나이며 매 조회에서 학급 소유권을 다시 확인합니다. 액세스 토큰은 1시간, 갱신 토큰/연결은 최대 7일입니다.

- 특정 앱 연결 취소: 해당 MCP 클라이언트의 연결 해제/토큰 폐기 기능을 사용합니다. OAuth 메타데이터에 토큰 폐기 엔드포인트가 포함됩니다.
- 모든 MCP 요청 즉시 중단: `MCP_ENABLED`를 `false`로 바꾸고 재배포합니다.
- 이 버전은 DCR 기반 OAuth 연결을 제공합니다. CIMD만 사용하는 클라이언트는 지원하지 않습니다.

## 검증

Node 24에서:

```sh
npm ci
npm run typecheck
npm run build
npm run test:mcp
npm run test:oauth
```

테스트는 가짜 데이터와 메모리 KV를 사용해 외부 서비스 호출·과금을 발생시키지 않습니다. 운영 Workers 런타임과 실제 클라이언트 연결은 별도로 검증해야 합니다.
