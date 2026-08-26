import { NextResponse } from "next/server";
import { z } from "zod";

import { logAgent } from "@/lib/agent-log";
import { getPaperRow, getSummary, listGroups } from "@/lib/paper-server";
import { advance, latestSuggestion, readSuggestion, startSummary } from "@/lib/suggest";

/**
 * 에이전트에게 요약을 맡긴다.
 *
 * ## 지시문은 매번 실려 온다
 *
 * 서버가 기본 지시문을 들고 있지 않다. 프리셋은 `app_config.summaryPresets` 에
 * 있고 **화면이 골라서 보낸다.** 그래야 사람이 무엇을 시켰는지가 화면에 보이는
 * 그대로가 되고, "이 요청만 고치기" 가 성립한다. 서버가 몰래 덧붙이면 화면에
 * 보이는 지시문과 실제로 간 지시문이 갈라진다.
 *
 * 만든 요약은 `paper_summaries` 에 `source: "agent"` 와 지시문을 함께 넣는다.
 * 나중에 "왜 이렇게 나왔지" 를 되짚는 자리이고, 사람이 손보면 그때부터 사람의
 * 글이 된다.
 *
 * ## 덮어쓰기는 화면에서 확인받는다
 *
 * 이미 사람이 쓴 요약이 있으면 덮기 전에 물어야 한다. 여기까지 온 요청은 이미
 * 사람이 마음먹은 것으로 본다 — 다만 실수로 지나칠 수 없게 `overwrite` 를
 * 명시하게 한다. 사람이 쓴 요약이 있는데 그 값이 없으면 409 로 되돌려 보낸다.
 *
 * ## 진행
 *
 * POST 로 시작만 시키고 GET 으로 물어본다. 이유는 suggest 라우트와 같다 —
 * 앞의 터널이 100초에서 끊는다.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const postSchema = z.object({
  /** 이번에 쓸 지시문. 프리셋을 그대로 보내든 손본 것을 보내든 여기 실린다. */
  instruction: z.string().trim().min(1).max(4000),
  /** 사람이 쓴 요약을 덮어써도 좋다고 확인했는가. */
  overwrite: z.boolean().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const paper = getPaperRow(id);
  if (!paper) {
    return NextResponse.json({ error: "논문을 찾을 수 없습니다" }, { status: 404 });
  }

  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "지시문이 필요합니다" }, { status: 400 });
  }

  /*
   * 사람이 쓴 글을 말없이 지우지 않는다.
   *
   * 에이전트가 만든 요약을 다시 만드는 것은 잃을 것이 없다 — 같은 자리에서
   * 같은 재료로 다시 만드는 것이고, 지시문도 함께 남는다. 사람이 손으로 적은
   * 글은 다르다. 그건 다시 만들 수 없다.
   */
  const existing = getSummary(id);
  if (existing?.source === "human" && existing.body.trim() && !parsed.data.overwrite) {
    return NextResponse.json(
      {
        error: "이미 직접 쓰신 요약이 있습니다. 덮어써도 될지 먼저 확인해 주세요",
        code: "needs-overwrite",
      },
      { status: 409 },
    );
  }

  const suggestion = await startSummary(id, parsed.data.instruction);
  // 지시문 전문이 아니라 길이만? — 아니다. 지시문은 **사람이 쓴 것**이고,
  // 나중에 결과를 되짚으려면 무엇을 시켰는지가 그대로 남아 있어야 한다.
  logAgent(req, "요약 만들기 요청", paper.title, {
    suggestionId: suggestion.id,
    instruction: parsed.data.instruction,
    overwrote: existing?.source === "human",
  });

  return NextResponse.json(
    { run: suggestion, summary: getSummary(id) },
    { status: suggestion.state === "failed" ? 502 : 202 },
  );
}

/**
 * 도는 중인 요약을 물어본다.
 *
 * 끝났으면 `summary` 에 완성된 요약이, `groups` 에 갱신된 서재가 실린다.
 * 요약이 생기면 목록의 `hasSummary` 가 달라지는데, 그걸 안 실으면 서재로
 * 돌아갔을 때 표식이 안 떠서 사람은 저장이 안 된 줄 안다.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getPaperRow(id)) {
    return NextResponse.json({ error: "논문을 찾을 수 없습니다" }, { status: 404 });
  }

  const wanted = new URL(req.url).searchParams.get("id");
  const row = wanted ? readSuggestion(wanted) : latestSuggestion(id, "summary");
  if (!row || row.paperId !== id) {
    return NextResponse.json({ run: null, summary: getSummary(id) });
  }

  const fresh = row.state === "running" ? ((await advance(row.id)) ?? row) : row;
  return NextResponse.json({
    run: fresh,
    summary: getSummary(id),
    ...(fresh.state === "done" ? { groups: listGroups() } : {}),
  });
}
