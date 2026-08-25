/**
 * Node runtime 전용 인증 유틸 — DB / bcryptjs 사용.
 * 미들웨어에서 직접 import 하지 말 것 (edge 호환 안 됨).
 * 쿠키 crypto 는 lib/auth-crypto.ts 에 분리되어 있음 (edge 호환).
 */

import bcrypt from "bcryptjs";

import { db, schema } from "./db";
import { env } from "./env";

export function isAuthEnabled(): boolean {
  return !!env.AUTH_PASSWORD;
}

/** Plaintext 와 bcrypt 해시 둘 다 자동 감지. timing-safe 비교. */
export function verifyPassword(input: string): boolean {
  const stored = env.AUTH_PASSWORD;
  if (!stored) return false;

  if (
    stored.startsWith("$2a$") ||
    stored.startsWith("$2b$") ||
    stored.startsWith("$2y$")
  ) {
    try {
      return bcrypt.compareSync(input, stored);
    } catch {
      return false;
    }
  }

  if (input.length !== stored.length) return false;
  let mismatch = 0;
  for (let i = 0; i < stored.length; i++) {
    mismatch |= input.charCodeAt(i) ^ stored.charCodeAt(i);
  }
  return mismatch === 0;
}

/** 로그인 기록 한 줄 추가. DELETE 엔드포인트는 의도적으로 없음. */
export async function logLogin(opts: {
  type: "manual" | "auto";
  success: boolean;
  userAgent: string;
}): Promise<void> {
  await db
    .insert(schema.loginLog)
    .values({
      type: opts.type,
      success: opts.success ? 1 : 0,
      userAgent: opts.userAgent.slice(0, 500),
    })
    .run();
}

// ─────────────────────────────────────────────────────────────
//   세션 / remember 쿠키 정책
// ─────────────────────────────────────────────────────────────

/*
 * 쿠키 이름은 **앱마다 다르다.**
 *
 * MailBento 와 MemoBento 는 둘 다 `mb_session` 을 쓴다. 하위 도메인으로 나눠
 * 두면 문제가 없지만, `BASE_PATH` 로 한 도메인에 `/mail`·`/memo`·`/paper` 를
 * 얹으면 쿠키는 경로를 구분하지 않으므로 **나중에 로그인한 앱이 앞 앱의 세션을
 * 덮어쓴다.** 논문함은 그 충돌에서 빠져 나온다.
 *
 * `middleware.ts` 도 같은 이름을 문자열로 들고 있다 — 거기는 Edge 런타임이라
 * 이 모듈(node crypto 를 쓴다)을 import 할 수 없다. 한쪽을 고치면 다른 쪽도.
 */
export const SESSION_COOKIE_NAME = "pb_session";
export const REMEMBER_COOKIE_NAME = "pb_remember";

const HOUR = 3600;
const DAY = 24 * HOUR;

/** "remember" 안 한 경우 세션 유효시간 (browser-close 로도 끊김). */
export const SESSION_TTL_SHORT = 4 * HOUR;
/** "remember" 한 경우 세션 유효시간. */
export const SESSION_TTL_LONG = 24 * HOUR;
/** "remember" 쿠키 자체의 유효시간 — 이게 진짜 "자동 로그인" 기간. */
export const REMEMBER_TTL = 90 * DAY;

export function sessionCookieOptions(remember: boolean) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    ...(remember ? { maxAge: SESSION_TTL_LONG } : {}),
  };
}

export function rememberCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: REMEMBER_TTL,
  };
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
