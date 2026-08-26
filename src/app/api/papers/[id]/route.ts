import { NextResponse } from "next/server";
import { z } from "zod";

import { logAgent } from "@/lib/agent-log";
import { PAPER_MARKS, READ_STATES } from "@/lib/db/schema";
import {
  NotFoundError,
  getGroupRow,
  getPaperRow,
  listGroups,
  updatePaper,
} from "@/lib/paper-server";
import { trashPaper } from "@/lib/trash";

/**
 * 논문 하나 고치기 / 지우기.
 *
 * 지우기는 휴지통으로 보낸다. PDF 는 만료 전까지 디스크에 그대로 남는다 —
 * 잘못 지웠을 때 사람이 파일을 다시 구해 오는 일이 없어야 한다.
 */

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  title: z.string().max(500).optional(),
  authors: z.string().max(2000).nullable().optional(),
  venue: z.string().max(500).nullable().optional(),
  year: z.number().int().min(1000).max(3000).nullable().optional(),
  doi: z.string().max(300).nullable().optional(),
  arxivId: z.string().max(100).nullable().optional(),
  abstract: z.string().max(20000).nullable().optional(),
  tags: z.string().max(1000).nullable().optional(),
  url: z.string().max(2000).nullable().optional(),
  readState: z.enum(READ_STATES).optional(),
  /** 팔레트 밖의 값은 거절한다 — 그대로 아이콘 이름이 된다. */
  mark: z.enum(PAPER_MARKS).nullable().optional(),
  /** 본체 PDF 갈아 끼우기 / 떼기. */
  fileId: z.string().min(1).nullable().optional(),
  /** 다른 그룹으로 옮기기. */
  groupId: z.string().min(1).optional(),
  /**
   * PDF 에서 뽑아 둔 앞부분 글자. 화면이 한 번 뽑아 서버에 맡긴다.
   *
   * 에이전트에게 넘길 재료라 목록 DTO 로는 내려가지 않는다. 서지정보와 요약을
   * 잇달아 부를 때 같은 PDF 를 두 번 뜯지 않으려고 캐시하는 것이다.
   */
  headText: z.string().max(200000).nullable().optional(),
  /**
   * 받아 온 서지정보 원본 (CSL-JSON 문자열).
   *
   * **여기 없으면 zod 가 조용히 버린다.** `z.object` 는 모르는 칸을 오류로
   * 만들지 않고 그냥 떼어 내므로, 시트가 잘 보내도 서버까지 닿지 않는다.
   *
   * 안 실려 오면 손대지 않고, `null` 이 실려 오면 그때는 진짜로 뗀다
   * (`updatePaper` 가 `undefined` 와 `null` 을 가른다). 이 구분이 없으면
   * 제목만 고쳐 저장할 때마다 원본이 지워진다.
   */
  csl: z.string().max(100000).nullable().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const before = getPaperRow(id);
  try {
    updatePaper(id, parsed.data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "수정 실패" },
      { status: e instanceof NotFoundError ? 404 : 400 },
    );
  }

  /*
   * 기록에는 `headText` 를 싣지 않는다.
   *
   * 논문 앞부분 수천 자가 통째로 활동 기록에 쌓인다. 기록은 "무엇을 했는가" 를
   * 보는 자리이지 자료를 다시 담는 자리가 아니다.
   */
  const { headText, csl, ...loggable } = parsed.data;
  logAgent(req, "논문 고치기", before?.title ?? id, {
    ...loggable,
    ...(headText === undefined ? {} : { headText: headText === null ? null : `${headText.length}자` }),
    // csl 도 같은 이유로 통째로 싣지 않는다 — 한 편에 1~2KB 라 기록이 자료
    // 보관소가 되어 버린다. 붙었는지 떼었는지만 남긴다.
    ...(csl === undefined ? {} : { csl: csl === null ? null : `CSL ${csl.length}자` }),
  });
  return NextResponse.json({ groups: listGroups() });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const before = getPaperRow(id);
  if (!before) {
    return NextResponse.json({ error: "논문을 찾을 수 없습니다" }, { status: 404 });
  }

  try {
    trashPaper(id);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "삭제 실패" },
      { status: 400 },
    );
  }

  logAgent(req, "논문 지우기 (휴지통)", before.title, {
    group: getGroupRow(before.groupId)?.name ?? before.groupId,
  });
  return NextResponse.json({ groups: listGroups() });
}
