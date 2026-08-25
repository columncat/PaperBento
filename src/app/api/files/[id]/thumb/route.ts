import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { logAgent } from "@/lib/agent-log";
import { db, schema } from "@/lib/db";
import { openStored, removeStored, writeThumb } from "@/lib/file-store";
import { listGroups } from "@/lib/paper-server";

/**
 * 표지 그림.
 *
 * PDF 는 `<img>` 에 그대로 물릴 수 없어서, 서재의 표지는 **브라우저가 첫 쪽을
 * 그려 만든 것**이다. 서버에 이미지 디코더(sharp 등)를 들이지 않으려는 선택이고,
 * 그래서 여기로는 `data:image/webp;base64,…` 꼴의 데이터 URL 이 온다.
 *
 * POST 가 따로 있는 이유: 업로드가 끝나는 순간에는 아직 표지가 없을 수 있다.
 * 큰 PDF 는 첫 쪽을 그리는 데 시간이 걸리고, 밖에서(에이전트·다른 앱) 들어온
 * 파일은 애초에 아무도 그려 주지 않았다. 그럴 때 화면이 나중에 그려 붙인다.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = db.select().from(schema.files).where(eq(schema.files.id, id)).get();
  if (!row?.thumbPath) {
    return NextResponse.json({ error: "표지 없음" }, { status: 404 });
  }

  const opened = await openStored(row.thumbPath);
  if (!opened) {
    return NextResponse.json({ error: "표지 없음" }, { status: 404 });
  }

  const ext = row.thumbPath.split(".").pop()?.toLowerCase();
  const type = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "png" ? "image/png" : "image/webp";

  return new Response(opened.body, {
    headers: {
      "Content-Type": type,
      "Content-Length": String(opened.size),
      "Content-Security-Policy": "sandbox",
      "X-Content-Type-Options": "nosniff",
      /*
       * 표지는 파일당 하나뿐이고 주소도 하나다. 그런데 오래 캐시해 두면
       * 나중에 다시 그려 올린 표지가 안 보인다. 그래서 새로 붙일 때 아래
       * POST 가 옛 파일을 지우고 **다른 이름**으로 쓰는 것이 아니라, 같은
       * 이름을 덮어쓴다 — 대신 캐시를 짧게 잡아 다음 새로고침에 바뀌게 한다.
       */
      "Cache-Control": "private, max-age=60",
    },
  });
}

const postSchema = z.object({
  /** `data:image/webp;base64,…`. 접두어까지 통째로 준다 — 서버가 종류를 여기서 읽는다. */
  thumb: z.string().min(1),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const row = db.select().from(schema.files).where(eq(schema.files.id, id)).get();
  if (!row) {
    return NextResponse.json({ error: "파일이 없습니다" }, { status: 404 });
  }

  const thumbPath = await writeThumb(id, parsed.data.thumb);
  if (!thumbPath) {
    // 데이터 URL 이 아니었거나 크기가 말이 안 된다. 조용히 넘기지 않는다 —
    // 그러면 화면은 올렸다고 믿고 서버에는 아무것도 없는 상태가 된다.
    return NextResponse.json(
      { error: "표지 데이터를 읽지 못했습니다 (data:image/…;base64, 형식이어야 합니다)" },
      { status: 400 },
    );
  }

  // 종류가 달라지면 파일 이름도 달라진다. 옛것을 지우지 않으면 쓰레기가 쌓인다.
  if (row.thumbPath && row.thumbPath !== thumbPath) {
    await removeStored(row.thumbPath);
  }

  db.update(schema.files).set({ thumbPath }).where(eq(schema.files.id, id)).run();

  logAgent(req, "표지 붙이기", row.name);
  // FileDTO.hasThumb 가 달라진다 — 목록을 함께 돌려줘야 카드가 아이콘에서 표지로 바뀐다.
  return NextResponse.json({ ok: true, hasThumb: true, groups: listGroups() });
}
