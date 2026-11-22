/**
 * 하위 경로에 얹을 때 쓰는 값.
 *
 * `bento.example.com/paper` 처럼 도메인 하나를 나눠 쓰는 배포에서 필요하다.
 * 앞단에서 경로만 갈라 보내면 앱은 자기가 `/paper` 아래 있다는 것을 모르고
 * `/settings` 같은 절대 경로를 만들어 낸다 — 브라우저는 그걸 도메인 뿌리로
 * 해석해서 엉뚱한 곳으로 간다.
 *
 * **빌드 시점에 박히는 값이다.** 이미지를 만들 때 정해야 하고 나중에
 * 환경변수로 바꿀 수 없다. Next 가 이 값을 산출물 곳곳(정적 자산 주소,
 * 라우트 표, 클라이언트 번들)에 미리 심기 때문이다.
 *
 * 비워 두면 예전처럼 뿌리에서 돈다. 하위 도메인을 쓰는 배포는 건드릴 필요가 없다.
 */
const basePath = (process.env.BASE_PATH ?? "").replace(/\/$/, "");

/**
 * 모든 응답에 붙이는 보안 머리글.
 *
 * HSTS 는 여기 없다 — Cloudflare 가장자리에서 붙인다. 앱이 직접 붙이면 http 로
 * 도는 개발·LAN 배포에서도 같은 값이 나가 엉뚱하게 굳는다.
 *
 * - `X-Frame-Options: SAMEORIGIN` · `frame-ancestors 'self'` — DENY 가 아니다.
 *   PDF 는 같은 오리진의 iframe(`pdf-frame.tsx`, 파일 라우트)으로 뜬다. DENY 면
 *   pdf.js 가 못 뜰 때 물러나는 기본 보기가 빈 칸이 된다.
 * - `Referrer-Policy: same-origin` — `no-referrer` 로 두면 Chrome 이 같은 오리진
 *   POST 에도 `Origin: null` 을 보내 Origin 을 보는 검사가 전부 거절된다.
 */
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // 카메라·마이크·위치를 쓰는 곳이 없다. 서재 안에 끼어든 무엇도 묻지 못하게 한다.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
];

/**
 * 화면용 CSP. 이 앱이 실제로 쓰는 것만 연다 — 하나라도 빠지면 화면이 깨지므로
 * 각 줄에 이유를 적어 둔다.
 *
 * - script `'unsafe-inline'`: App Router 가 흘려 보내는 `self.__next_f.push(…)` 와
 *   `layout.tsx` 의 테마 부트 스크립트가 인라인이다. 막으면 화면이 하얗게 빈다.
 *   nonce 로 가려면 모든 화면이 동적 렌더가 되어야 해서 택하지 않았다.
 *   `'unsafe-eval'` 은 없다 — 운영 빌드는 eval 을 쓰지 않는다. pdf.js 는 eval 이
 *   되는지 try/catch 로 떠보고 안 되면 느린 길로 그린다.
 * - style `'unsafe-inline'`: React `style=` 과 pdf.js 뷰어가 쪽마다 쓰는 인라인 스타일.
 * - jsdelivr: Pretendard 글꼴 CSS 와 그 CSS 가 부르는 글꼴 파일.
 *   fonts.googleapis.com / fonts.gstatic.com: 본문·제목 글꼴 (`layout.tsx`).
 * - img `data:` `blob:`: 브라우저가 PDF 첫 쪽을 그려 만드는 표지(캔버스 → blob).
 * - worker `'self'` `blob:`: pdf.js 워커는 `/_next/static` 에서 뜨지만, 주소를 못
 *   풀면 pdf.js 가 blob 으로 감싸 띄운다.
 * - connect `'self'`: DOI·arXiv·Crossref 조회는 서버가 한다. 브라우저는 자기 API 와
 *   `/pdfjs/` CMap 만 받는다.
 * - frame `'self'`: 내장 뷰어로 물러날 때의 PDF iframe.
 * - object `'none'`: `<object>`·`<embed>` 로 PDF 를 띄우는 곳이 없다 (iframe 만 쓴다).
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com",
  "font-src 'self' data: https://cdn.jsdelivr.net https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "frame-src 'self' blob:",
  "frame-ancestors 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // `X-Powered-By: Next.js` 는 판 번호를 찾는 쪽에 길만 알려 준다.
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      /*
       * CSP 는 파일 라우트(`/api/files/…`)를 **뺀다.** 그 라우트는 원본 PDF·표지에
       * `sandbox` CSP 를 스스로 붙인다 (`lib/file-kind.ts` 의 `cspFor`). 여기서 하나
       * 더 붙이면 브라우저는 두 정책을 **모두** 지키므로, 화면용 정책이 내장 PDF
       * 뷰어를 막아 빈 iframe 이 된다.
       *
       * basePath 가 있으면 Next 가 source 앞에 접두어를 알아서 붙인다. 첫 화면
       * (`/paper` 자체)은 아래 정규식에 안 걸릴 수 있어 따로 적는다.
       */
      { source: "/", headers: [{ key: "Content-Security-Policy", value: CSP }] },
      {
        source: "/((?!api/files/).*)",
        headers: [{ key: "Content-Security-Policy", value: CSP }],
      },
    ];
  },
  /*
   * 번들에 말아 넣지 않고 런타임에 require 로 두는 것.
   *
   * better-sqlite3 는 네이티브 애드온이라 번들러가 손대면 .node 를 못 찾는다.
   *
   * **pdfjs-dist 는 여기 없다.** 1단계에서 pdfjs 를 쓰는 곳은 `lib/thumbnail.ts`
   * 하나뿐이고 그건 브라우저 전용이다 — 올리기 전에 표지를 만든다. 그런데
   * 그 파일이 워커 주소를
   *   new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)
   * 로 잡는데, pdfjs-dist 를 external 로 빼면 webpack 이 이 `.mjs` 를 CJS require
   * 로 풀려다 "ESM packages need to be imported" 로 빌드가 멎는다. external 에서
   * 빼면 webpack 이 워커를 정적 자산으로 뽑아 주고 주소도 알아서 맞춘다.
   *
   * 3단계에서 **서버가** PDF 글자층을 뽑기 시작하면 그때 다시 필요해진다.
   * 그때는 `"pdfjs-dist"` 를 여기 되돌리는 동시에 워커를 `public/` 에서 받도록
   * `thumbnail.ts` 를 함께 고쳐야 한다. 한쪽만 바꾸면 이 빌드 오류가 돌아온다.
   */
  serverExternalPackages: ["better-sqlite3"],
  ...(basePath ? { basePath } : {}),
  env: {
    /*
     * 브라우저 코드에도 알려 준다.
     *
     * Next 는 <Link> 와 router 와 정적 자산에는 접두어를 알아서 붙이지만
     * **fetch 는 손대지 않는다.** `fetch("/api/…")` 는 도메인 뿌리로 가서
     * 404 를 받는다. 그래서 부를 때 직접 붙여야 하고, 그러려면 값이 필요하다.
     */
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
};

export default nextConfig;
