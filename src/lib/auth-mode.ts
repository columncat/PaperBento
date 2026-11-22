/**
 * 인증이 켜졌는지·꺼졌는지·**잘못 설정됐는지** 를 한 곳에서 가른다.
 *
 * 미들웨어(edge)와 서버 라우트(node) 가 함께 쓴다. 그래서 `env.ts`(zod) 나 DB 를
 * 끌어오지 않고 `process.env` 만 본다 — 미들웨어 번들에 node 전용 모듈이
 * 섞이면 빌드가 깨진다.
 *
 * 예전에는 `AUTH_PASSWORD` 가 비면 곧 "인증 끔" 이었다. 그러면 설정 파일이
 * 비밀번호 없이 한 번 다시 쓰이기만 해도(설치 마법사를 빈칸으로 다시 돌리는 식)
 * 앱이 **아무 말 없이 통째로 열린다.** 그래서 이제는 반대로 간다:
 *
 * - 비밀번호와 `AUTH_SECRET` 이 둘 다 있으면 → 켜짐.
 * - 하나라도 없는데 `AUTH_DISABLED=1` 을 **일부러** 적었으면 → 꺼짐.
 * - 그 밖에는 → 잘못된 설정. 미들웨어가 모든 요청을 503 으로 막는다.
 *
 * `AUTH_SECRET` 도 같이 보는 까닭: 비밀번호만 있고 키가 없으면 로그인은 되는 듯
 * 하다가 쿠키를 만드는 자리(`auth-crypto.ts`)에서 500 으로 터진다. 어느 쪽이 빠져도
 * "잠그려 했는데 못 잠근" 상태이니 같은 503 으로 알린다.
 *
 * 비밀번호가 있는데 `AUTH_DISABLED=1` 도 있으면 켜짐으로 본다 — 잠그라는 값이
 * 있는데 푸는 쪽으로 해석할 이유가 없다.
 */

export type AuthMode = "enabled" | "disabled" | "misconfigured";

export function authMode(): AuthMode {
  const password = process.env.AUTH_PASSWORD;
  const secret = process.env.AUTH_SECRET;
  if (password && secret) return "enabled";
  // 비밀번호가 적혀 있으면 AUTH_DISABLED=1 이 있어도 끄지 않는다 (위 주석). 키만
  // 빠진 그 상태는 "잠그려다 못 잠근" 것이라 503 으로 알린다.
  if (process.env.AUTH_DISABLED === "1" && !password) return "disabled";
  return "misconfigured";
}

/** 미들웨어가 막을 때 쓰는 문구. 어떤 값이 빠졌는지만 말하고 값 자체는 말하지 않는다. */
export const MISCONFIGURED_MESSAGE =
  "인증이 설정되지 않았습니다 (AUTH_PASSWORD · AUTH_SECRET). 인증 없이 쓰려면 AUTH_DISABLED=1 을 명시하세요.";
