import { NextResponse } from "next/server";
import { z } from "zod";

import { logAgent } from "@/lib/agent-log";
import { ITEM_COLORS } from "@/lib/db/schema";
import {
  deleteNote,
  getPaperRow,
  listGroups,
  listNotes,
  updateNote,
} from "@/lib/paper-server";

import { anchorSchema } from "../anchor-schema";

/**
 * 메모 하나 고치기 / 지우기.
 *
 * 주소에 논문 id 가 함께 있으므로 **그 메모가 정말 이 논문의 것인지 확인한다.**
 * 서버 층의 `updateNote`/`deleteNote` 는 메모 id 만 보기 때문에, 여기서 안 보면
 * 남의 논문 메모를 이 논문 주소로 고칠 수 있다. 한 사람이 쓰는 앱이라 큰 사고는
 * 아니지만, 그러면 화면이 돌려받는 목록에 그 변경이 안 보여 "안 고쳐졌다" 로
 * 보인다.
 *
 * 메모는 휴지통에 넣지 않는다. 여백에 적는 한 줄이라 되살릴 값보다 목록이
 * 지저분해지는 값이 크다 — 휴지통이 메모로 가득 차면 정작 논문을 못 찾는다.
 */

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  body: z.string().max(10000).optional(),
  color: z.enum(ITEM_COLORS).nullable().optional(),
  /** 자리 옮기기. 판본을 갈아 끼운 뒤 다시 짚을 때 쓴다. */
  anchor: anchorSchema.optional(),
});

type Ctx = { params: Promise<{ id: string; noteId: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const { id, noteId } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid body" },
      { status: 400 },
    );
  }

  const mine = listNotes(id).find((n) => n.id === noteId);
  if (!mine) {
    return NextResponse.json({ error: "메모를 찾을 수 없습니다" }, { status: 404 });
  }

  try {
    updateNote(noteId, parsed.data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "수정 실패" },
      { status: 400 },
    );
  }

  logAgent(req, "메모 고치기", `${getPaperRow(id)?.title ?? id} / ${mine.page}쪽`, {
    ...(parsed.data.body === undefined ? {} : { body: parsed.data.body.slice(0, 200) }),
    ...(parsed.data.color === undefined ? {} : { color: parsed.data.color }),
    ...(parsed.data.anchor === undefined ? {} : { page: parsed.data.anchor.page }),
  });
  return NextResponse.json({ notes: listNotes(id) });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const { id, noteId } = await params;

  const mine = listNotes(id).find((n) => n.id === noteId);
  if (!mine) {
    return NextResponse.json({ error: "메모를 찾을 수 없습니다" }, { status: 404 });
  }

  deleteNote(noteId);
  logAgent(req, "메모 지우기", `${getPaperRow(id)?.title ?? id} / ${mine.page}쪽`, {
    body: mine.body.slice(0, 200),
  });
  // noteCount 가 줄어든다 — 목록도 함께 돌려줘야 카드의 숫자가 맞는다.
  return NextResponse.json({ notes: listNotes(id), groups: listGroups() });
}
