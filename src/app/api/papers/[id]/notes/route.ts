import { NextResponse } from "next/server";
import { z } from "zod";

import { logAgent } from "@/lib/agent-log";
import { ITEM_COLORS } from "@/lib/db/schema";
import {
  NotFoundError,
  createNote,
  getPaperRow,
  listGroups,
  listNotes,
} from "@/lib/paper-server";

import { anchorSchema } from "./anchor-schema";

/**
 * PDF 위 특정 자리에 붙는 메모.
 *
 * 목록은 읽는 순서대로 온다 (쪽 → 쪽 안에서는 위에서 아래). 화면의 메모
 * 사이드바가 그 순서를 그대로 쓴다.
 */

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getPaperRow(id)) {
    return NextResponse.json({ error: "논문을 찾을 수 없습니다" }, { status: 404 });
  }
  return NextResponse.json({ notes: listNotes(id) });
}

const createSchema = z.object({
  anchor: anchorSchema,
  /** 순수 글자다. 마크다운을 그리지 않는다 — 여백에 적는 한 줄이다. */
  body: z.string().max(10000).default(""),
  color: z.enum(ITEM_COLORS).nullable().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid body" },
      { status: 400 },
    );
  }

  const paper = getPaperRow(id);
  let noteId: string;
  try {
    noteId = createNote({
      paperId: id,
      anchor: parsed.data.anchor,
      body: parsed.data.body,
      color: parsed.data.color ?? null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "메모 추가 실패" },
      { status: e instanceof NotFoundError ? 404 : 400 },
    );
  }

  logAgent(req, "메모 추가", paper?.title ?? id, {
    page: parsed.data.anchor.page,
    body: parsed.data.body.slice(0, 200),
  });
  // 목록의 noteCount 가 달라지므로 groups 도 함께 돌려준다.
  return NextResponse.json({ notes: listNotes(id), noteId, groups: listGroups() });
}
