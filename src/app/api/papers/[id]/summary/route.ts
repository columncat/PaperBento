import { NextResponse } from "next/server";
import { z } from "zod";

import { logAgent } from "@/lib/agent-log";
import {
  NotFoundError,
  deleteSummary,
  getPaperRow,
  getSummary,
  listGroups,
  setSummary,
} from "@/lib/paper-server";

/**
 * 논문당 요약 하나. 마크다운.
 *
 * 본문은 목록(`{ groups }`)에 실리지 않는다 — 서재 한 화면에 논문 수백 편이
 * 오는데 거기 요약까지 실으면 목록이 통째로 무거워진다. 목록은 "있는가" 만
 * 알고, 본문은 이 라우트로 따로 받는다.
 *
 * 그래도 쓰기 응답에는 `groups` 를 함께 싣는다. 요약이 생기거나 사라지면
 * 목록의 `hasSummary` 가 달라지기 때문이다. 안 실으면 방금 요약을 붙인 논문
 * 카드에 표식이 안 뜨고, 사람은 저장이 안 된 줄 안다.
 */

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getPaperRow(id)) {
    return NextResponse.json({ error: "논문을 찾을 수 없습니다" }, { status: 404 });
  }
  return NextResponse.json({ summary: getSummary(id) });
}

const putSchema = z.object({
  body: z.string().max(200000),
  /**
   * 누가 쓴 글인가. 기본은 사람이다.
   *
   * 사람이 손보면 그때부터 사람의 글이고, 다음에 에이전트가 다시 만들 때
   * 덮어써도 되는지 물어야 한다. 그래서 이 값이 화면에 보여야 한다.
   */
  source: z.enum(["human", "agent"]).optional(),
  /** 에이전트가 만들었다면 그때 쓴 지시문. "왜 이렇게 나왔지" 를 되짚는 자리. */
  instruction: z.string().max(4000).nullable().optional(),
});

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const paper = getPaperRow(id);
  try {
    setSummary(id, parsed.data.body, {
      source: parsed.data.source,
      instruction: parsed.data.instruction,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "요약 저장 실패" },
      { status: e instanceof NotFoundError ? 404 : 400 },
    );
  }

  // 본문 전체가 아니라 길이만 기록한다. 기록은 자료를 다시 담는 자리가 아니다.
  logAgent(req, "요약 저장", paper?.title ?? id, {
    source: parsed.data.source ?? "human",
    length: parsed.data.body.length,
    instruction: parsed.data.instruction ?? null,
  });
  return NextResponse.json({ summary: getSummary(id), groups: listGroups() });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const paper = getPaperRow(id);
  if (!paper) {
    return NextResponse.json({ error: "논문을 찾을 수 없습니다" }, { status: 404 });
  }

  deleteSummary(id);
  logAgent(req, "요약 지우기", paper.title);
  return NextResponse.json({ summary: null, groups: listGroups() });
}
