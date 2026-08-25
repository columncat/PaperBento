import { NextResponse } from "next/server";

import { PLAIN_CHUNK, currentSize, loadSession, writeChunk } from "@/lib/upload-session";

/**
 * 조각 하나 받기.
 *
 * 조각 크기가 고정이라 정해진 오프셋에 쓴다 — 순서가 뒤바뀌거나 재시도해도
 * 같은 결과가 된다. 그래서 브라우저가 끊긴 자리부터 다시 보내도 된다.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PUT(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  const index = Number(url.searchParams.get("index"));

  if (!id || !Number.isInteger(index) || index < 0) {
    return NextResponse.json({ error: "invalid params" }, { status: 400 });
  }

  const session = await loadSession(id);
  if (!session) {
    return NextResponse.json(
      { error: "업로드 세션을 찾을 수 없습니다 (만료되었을 수 있음)" },
      { status: 404 },
    );
  }

  const buf = new Uint8Array(await req.arrayBuffer());
  if (buf.byteLength === 0 || buf.byteLength > PLAIN_CHUNK) {
    return NextResponse.json(
      { error: `조각 크기가 잘못되었습니다 (${buf.byteLength} bytes)` },
      { status: 400 },
    );
  }

  await writeChunk(session, index, buf);
  return NextResponse.json({ ok: true, received: await currentSize(id) });
}
