import { NextResponse } from "next/server";

import { findDuplicates } from "@/lib/paper-server";

/**
 * 같은 DOI·arXiv 번호를 가진 논문이 이미 있는지 미리 본다.
 *
 * `doi` 에 유일 제약을 걸지 않기로 한 대가다. 막지 않는 대신 **적는 자리에서**
 * 알려 준다 — 저장을 눌러 "제약 위반" 으로 죽는 것보다, 적는 동안 "이미 있다"
 * 를 보는 편이 사람이 손쓸 수 있다.
 *
 * `exceptId` 는 고치는 중인 논문 자신을 뺀다. 없으면 자기 DOI 를 자기가 겹친
 * 것으로 잡아 늘 경고가 뜬다.
 *
 * 이 경로는 `/api/papers/[id]` 보다 먼저 잡힌다 — Next 가 고정 조각을 동적
 * 조각보다 앞세우기 때문이라 `duplicates` 라는 id 가 있어도 부딪히지 않는다.
 */

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const papers = findDuplicates({
    doi: q.get("doi"),
    arxivId: q.get("arxivId"),
    exceptId: q.get("exceptId") ?? undefined,
  });
  return NextResponse.json({ papers });
}
