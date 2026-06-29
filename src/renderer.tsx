import { jsxRenderer } from 'hono/jsx-renderer'

export const renderer = jsxRenderer(({ children }) => {
  return (
    <html lang="ko">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <meta name="theme-color" content="#0e0925" />
        <title>클업 (CLASS UP)</title>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
        {/* 본문: Pretendard (한글 UI 표준, 가독성 높음) — CDN으로 동적 서브셋 */}
        <link rel="preconnect" href="https://cdn.jsdelivr.net" />
        <link href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" rel="stylesheet" />
        {/* 타이틀/브랜드용 명조 + 라틴 장식체 */}
        <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700;900&family=Nanum+Myeongjo:wght@700;800&display=swap" rel="stylesheet" />
        {/* 엑셀 파일 파싱용 (학생 일괄 등록) - 약 450KB, 사용 시점에만 로드되도록 defer */}
        <script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js" defer></script>
        <link href="/static/style.css" rel="stylesheet" />
      </head>
      <body>
        {children}
        <script src="/static/app.js"></script>
      </body>
    </html>
  )
})
