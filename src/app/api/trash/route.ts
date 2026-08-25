import { NextResponse } from "next/server";
import { z } from "zod";

import { logAgent } from "@/lib/agent-log";
import { listGroups } from "@/lib/paper-server";
import { RETENTION_DAYS, listTrash, purgeAll, purgeOne, restoreFromTrash } from "@/lib/trash";

/**
 * 휴지통 보기 / 되살리기 / 비우기.
 *
 * 목록을 읽을 때마다 30일 지난 것이 스스로 정리된다 (`listTrash` 안에서).
 * 따로 도는 청소 작업을 두지 않는 이유는, 이 앱이 대부분의 시간 동안 아무도
 * 안 보는 NAS 위에서 잠들어 있기 때문이다.
 *
 * 되살리기·비우기 응답에는 `groups` 를 함께 싣는다 — 되살리면 서가에 논문이
 * 돌아오고, 화면이 그걸 다시 물으러 갈 필요가 없어야 한다.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ trash: listTrash(), retentionDays: RETENTION_DAYS });
}

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("restore"), id: z.string().min(1) }),
  z.object({ action: z.literal("purge"), id: z.string().min(1) }),
  /** 통째로 비우기. 여기서 처음으로 PDF 가 디스크에서 실제로 사라진다. */
  z.object({ action: z.literal("empty") }),
]);

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const input = parsed.data;

  try {
    if (input.action === "empty") {
      const n = await purgeAll();
      logAgent(req, "휴지통 비우기", null, { count: n });
    } else {
      // 이름은 처리하기 전에 뜬다 — 끝나고 나면 기록에 적을 것이 남아 있지 않다.
      const label = listTrash().find((x) => x.id === input.id)?.label ?? input.id;
      if (input.action === "restore") {
        restoreFromTrash(input.id);
        logAgent(req, "휴지통에서 되살리기", label);
      } else {
        await purgeOne(input.id);
        logAgent(req, "영구 삭제", label);
      }
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "처리 실패" },
      { status: 400 },
    );
  }

  return NextResponse.json({
    trash: listTrash(),
    retentionDays: RETENTION_DAYS,
    groups: listGroups(),
  });
}
