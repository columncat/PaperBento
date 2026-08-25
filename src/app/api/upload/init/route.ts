import { NextResponse } from "next/server";
import { z } from "zod";

import { env } from "@/lib/env";
import { getGroupRow } from "@/lib/paper-server";
import { PLAIN_CHUNK, createSession } from "@/lib/upload-session";

/**
 * 청크 업로드 시작 — 조각을 받을 자리를 잡고 uploadId 를 돌려준다.
 *
 * 논문 PDF 는 수백 MB 가 예사다. 한 번에 받으면 본문 전체가 메모리에 올라가
 * NAS(RAM 3.7GB)가 죽는다. 그래서 브라우저가 조각내 보내고 서버는 정해진
 * 오프셋에 그대로 써 넣기만 한다.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  groupId: z.string().min(1),
  name: z.string().min(1).max(400),
  size: z.number().int().nonnegative(),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { groupId, name, size } = parsed.data;

  // 올릴 자리가 있는지 먼저 본다. 다 받고 나서 "그룹이 없다" 를 말하면
  // 수백 MB 를 헛되이 주고받은 뒤가 된다.
  if (!getGroupRow(groupId)) {
    return NextResponse.json({ error: "그룹을 찾을 수 없습니다" }, { status: 400 });
  }

  const limit = env.MAX_UPLOAD_MB * 1024 * 1024;
  if (size > limit) {
    return NextResponse.json(
      { error: `파일이 너무 큽니다 (최대 ${env.MAX_UPLOAD_MB}MB)` },
      { status: 413 },
    );
  }

  const session = await createSession({ groupId, name, size });
  return NextResponse.json({
    uploadId: session.id,
    chunkSize: PLAIN_CHUNK,
    chunks: size === 0 ? 0 : Math.ceil(size / PLAIN_CHUNK),
  });
}
