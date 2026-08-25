import { NextResponse } from "next/server";
import { z } from "zod";

import { logAgent } from "@/lib/agent-log";
import { listGroups, reorderPapers } from "@/lib/paper-server";

/**
 * 한 그룹 안에서 논문 순서 바꾸기.
 *
 * 그룹 순서와 같은 모양이다 — `{ groupId, orderedIds }` 로 순서를 통째로 보내고
 * 서버가 트랜잭션 안에서 position 을 다시 매긴다. 남의 그룹 id 를 끼워 넣어도
 * 서버가 걸러 낸다.
 */

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  groupId: z.string().min(1),
  orderedIds: z.array(z.string().min(1)),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  try {
    reorderPapers(parsed.data.groupId, parsed.data.orderedIds);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "정렬 실패" },
      { status: 400 },
    );
  }

  logAgent(req, "논문 순서 바꾸기", parsed.data.groupId, {
    count: parsed.data.orderedIds.length,
  });
  return NextResponse.json({ groups: listGroups() });
}
