import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { logAgent } from "@/lib/agent-log";
import { db, schema } from "@/lib/db";
import { contentTypeFor, extOf, kindOf } from "@/lib/file-kind";
import { removeStored, writeThumb } from "@/lib/file-store";
import { createPaper, getGroupRow, listGroups } from "@/lib/paper-server";
import type { FileDTO } from "@/lib/types";
import { discard, finalize, loadSession } from "@/lib/upload-session";
import { uid } from "@/lib/uid";

/**
 * 조각이 다 도착했으면 실제 파일로 확정하고 **논문 행을 만든다.**
 *
 * MemoBento 는 여기서 메모를 만들었다. 여기서는 논문이다 — 제목은 일단 파일
 * 이름에서 확장자를 뗀 것이 들어가고, 저자·학회·DOI 는 사람이 적거나 에이전트가
 * 채운다. 파일 이름이 곧 제목인 상태로 두지 않으려고 등록 시트가 뒤이어 뜬다.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  uploadId: z.string().min(1),
  /** 브라우저가 그린 첫 쪽 표지 (`data:image/webp;base64,…`). 없으면 나중에 붙인다. */
  thumb: z.string().optional(),
  /** 등록 시트에서 미리 적었다면. 비면 파일 이름이 제목이 된다. */
  title: z.string().trim().max(500).optional(),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const session = await loadSession(parsed.data.uploadId);
  if (!session) {
    return NextResponse.json({ error: "업로드 세션을 찾을 수 없습니다" }, { status: 404 });
  }

  // 브라우저가 경로째 보내는 경우가 있다 (폴더 드래그). 마지막 조각만 이름으로 쓴다.
  const name = (session.name || "untitled").split(/[\\/]/).pop() || "untitled";
  const ext = extOf(name);
  const kind = kindOf(name);
  const fileId = uid();

  let path: string;
  try {
    ({ path } = await finalize(session, fileId, ext));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "확정 실패" },
      { status: 400 },
    );
  }

  let thumbPath: string | null = null;
  if (parsed.data.thumb) {
    thumbPath = await writeThumb(fileId, parsed.data.thumb);
  }

  const groupId = session.groupId;
  // 확장자를 뗀 것이 제목이다. "attention_is_all_you_need.pdf" → 그대로 두면 흉하지만
  // 빈 제목보다는 낫고, 등록 시트와 에이전트가 곧 제대로 된 제목으로 바꾼다.
  const title = parsed.data.title || name.replace(/\.[^.]+$/, "") || "제목 없음";

  let paperId: string;
  try {
    db.insert(schema.files)
      .values({
        id: fileId,
        name,
        ext,
        mimeType: contentTypeFor(name),
        size: session.size,
        kind,
        path,
        thumbPath,
      })
      .run();

    paperId = createPaper({ groupId, title, fileId });
  } catch (e) {
    // 논문을 못 만들면 방금 놓은 파일도 지운다 (고아 방지)
    await removeStored(path, thumbPath);
    db.delete(schema.files).where(eq(schema.files.id, fileId)).run();
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "논문 생성 실패" },
      { status: 400 },
    );
  }

  /*
   * 파일 올리기도 에이전트가 하는 변경이다.
   *
   * MemoBento 에서는 여기만 기록에서 빠져 있었다. 그래서 에이전트가 올린 파일은
   * 활동 기록에 안 보이고, 화면이 "뭔가 바뀌었나" 를 물어도 안 바뀐 것으로 나왔다.
   */
  logAgent(req, "논문 올리기", title, {
    group: getGroupRow(groupId)?.name ?? groupId,
    file: name,
    size: session.size,
  });

  /*
   * 겹치는 논문을 여기서 알려 주지 않는다. 이 시점에 아는 것은 파일 이름뿐이고,
   * 같은 논문인지는 DOI·arXiv 번호를 적고 나서야 알 수 있다. 그 확인은 등록
   * 시트가 `/api/papers/duplicates` 로 따로 묻는다.
   *
   * `file` 을 함께 싣는 것은 뒤이어 뜨는 등록 시트를 위해서다. 방금 올린 것의
   * 크기·종류를 보여 주려고 `groups` 에서 논문을 다시 찾아 헤매지 않아도 된다.
   * **논문 행은 여기서 이미 만들어졌다** — 받는 쪽은 `paperId` 를 고쳐 쓸 일이지
   * 다시 만들 일이 아니다. 다시 만들면 같은 PDF 를 가리키는 논문이 둘이 된다.
   */
  return NextResponse.json({
    groups: listGroups(),
    paperId,
    fileId,
    file: {
      id: fileId,
      name,
      ext,
      mimeType: contentTypeFor(name),
      size: session.size,
      kind,
      hasThumb: thumbPath !== null,
    } satisfies FileDTO,
  });
}

/** 사용자가 취소한 업로드 정리. */
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (id) await discard(id);
  return NextResponse.json({ ok: true });
}
