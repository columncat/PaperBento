import { NextResponse } from "next/server";
import { z } from "zod";

import { logAgent } from "@/lib/agent-log";
import { createGroup, listGroups } from "@/lib/paper-server";

/**
 * 서가(그룹) 목록과 만들기.
 *
 * 변경이 끝나면 갱신된 목록 **전체**를 함께 돌려준다. 화면이 다시 조회하지
 * 않게 하려는 것이고, 그래야 "고쳤는데 화면은 옛것" 인 구간이 아예 없다.
 * 봉투는 `{ groups }` 하나로 통일한다 — 라우트마다 이름이 다르면 받는 쪽에
 * 갈래가 생긴다.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ groups: listGroups() });
}

const createSchema = z.object({
  name: z.string().trim().min(1, "이름을 입력하세요").max(80),
  /** 있으면 하위 그룹. 두 단까지라 부모가 이미 하위면 서버가 거절한다. */
  parentId: z.string().min(1).nullable().optional(),
});

export async function POST(req: Request) {
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid body" },
      { status: 400 },
    );
  }

  try {
    createGroup({ name: parsed.data.name, parentId: parsed.data.parentId ?? null });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "그룹 만들기 실패" },
      { status: 400 },
    );
  }

  logAgent(req, "그룹 만들기", parsed.data.name, { parentId: parsed.data.parentId ?? null });
  return NextResponse.json({ groups: listGroups() });
}
