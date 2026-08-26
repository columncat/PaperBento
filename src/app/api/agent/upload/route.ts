import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 채팅창에 붙인 파일을 에이전트에게 넘긴다.
 *
 * 파일은 다리를 지나 **MemoBento 의 Inbox 메모함**에 들어간다 — Discord 로
 * 보낸 첨부와 같은 자리다. 창구가 넷이어도 파일이 놓이는 곳은 하나여야 한다.
 *
 * **여기 붙인 PDF 는 이 앱의 서재로 오지 않는다.** 다리(`memo-inbox.ts`)가
 * MemoBento 한 곳만 알기 때문이다. 논문을 서재에 꽂으려면 채팅창이 아니라
 * 올리기(`/api/upload/*`)를 쓴다. 헷갈리기 쉬운 자리라 적어 둔다.
 *
 * 여기서는 열어 보지 않고 그대로 흘려보낸다. 이 앱이 파일을 들여다볼 이유가
 * 없고, 다시 조립하면 크기만 두 배로 든다.
 */

const AGENT_URL = process.env.AGENT_URL?.trim();
const AGENT_TOKEN = process.env.AGENT_TOKEN?.trim();

/** 봇 쪽 상한과 같은 값. 여기서 먼저 끊어 헛되이 흘려보내지 않는다. */
const MAX_BYTES = 25 * 1024 * 1024;
/** 큰 파일은 오래 걸린다. 다만 앞의 터널이 100초에서 끊으므로 그 안쪽으로 둔다. */
const TIMEOUT_MS = 90_000;

export async function POST(req: Request) {
  if (!AGENT_URL || !AGENT_TOKEN) {
    return NextResponse.json({ error: "에이전트가 설정되지 않았습니다" }, { status: 503 });
  }
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("multipart/form-data")) {
    return NextResponse.json({ error: "multipart/form-data 가 아닙니다" }, { status: 400 });
  }

  const body = Buffer.from(await req.arrayBuffer());
  if (body.length > MAX_BYTES) {
    return NextResponse.json({ error: "파일이 너무 큽니다 (최대 25MB)" }, { status: 413 });
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(new URL("/chat/upload", AGENT_URL), {
      method: "POST",
      headers: { authorization: `Bearer ${AGENT_TOKEN}`, "content-type": ct },
      body,
      signal: ctl.signal,
    });
    const text = await res.text();
    return NextResponse.json(text ? JSON.parse(text) : {}, { status: res.status });
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return NextResponse.json(
      { error: aborted ? "올리는 데 너무 오래 걸립니다" : "에이전트에 닿지 못했습니다" },
      { status: 502 },
    );
  } finally {
    clearTimeout(timer);
  }
}
