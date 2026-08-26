import { NextResponse } from "next/server";

import { BODY_LIMITS, paperText } from "@/lib/pdf-text";
import { getPaperRow } from "@/lib/paper-server";

/**
 * 논문 PDF 에서 뽑아 낸 글자.
 *
 * MCP 서버(`mcp/src/index.ts` 의 `read_paper_text`)가 부르는 자리다. 뽑는 일
 * 자체는 `lib/pdf-text.ts` 가 하고 여기서는 그 결과를 그대로 내보낸다 —
 * 앱 안에서 쓰는 것과 밖으로 나가는 것이 갈라지면, 한쪽만 고친 날 서로 다른
 * 글을 보게 된다.
 *
 * ## 임의의 쪽을 열지 못한다
 *
 * `extractPdfText` 는 늘 1쪽부터 읽는다. "10쪽만" 같은 요청은 여기서 받을 수
 * 없고, 부르는 쪽이 `maxPages` 로 거기까지 훑은 뒤 `--- p.N ---` 표시로
 * 골라 낸다. 그래서 이 라우트의 계약은 **쪽 범위가 아니라 상한** 이다.
 *
 * ## `logAgent` 를 부르지 않는다
 *
 * 읽기만 하고 아무것도 바꾸지 않는다. 기록이 늘면 화면의 `api.agentRev`
 * 폴링이 "에이전트가 뭔가 바꿨다" 로 읽어 서재를 통째로 다시 받아 온다.
 * `/api/lookup` 이 같은 이유로 안 부른다.
 *
 * ## 여기 실려 나가는 것은 남이 만든 글이다
 *
 * 논문 PDF 는 남이 만든 파일이고, 그 안의 문장은 자료지 지시가 아니다.
 * 울타리(`fenceUntrusted`)는 모델에게 넘기는 자리에서 두른다 — 이 라우트는
 * 사람이 읽을 수도 있는 원문 그대로를 낸다.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 한 번에 내보낼 상한. 요약용 상한(14쪽·40000자)보다 넉넉히 두되 무한은 아니다. */
const MAX_PAGES = 60;
const MAX_CHARS = 120_000;

function clampInt(raw: string | null, fallback: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), max);
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getPaperRow(id)) {
    return NextResponse.json({ error: "논문을 찾을 수 없습니다" }, { status: 404 });
  }

  const q = new URL(req.url).searchParams;
  const maxPages = clampInt(q.get("maxPages"), BODY_LIMITS.maxPages, MAX_PAGES);
  const maxChars = clampInt(q.get("maxChars"), BODY_LIMITS.maxChars, MAX_CHARS);

  /*
   * 글자층이 없어도 200 이다.
   *
   * `hasText:false` 와 사람이 읽을 `reason` 이 실려 온다. 이걸 4xx 로 만들면
   * 부르는 쪽에서 "라우트가 없다" 와 "스캔본이다" 가 섞인다 — MCP 도구는
   * 404 를 "PaperBento 가 낡았다" 로 읽는다.
   */
  return NextResponse.json(await paperText(id, { maxPages, maxChars }));
}
