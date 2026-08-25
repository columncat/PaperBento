import { NextResponse, type NextRequest } from "next/server";

import { verifySession } from "@/lib/auth-crypto";

/**
 * Edge-runtime 미들웨어 — DB 접근 X, bcrypt X.
 * 세션 쿠키 검증만 수행. auto-login 등 DB 기록은 /api/auth/auto-renew 에서 처리.
 */

const PUBLIC_PREFIXES = [
  "/login",
  "/api/login",
  "/api/auth/auto-renew",
  "/_next",
  "/favicon",
  /**
   * 복호화 서비스 워커 스크립트.
   * 로그인으로 리다이렉트되면 등록 자체가 실패해 암호화 파일을 열 수 없다.
   * 스크립트에 비밀은 없고, 키는 워커가 세션 쿠키로 따로 받아온다.
   */
  "/sw.js",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

/**
 * 이 요청이 화면 이동인가, 코드가 부르는 것인가.
 *
 * 브라우저의 `fetch` 는 리다이렉트를 **알아서 따라간다.** 그래서 세션이 끊긴
 * 뒤 `/api/…` 를 부르면 로그인 페이지 HTML 이 200 으로 도착하고, 받는 쪽은
 * 그걸 JSON 으로 읽다가 터진다:
 *
 *   Unexpected token '<', "<!DOCTYPE "... is not valid JSON
 *
 * 화면에는 로그인하라는 말 대신 저 문장이 뜬다. 더 나쁜 경우도 있었다 —
 * 파싱 실패를 빈 객체로 뭉개는 자리(`client-api.ts`)에서는 메모함 목록이
 * 통째로 비어, 자료가 지워진 것처럼 보였다.
 *
 * 그래서 API 에는 리다이렉트를 주지 않는다. 401 과 JSON 을 준다. 받는 쪽이
 * 무엇을 만났는지 알 수 있고, HTML 이 JSON 파서에 닿을 길이 사라진다.
 */
function isApi(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function unauthorized() {
  return NextResponse.json(
    { error: "로그인이 필요합니다", code: "unauthenticated" },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}

export async function middleware(req: NextRequest) {
  // 인증 비활성 → 통과
  if (!process.env.AUTH_PASSWORD) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const sessionToken = req.cookies.get("pb_session")?.value;
  if (sessionToken) {
    const session = await verifySession(sessionToken);
    if (session) return NextResponse.next();
  }

  /*
   * 보낼 곳은 `nextUrl` 을 복사해 만든다.
   *
   * `new URL("/login", req.url)` 로 만들면 하위 경로 배포에서 접두어가 빠진다.
   * `req.url` 은 `https://…/memo/settings` 인데 절대 경로를 얹으면 그 앞이
   * 통째로 지워져 `https://…/login` 이 되고, 그 자리에는 아무것도 없다.
   * `nextUrl` 은 자기가 어느 접두어 아래 있는지 알고 있어서 다시 붙여 준다.
   */
  const to = (path: string, params?: Record<string, string>) => {
    const url = req.nextUrl.clone();
    url.pathname = path;
    url.search = "";
    for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);
    return url;
  };

  // 화면 이동이면 갱신을 거쳐 원래 자리로 돌려보낸다. API 는 그럴 수 없다 —
  // 리다이렉트를 따라간 fetch 는 갱신 라우트가 마지막에 내보내는 HTML 을
  // 받아 들고 JSON 인 줄 알고 읽는다. 401 을 주고 화면이 다시 부르게 한다.
  const rememberToken = req.cookies.get("pb_remember")?.value;
  if (rememberToken) {
    const remember = await verifySession(rememberToken);
    if (remember) {
      if (isApi(pathname)) return unauthorized();
      return NextResponse.redirect(
        to("/api/auth/auto-renew", { to: pathname + req.nextUrl.search }),
      );
    }
  }

  if (isApi(pathname)) return unauthorized();

  return NextResponse.redirect(
    to("/login", pathname === "/" ? undefined : { from: pathname + req.nextUrl.search }),
  );
}

export const config = {
  /*
   * 확장자 제외를 넣지 않는다.
   *
   * 부정 전방탐색 안의 `.*\.(?:png|…)` 에는 끝 앵커가 없어서 확장자가 경로
   * **어디에** 있어도 걸린다. `/api/…/5.png` 같은 요청이 미들웨어를 통째로
   * 건너뛰고, 라우트는 `id="5.png"` 로 그대로 매치된다 — 로그인 없이 API 가
   * 열린다. 앵커를 붙여도 끝에 `.png` 를 달면 그만이라 소용없다.
   *
   * 정적 자산은 아래 PUBLIC_PREFIXES 의 "/_next" · "/favicon" 이 이미
   * 통과시키므로 여기서 뺄 이유가 없다.
   */
  /*
   * 첫 화면("/")을 따로 적는다.
   *
   * 하위 경로 배포에서 Next 는 이 패턴 앞에 접두어를 붙여 `/memo/((?!…).*)`
   * 로 만든다. 그러면 `/memo/settings` 는 걸리는데 **`/memo` 자체는 뒤에
   * 슬래시가 없어 안 걸린다.** 첫 화면이 미들웨어를 통째로 건너뛰어 로그인
   * 없이 열렸다. 접두어가 없는 배포에서는 원래 걸리던 것이라 눈에 띄지 않았다.
   */
  matcher: ["/", "/((?!_next/static|_next/image|favicon\\.ico).*)"],
};
