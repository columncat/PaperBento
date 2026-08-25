import { NextResponse } from "next/server";
import { z } from "zod";

import { logAgent } from "@/lib/agent-log";
import { ITEM_COLORS, VIEW_MODES } from "@/lib/db/schema";
import {
  LockedError,
  NotFoundError,
  TooDeepError,
  getGroupRow,
  groupContents,
  listGroups,
  updateGroup,
} from "@/lib/paper-server";
import { trashGroup } from "@/lib/trash";

/**
 * 서가 하나 고치기 / 지우기.
 *
 * 지우기는 **휴지통으로 보내는 것**이다. 하위 그룹과 논문이 함께 딸려 가고,
 * 30일 안에는 통째로 되살릴 수 있다 (`lib/trash.ts`).
 */

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().max(2000).nullable().optional(),
  /** 팔레트 밖의 값은 거절한다 — 그대로 CSS 변수 이름이 되기 때문이다. */
  color: z.enum(ITEM_COLORS).nullable().optional(),
  viewMode: z.enum(VIEW_MODES).optional(),
  collapsed: z.boolean().optional(),
  /** 옮기기. `null` 이면 뿌리로 꺼낸다. 세 단이 되려 하면 서버가 거절한다. */
  parentId: z.string().min(1).nullable().optional(),
});

/** 오류를 사람이 읽을 상태 코드로. 잠긴 것과 잘못 짚은 것은 구별되어야 한다. */
function statusOf(e: unknown): number {
  if (e instanceof LockedError) return 403;
  if (e instanceof NotFoundError) return 404;
  if (e instanceof TooDeepError) return 409;
  return 400;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  // 이름은 고치기 전에 뜬다. 기록에 남길 것은 "무엇을" 고쳤는지이지 결과가 아니다.
  const before = getGroupRow(id);
  try {
    updateGroup(id, parsed.data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "수정 실패" },
      { status: statusOf(e) },
    );
  }

  logAgent(req, "그룹 고치기", before?.name ?? id, parsed.data);
  return NextResponse.json({ groups: listGroups() });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const before = getGroupRow(id);
  if (!before) {
    return NextResponse.json({ error: "그룹을 찾을 수 없습니다" }, { status: 404 });
  }
  // 딸려 갈 것의 수도 지우기 전에 센다. 지운 뒤에는 셀 것이 남아 있지 않다.
  const contents = groupContents(id);

  try {
    trashGroup(id);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "삭제 실패" },
      { status: before.systemKey ? 403 : 400 },
    );
  }

  logAgent(req, "그룹 지우기 (휴지통)", before.name, contents);
  return NextResponse.json({ groups: listGroups() });
}
