/*
 * 환경변수를 한 군데서 읽고 한 번만 검증한다.
 *
 * 여기 없는 값을 `process.env` 에서 직접 꺼내 쓰기 시작하면, 오타 난 이름이
 * 조용히 undefined 로 흘러 들어가 한참 뒤 엉뚱한 곳에서 터진다.
 */
import { z } from "zod";

const envSchema = z.object({
  DATABASE_PATH: z.string().default("./data/paperbento.db"),

  /** 올린 PDF 원본과 표지 썸네일이 저장되는 디렉터리. Docker 에서는 볼륨 내부. */
  UPLOAD_DIR: z.string().default("./data/uploads"),
  /**
   * 업로드 1건당 최대 크기 (MB). 조각 전송이라 메모리와 무관하게 키울 수 있다.
   * 논문 PDF 는 대개 몇 MB 지만 스캔한 학위논문은 수백 MB 가 되기도 한다.
   */
  MAX_UPLOAD_MB: z.coerce.number().int().positive().max(51200).default(5120),

  /**
   * 자매 앱으로 건너가는 헤더 버튼의 주소 (선택).
   *
   * 비우면 지금 접속한 호스트의 3000 / 3001 포트로 유추한다 — LAN / Tailscale
   * 어느 주소로 들어왔든 같은 경로를 따라가므로 보통 비워 두면 된다.
   * 다만 한 도메인을 경로로 나눠 쓰는 배포(`/mail`, `/memo`)에서는 그 유추가
   * 맞지 않으니 전체 주소를 적어야 한다.
   */
  MAILBENTO_URL: z.string().optional(),
  MEMOBENTO_URL: z.string().optional(),

  /**
   * 에이전트(BentoAgent)의 HTTP 입구. 둘 다 채워야 채팅창이 뜬다.
   * 브라우저가 직접 부르지 않고 이 앱이 서버에서 프록시하므로 토큰은
   * 브라우저로 내려가지 않는다.
   */
  AGENT_URL: z.string().optional(),
  AGENT_TOKEN: z.string().optional(),

  /**
   * 인증 설정 — 둘 다 비우면 인증 비활성 (앱 그대로 공개).
   * - AUTH_PASSWORD: plaintext 또는 bcrypt 해시 ($2a$ / $2b$ 시작). 둘 다 자동 감지.
   * - AUTH_SECRET: 세션 쿠키 암호화 키 (32바이트 base64).
   */
  AUTH_PASSWORD: z.string().optional(),
  AUTH_SECRET: z.string().optional(),
});

export const env = envSchema.parse(process.env);

export type Env = z.infer<typeof envSchema>;
