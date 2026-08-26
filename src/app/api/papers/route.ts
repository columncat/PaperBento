import { NextResponse } from "next/server";
import { z } from "zod";

import { logAgent } from "@/lib/agent-log";
import { createPaper, findDuplicates, getGroupRow, listGroups } from "@/lib/paper-server";

/**
 * 논문 만들기 (서지정보만 먼저 적어 두는 길).
 *
 * 파일을 올려 만드는 길은 `/api/upload/finish` 쪽이다. 여기는 PDF 없이 제목과
 * DOI 만 먼저 적어 두는 경우 — 읽을 것을 적어 두고 파일은 나중에 붙인다.
 *
 * GET 도 `{ groups }` 를 돌려준다. 논문은 늘 그룹 안에 담겨 내려가므로 따로
 * 평평한 목록을 만들면 같은 자료의 모양이 두 벌이 된다.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ groups: listGroups() });
}

const createSchema = z.object({
  groupId: z.string().min(1),
  title: z.string().trim().max(500).default(""),
  fileId: z.string().min(1).nullable().optional(),
  authors: z.string().max(2000).nullable().optional(),
  venue: z.string().max(500).nullable().optional(),
  year: z.number().int().min(1000).max(3000).nullable().optional(),
  doi: z.string().max(300).nullable().optional(),
  arxivId: z.string().max(100).nullable().optional(),
  abstract: z.string().max(20000).nullable().optional(),
  tags: z.string().max(1000).nullable().optional(),
  url: z.string().max(2000).nullable().optional(),
  /**
   * 받아 온 서지정보 원본 (CSL-JSON 문자열).
   *
   * **여기 없으면 zod 가 조용히 버린다.** `z.object` 는 모르는 칸을 오류로
   * 만들지 않고 그냥 떼어 내므로, 시트가 잘 보내도 서버까지 닿지 않는다.
   * 초록보다 넉넉히 잡는다 — 참고문헌을 걷어냈어도 저자 수십 명짜리가 있다.
   */
  csl: z.string().max(100000).nullable().optional(),
});

export async function POST(req: Request) {
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid body" },
      { status: 400 },
    );
  }

  let paperId: string;
  try {
    paperId = createPaper(parsed.data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "논문 추가 실패" },
      { status: 400 },
    );
  }

  logAgent(req, "논문 추가", parsed.data.title || "제목 없음", {
    group: getGroupRow(parsed.data.groupId)?.name ?? parsed.data.groupId,
    doi: parsed.data.doi ?? null,
  });

  /*
   * 겹치는 것이 있으면 알려만 준다. 막지 않는다.
   *
   * 같은 논문을 두 서가에 두고 싶은 날이 오고, 에이전트가 틀린 DOI 를 제안하는
   * 날도 온다. 그때 저장이 "제약 위반" 으로 죽으면 사람이 손쓸 자리가 없다.
   */
  return NextResponse.json({
    groups: listGroups(),
    paperId,
    duplicates: findDuplicates({
      doi: parsed.data.doi ?? null,
      arxivId: parsed.data.arxivId ?? null,
      exceptId: paperId,
    }),
  });
}
