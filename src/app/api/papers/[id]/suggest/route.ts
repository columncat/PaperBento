import { NextResponse } from "next/server";
import { z } from "zod";

import { logAgent } from "@/lib/agent-log";
import { getPaperRow } from "@/lib/paper-server";
import {
  advance,
  latestSuggestion,
  markApplied,
  readSuggestion,
  startBiblio,
} from "@/lib/suggest";

/**
 * 에이전트가 낸 서지정보 **제안**.
 *
 * ## 여기서 논문이 바뀌지 않는다
 *
 * 이 라우트가 하는 일은 제안을 만들고, 보여 주고, "적용했다" 고 표시하는 것뿐
 * 이다. `papers` 를 쓰는 코드가 한 줄도 없다. 논문이 바뀌는 것은 사람이 화면에서
 * 값을 확인하고 누른 뒤 평소의 `PATCH /api/papers/:id` 로 가는 그 요청이다.
 *
 * **일부러 두 요청으로 갈라 두었다.** 하나로 묶으면 "제안 적용" 이라는 이름의
 * 논문 쓰기 API 가 생기고, 그러면 언젠가 누군가 그걸 에이전트에게 열어 준다.
 * 그 순간 논문 PDF 안에 심어진 문장이 곧 DB 쓰기가 된다. 갈라 두면 그럴 자리가
 * 애초에 없다.
 *
 * ## 오래 걸리는 일이라 시작과 끝이 다른 요청이다
 *
 * POST 로 시작만 시키고 번호를 받는다. GET 으로 몇 초마다 물어본다. 답을
 * 기다리며 요청을 붙들면 앞의 Cloudflare 터널이 100초에서 끊는다 — MemoBento
 * 채팅창이 그렇게 겪었고, 화면에는 "failed to fetch" 만 떴다.
 *
 * **GET 이 진행을 민다.** 순수한 읽기가 아닌 것은 알고 쓴다. 서버 타이머에만
 * 맡기면 프로세스가 다시 뜰 때 진행 중이던 것이 영영 `running` 으로 남는다.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const postSchema = z.object({
  kind: z.literal("biblio").default("biblio"),
});

const patchSchema = z.object({
  /** 사람이 적용을 누른 제안. 이 표시는 논문을 바꾸지 않는다. */
  id: z.string().min(1).max(64),
  applied: z.literal(true),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const paper = getPaperRow(id);
  if (!paper) {
    return NextResponse.json({ error: "논문을 찾을 수 없습니다" }, { status: 404 });
  }

  const parsed = postSchema.safeParse((await req.json().catch(() => null)) ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const suggestion = await startBiblio(id);
  logAgent(req, "서지정보 제안 요청", paper.title, { suggestionId: suggestion.id });

  /*
   * 시작 자리에서 이미 실패했으면 그대로 알린다 (스캔본이라 글자가 없거나,
   * 에이전트에 닿지 못했거나). 202 로 돌려주고 폴링하게 두면 사람은 몇 초를
   * 기다린 뒤에야 같은 소식을 듣는다.
   */
  return NextResponse.json({ suggestion }, { status: suggestion.state === "failed" ? 502 : 202 });
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getPaperRow(id)) {
    return NextResponse.json({ error: "논문을 찾을 수 없습니다" }, { status: 404 });
  }

  const wanted = new URL(req.url).searchParams.get("id");
  const row = wanted ? readSuggestion(wanted) : latestSuggestion(id, "biblio");
  if (!row) return NextResponse.json({ suggestion: null });
  // 남의 논문 제안을 번호만 알면 읽을 수 있게 두지 않는다.
  if (row.paperId !== id) return NextResponse.json({ suggestion: null });

  // 아직 도는 중이면 한 걸음 민다. 이 요청이 진행의 주된 힘이다.
  const fresh = row.state === "running" ? ((await advance(row.id)) ?? row) : row;
  return NextResponse.json({ suggestion: fresh });
}

/**
 * "이 제안을 봤고 적용했다" 는 표시.
 *
 * 논문을 바꾸는 것은 이 요청이 아니다. 화면은 먼저 `PATCH /api/papers/:id` 로
 * 사람이 확인한 값을 저장하고, 그다음에 여기로 표시만 남긴다. 순서가 그래야
 * 저장이 실패했는데 "적용됨" 으로 남는 일이 없다.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const paper = getPaperRow(id);
  if (!paper) {
    return NextResponse.json({ error: "논문을 찾을 수 없습니다" }, { status: 404 });
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const row = readSuggestion(parsed.data.id);
  if (!row || row.paperId !== id) {
    return NextResponse.json({ error: "제안을 찾을 수 없습니다" }, { status: 404 });
  }

  markApplied(row.id);
  logAgent(req, "서지정보 제안 적용 표시", paper.title, { suggestionId: row.id });
  return NextResponse.json({ suggestion: readSuggestion(row.id) });
}
