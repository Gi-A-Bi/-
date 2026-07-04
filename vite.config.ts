import build from '@hono/vite-build/cloudflare-pages'
import devServer from '@hono/vite-dev-server'
import adapter from '@hono/vite-dev-server/cloudflare'
import { defineConfig } from 'vite'

export default defineConfig({
  define: {
    // 빌드 시각 기반 버전 문자열 — 정적 파일 주소에 ?v=… 로 붙여 브라우저 캐시를 무효화
    __BUILD_ID__: JSON.stringify(Date.now().toString(36)),
  },
  plugins: [
    build(),
    devServer({
      adapter,
      entry: 'src/index.tsx'
    })
  ]
})
