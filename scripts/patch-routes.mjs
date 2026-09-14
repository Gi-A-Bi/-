// =============================================================================
//  _routes.json 보정 — 확장자 없는 경로도 정적 자산으로 넘긴다
// =============================================================================
//  Cloudflare Pages는 /privacy.html 요청을 /privacy 로 308 리다이렉트한다.
//  그런데 @hono/vite-build가 생성하는 _routes.json의 exclude 목록에는
//  실제 파일명(/privacy.html)만 들어간다. 그래서 리다이렉트된 /privacy 가
//  exclude에 걸리지 않고 Worker로 들어가, 해당 라우트가 없으니 404가 난다.
//
//  exclude에 있는 .html 경로마다 확장자를 뗀 형태를 함께 추가해
//  두 주소 모두 정적 자산으로 처리되게 한다.
// =============================================================================
import { readFile, writeFile } from 'node:fs/promises'

const ROUTES = 'dist/_routes.json'

const routes = JSON.parse(await readFile(ROUTES, 'utf8'))
const exclude = routes.exclude ?? []

const extensionless = exclude
  .filter((p) => p.endsWith('.html'))
  .map((p) => p.replace(/\.html$/, ''))
  // "/index.html" → "/" 는 앱의 홈 라우트이므로 건드리지 않는다
  .filter((p) => p !== '/index' && p !== '' && !exclude.includes(p))

if (extensionless.length === 0) {
  console.log('[patch-routes] 추가할 경로 없음')
} else {
  routes.exclude = [...exclude, ...extensionless]
  await writeFile(ROUTES, JSON.stringify(routes))
  console.log(`[patch-routes] exclude에 추가: ${extensionless.join(', ')}`)
}
