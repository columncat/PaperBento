import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * BentoAgent 로 가는 프록시.
 *
 * 브라우저가 에이전트를 직접 부르지 않는 이유는 두 가지다 — 공유 토큰이 화면에
 * 실리면 안 되고, 이 앱에 이미 있는 로그인을 그대로 경계로 쓰고 싶다.
 * 미들웨어가 이 경로를 지키므로, 로그인하지 않으면 여기까지 오지 못한다.
 *
 * 대화 맥락은 여기 두지 않는다. 에이전트 쪽 세션 하나에 있고 Discord 와 같은
 * 것을 쓴다 — 창구가 달라도 같은 대화다.
 */

const AGENT_URL = process.env.AGENT_URL?.trim();
const AGENT_TOKEN = process.env.AGENT_TOKEN?.trim();

/**
 * 여기서 오가는 요청은 전부 금방 끝난다.
 *
 * 예전에는 답이 나올 때까지(최대 330초) 붙들었는데, 이 앱 앞에는 Cloudflare
 * 터널이 있고 원본 응답을 100초까지만 기다린다. 도구를 몇 번 쓰는 답은 대개
 * 그보다 오래 걸려서 거의 매번 끊겼다 — 화면에는 "failed to fetch" 만 뜨고,
 * 다시 보내면 같은 질문이 두 번 들어갔다.
 *
 * 이제 시작만 시키고 번호를 받아 와서 짧게 여러 번 물어본다. 긴 연결이 없으니
 * 끊길 자리도 없다.
 */
const TIMEOUT_MS = 15_000;

const bodySchema = z.object({
  message: z.string().trim().max(8000).default(""),
  /** 먼저 올려 둔 파일의 번호들. 파일만 보내는 것도 된다. */
  attachments: z.array(z.string().min(1).max(64)).max(5).optional(),
});

function unconfigured() {
  return NextResponse.json(
    { error: "에이전트가 설정되지 않았습니다 (AGENT_URL / AGENT_TOKEN)" },
    { status: 503 },
  );
}

async function forward(path: string, body?: unknown) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(new URL(path, AGENT_URL), {
      method: "POST",
      headers: {
        authorization: `Bearer ${AGENT_TOKEN}`,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctl.signal,
    });
    const text = await res.text();
    return NextResponse.json(text ? JSON.parse(text) : {}, { status: res.status });
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return NextResponse.json(
      {
        error: aborted
          ? "에이전트가 제 시간에 답하지 않았습니다"
          : `에이전트에 닿지 못했습니다: ${e instanceof Error ? e.message : String(e)}`,
      },
      { status: 502 },
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 버튼을 보일지 정하는 데 쓴다.
 *
 * 환경변수만 보지 않고 실제로 닿는지까지 확인한다. 설정은 돼 있는데 에이전트가
 * 떠 있지 않으면 버튼이 보이고 눌렀을 때만 실패하는데, 그건 없느니만 못하다.
 */
export async function GET(req: Request) {
  if (!AGENT_URL || !AGENT_TOKEN) return NextResponse.json({ configured: false });

  // 지난 대화 불러오기 — 웹으로 주고받은 것만 있다 (Discord 쪽은 제외).
  if (new URL(req.url).searchParams.get("history") === "1") {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 5000);
    try {
      const res = await fetch(new URL("/history", AGENT_URL), {
        headers: { authorization: `Bearer ${AGENT_TOKEN}` },
        signal: ctl.signal,
      });
      const text = await res.text();
      return NextResponse.json(text ? JSON.parse(text) : { turns: [] });
    } catch {
      return NextResponse.json({ turns: [] });
    } finally {
      clearTimeout(timer);
    }
  }

  // 진행 중인 작업 물어보기. 화면이 몇 초마다 부른다.
  const job = new URL(req.url).searchParams.get("job");
  if (job) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10_000);
    try {
      const res = await fetch(
        new URL(`/chat/status?id=${encodeURIComponent(job)}`, AGENT_URL),
        { headers: { authorization: `Bearer ${AGENT_TOKEN}` }, signal: ctl.signal },
      );
      const text = await res.text();
      return NextResponse.json(text ? JSON.parse(text) : {}, { status: res.status });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : String(e) },
        { status: 502 },
      );
    } finally {
      clearTimeout(timer);
    }
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 2000);
  try {
    const res = await fetch(new URL("/health", AGENT_URL), { signal: ctl.signal });
    return NextResponse.json({ configured: res.ok });
  } catch {
    return NextResponse.json({ configured: false });
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(req: Request) {
  if (!AGENT_URL || !AGENT_TOKEN) return unconfigured();
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "message 가 필요합니다" }, { status: 400 });
  }
  // 시작만 시키고 번호를 받는다. 답은 화면이 따로 물어본다.
  const { message, attachments } = parsed.data;
  if (!message && (attachments?.length ?? 0) === 0) {
    return NextResponse.json({ error: "보낼 것이 없습니다" }, { status: 400 });
  }
  return forward("/chat/start", { message, attachments, from: "paperbento" });
}

/** 새 대화 — 에이전트 쪽 세션을 버린다 (Discord 맥락도 함께 사라진다). */
export async function DELETE() {
  if (!AGENT_URL || !AGENT_TOKEN) return unconfigured();
  return forward("/reset");
}
