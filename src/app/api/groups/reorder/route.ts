import { NextResponse } from "next/server";
import { z } from "zod";

import { logAgent } from "@/lib/agent-log";
import { listGroups, reorderGroups } from "@/lib/paper-server";

/**
 * 형제끼리 순서 바꾸기.
 *
 * 몸통은 `{ parentId, orderedIds }` — 순서만 통째로 보낸다. "이것을 저기 앞으로"
 * 같은 상대 지시를 주고받으면 화면과 서버가 서로 다른 기준을 갖게 되고, 드래그
 * 중에 다른 곳에서 목록이 바뀌면 엉뚱한 자리에 꽂힌다.
 *
 * 서버는 트랜잭션 안에서 position 을 0부터 다시 매긴다.
 */

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  /** `null` 이면 뿌리(서가)들끼리의 순서. */
  parentId: z.string().min(1).nullable(),
  orderedIds: z.array(z.string().min(1)),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  try {
    reorderGroups(parsed.data.parentId, parsed.data.orderedIds);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "정렬 실패" },
      { status: 400 },
    );
  }

  logAgent(req, "그룹 순서 바꾸기", parsed.data.parentId, {
    count: parsed.data.orderedIds.length,
  });
  return NextResponse.json({ groups: listGroups() });
}
