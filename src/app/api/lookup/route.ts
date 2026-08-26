import { NextResponse } from "next/server";

import { lookup } from "@/lib/lookup";

/**
 * 바깥에서 서지정보를 찾아온다. `?doi=` · `?arxiv=` · `?title=`
 *
 * 셋을 함께 보내도 된다. 순서대로 해 보고 첫 성공에서 멈춘다 (`lookup.ts`).
 * 시트의 "찾아오기" 단추는 세 칸을 한꺼번에 실어 보낸다 — 사람은 자기가 적어
 * 둔 것 중 무엇이 쓸모 있는지 모르고, 알 필요도 없다.
 *
 * 돌려주는 것은 `{ candidates, steps }` 다. **`steps` 를 빼면 안 된다.**
 * 후보가 하나도 없을 때 "찾지 못했습니다" 만 보이면 사람이 다음에 무엇을
 * 해야 할지 알 수 없다 — DOI 를 잘못 적은 것인지, 저쪽이 느려서 끊긴 것인지,
 * 등록기관이 CSL 을 안 주는 것인지가 전부 다른 이야기다.
 *
 * `logAgent` 를 부르지 않는다. 여기는 **아무것도 바꾸지 않고**, 활동 기록에
 * 한 줄이 늘면 화면이 그것을 "에이전트가 뭔가 바꿨다" 로 읽어 서재를 통째로
 * 다시 받아 온다 (`api.agentRev`). 읽기만 하는 요청이 화면을 새로 고치게
 * 만드는 것은 사고다.
 */

export const dynamic = "force-dynamic";

/** 한 번에 물을 수 있는 길이. 길면 저쪽이 어차피 414 로 거절한다. */
const MAX = 500;

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const doi = q.get("doi")?.slice(0, MAX) ?? null;
  const arxiv = q.get("arxiv")?.slice(0, MAX) ?? null;
  const title = q.get("title")?.slice(0, MAX) ?? null;

  if (!doi?.trim() && !arxiv?.trim() && !title?.trim()) {
    return NextResponse.json(
      { error: "doi · arxiv · title 중 하나는 있어야 합니다" },
      { status: 400 },
    );
  }

  try {
    const report = await lookup({ doi, arxiv, title });
    /*
     * 후보가 없어도 200 이다. 오류가 아니라 **결과가 빈 것**이고, 그 사정은
     * `steps` 에 담겨 있다. 404 로 주면 `readJson` 이 던지는 쪽으로 가서
     * 화면은 steps 를 구경도 못 한다.
     */
    return NextResponse.json(report, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    // 여기까지 오는 것은 우리 코드가 터진 경우다. 길마다의 실패는 steps 로 간다.
    console.error("[paperbento] lookup failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "찾아오기에 실패했습니다" },
      { status: 500 },
    );
  }
}
