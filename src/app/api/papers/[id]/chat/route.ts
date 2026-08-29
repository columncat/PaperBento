import { NextResponse } from "next/server";
import { z } from "zod";

import { getPaperRow } from "@/lib/paper-server";

/**
 * 논문 한 편을 두고 나누는 대화 — BentoAgent 로 가는 프록시.
 *
 * 브라우저는 에이전트를 직접 부르지 않는다. 공유 토큰이 화면에 실리면 안 되고,
 * 이 앱에 이미 있는 로그인을 그대로 경계로 쓰고 싶다. 미들웨어가 이 경로를
 * 지키므로 로그인하지 않으면 여기까지 오지 못한다.
 *
 * ## `/api/agent/chat` 과 무엇이 다른가
 *
 * 저쪽은 **하나뿐인 공용 세션**(Discord 와 같은 것)을 본다. 이쪽은 논문마다
 * 따로 이어지는 세션을 본다 — `paperId` 가 늘 함께 간다. 다른 논문 이야기와
 * Discord 대화가 한 자루에 섞이면 "이 논문에 대해" 라는 말이 뜻을 잃는다.
 *
 * 그래서 에이전트 쪽 입구도 다르다(`/paper` 계열). 저쪽 입구에 깃발을 하나
 * 더 다는 길은 쓰지 않는다 — 한 입구가 두 신뢰 수준을 갖게 되면 깃발을
 * 빠뜨린 호출 하나가 조용히 전권으로 돈다.
 *
 * ## 오래 걸리는 일이라 시작과 끝이 다른 요청이다
 *
 * POST 로 시작만 시키고 번호를 받는다. GET `?job=` 으로 몇 초마다 물어본다.
 * 답을 기다리며 요청을 붙들면 앞의 Cloudflare 터널이 100초에서 끊는다 —
 * 채팅창이 그렇게 겪었고, 화면에는 "failed to fetch" 만 떴다.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const AGENT_URL = process.env.AGENT_URL?.trim();
const AGENT_TOKEN = process.env.AGENT_TOKEN?.trim();

/** 시작·상태 요청은 전부 금방 끝난다. 긴 연결이 없으니 넉넉할 이유가 없다. */
const TIMEOUT_MS = 15_000;

/**
 * 부를 수 있는가.
 *
 * 판정은 `lib/suggest.ts` 의 `agentReady()` 와 **같은 두 환경변수**다. 문장만
 * 다르다 — 저쪽 문장은 시트의 토글을 가리키고 여기는 대화창이다. 조건이
 * 늘어나는 날에는 두 곳을 함께 봐야 한다.
 *
 * 옆 프록시(`/api/agent/chat`)도 환경변수를 여기서처럼 제 자리에서 읽는다.
 * 프록시가 서버 모듈을 끌어오지 않는 편이 이 파일 하나만 보고도 무엇이
 * 필요한지 알 수 있어 낫다.
 */
function readiness(): { ready: boolean; reason: string | null } {
  if (!AGENT_URL || !AGENT_TOKEN) {
    return {
      ready: false,
      reason:
        "에이전트가 설정되어 있지 않습니다 (AGENT_URL / AGENT_TOKEN). " +
        "그 둘이 들어오면 이 대화창이 저절로 켜집니다.",
    };
  }
  return { ready: true, reason: null };
}

/** 에이전트에게 그대로 넘기고 그대로 돌려준다. 토큰은 이 함수 안에서만 산다. */
async function relay(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown; timeoutMs?: number },
): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), init.timeoutMs ?? TIMEOUT_MS);
  try {
    const res = await fetch(new URL(path, AGENT_URL), {
      method: init.method,
      headers: {
        authorization: `Bearer ${AGENT_TOKEN}`,
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
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

const bodySchema = z.object({
  message: z.string().trim().max(8000).default(""),
  /**
   * 화면이 함께 실어 보낼 수 있는 짧은 맥락.
   *
   * 지금은 화면이 아무것도 안 싣는다. 계약에 있는 칸이라 길만 내 두고 모양을
   * 짐작하지 않는다 — 여기서 객체로 정해 두고 저쪽이 문자열을 기다리고
   * 있으면 **모든 질문이 400 으로 돌아선다.** 에이전트는 `paperId` 와
   * paperbento 도구를 가지고 있어, 지금도 제목쯤은 스스로 찾아온다.
   */
  context: z.string().trim().max(2000).optional(),
});

/**
 * 지난 대화와 "지금 부를 수 있는가" 를 한 번에.
 *
 * 두 요청으로 가르지 않은 것은 대화창이 열릴 때 둘 다 필요하기 때문이다 —
 * 하나로 물으면 "칸을 켤지" 와 "무슨 말이 오갔는지" 가 늘 같은 순간의 값이다.
 * 닿지 못한 것도 `ready: false` 로 돌려준다. 켜 두고 보낼 때 실패하는 것은
 * 없느니만 못하다.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getPaperRow(id)) {
    return NextResponse.json({ error: "논문을 찾을 수 없습니다" }, { status: 404 });
  }

  const agent = readiness();
  const job = new URL(req.url).searchParams.get("job");

  if (job) {
    if (!agent.ready) return NextResponse.json({ error: agent.reason, agent }, { status: 503 });
    // 404 는 그대로 통과시킨다. 화면이 "작업이 사라졌다" 로 알아본다.
    return relay(`/paper/status?id=${encodeURIComponent(job)}`, {
      method: "GET",
      timeoutMs: 10_000,
    });
  }

  if (!agent.ready) return NextResponse.json({ turns: [], agent });

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 5000);
  try {
    const res = await fetch(
      new URL(`/paper/history?paperId=${encodeURIComponent(id)}`, AGENT_URL),
      { headers: { authorization: `Bearer ${AGENT_TOKEN}` }, signal: ctl.signal },
    );
    const text = await res.text();
    const json = (text ? JSON.parse(text) : {}) as { turns?: unknown };
    return NextResponse.json({
      turns: Array.isArray(json.turns) ? json.turns : [],
      agent,
    });
  } catch (e) {
    // 설정은 됐는데 안 떠 있다. 이유가 다르므로 문장도 다르다.
    return NextResponse.json({
      turns: [],
      agent: {
        ready: false,
        reason: `에이전트에 닿지 못했습니다: ${e instanceof Error ? e.message : String(e)}`,
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

/** 시작만 시키고 번호를 받는다. 끝은 `?job=` 으로 물어본다. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getPaperRow(id)) {
    return NextResponse.json({ error: "논문을 찾을 수 없습니다" }, { status: 404 });
  }
  const agent = readiness();
  if (!agent.ready) return NextResponse.json({ error: agent.reason, agent }, { status: 503 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  const { message, context } = parsed.data;
  if (!message) return NextResponse.json({ error: "보낼 것이 없습니다" }, { status: 400 });

  return relay("/paper", { method: "POST", body: { paperId: id, message, context } });
}

/**
 * 새 대화 — **이 논문 것만** 지운다.
 *
 * 서재 머리말의 채팅창이 쓰는 `/reset` 과 다른 길이다. 저쪽은 공용 세션이라
 * Discord 맥락까지 함께 날아간다. 논문 하나를 다시 시작하려고 그것까지
 * 잃을 이유가 없다.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agent = readiness();
  if (!agent.ready) return NextResponse.json({ error: agent.reason, agent }, { status: 503 });
  return relay("/paper/reset", { method: "POST", body: { paperId: id } });
}
