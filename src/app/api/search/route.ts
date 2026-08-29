import { NextResponse } from "next/server";

import { clipQuery } from "@/lib/client-api";
import { searchPapers } from "@/lib/search";

/**
 * 서재 찾기 — `?q=` 하나로 열한 자리를 다 본다.
 *
 * 제목·저자·학회·연도·DOI·arXiv·태그·초록·요약 본문·메모 본문·PDF 앞부분.
 * 앞의 여덟은 `/api/groups` 가 이미 브라우저에 내려보낸 칸이라 화면이 그
 * 자리에서도 거르지만, **판정의 주인은 여기다** — 낱말 하나는 열한 자리 중
 * 어디에 있어도 되고 낱말끼리는 전부여야 한다. 그 AND 를 한 곳에서 안 따지면
 * 제목에만 있는 낱말과 메모에만 있는 낱말을 함께 친 질의가 0건이 된다.
 *
 * **`q` 는 사람이 친 그대로 온다.** 대소문자를 접고 NFC 로 맞추는 것은
 * `search.ts` 의 몫이고, 그것도 화면과 **같은 함수**로 한다
 * (`filter-papers.ts` 의 `normalizeForSearch`). 화면이 미리 눕혀 보내면 서버는
 * 사람이 친 표기를 영영 못 보게 되고, 두 곳에서 따로 접으면 규칙이 갈려
 * 즉시 뜬 줄이 이 답을 받고 사라진다. 여기서 `q` 에 손대는 것은 길이뿐이다.
 *
 * `logAgent` 를 부르지 않는다. `/api/lookup` 과 같은 이유인데 여기가 더 세다 —
 * 사람이 한 글자 칠 때마다 도는 자리라, 활동 기록에 한 줄이 늘면 화면이 그것을
 * "에이전트가 뭔가 바꿨다" 로 읽어(`api.agentRev`) **타이핑 한 번에 서재를
 * 통째로 다시 받는다.** 읽기만 하는 요청이 화면을 새로 고치게 만드는 것은 사고다.
 */

export const dynamic = "force-dynamic";

/*
 * 자르는 것은 `client-api.ts` 의 `clipQuery` 다 — **길이만 가져오지 않고 함수를
 * 가져온다.**
 *
 * 거꾸로처럼 보이지만(서버가 브라우저 모듈을 본다) 그 파일이 **양쪽이 합의한
 * 계약**이고, 자르는 규칙은 계약의 일부다. 예전에는 길이 상수만 가져다 두
 * 곳에서 각자 `slice` 했는데, 규칙이 갈릴 수 있는 자리를 남겨 둔 셈이었다 —
 * 실제로 그 `slice` 가 글자 한가운데를 갈랐고 한쪽만 고치면 브라우저가 보낸
 * 질의를 서버가 다시 다르게 자르게 된다. 함수째 가져오면 갈릴 데가 없다.
 *
 * 그래도 자르는 자리가 둘인 것은 하는 일이 달라서다. 브라우저 쪽은 **431 을
 * 막는 것**이고(주소가 헤더 한도를 넘으면 서버 코드는 한 줄도 안 돈다), 여기는
 * 주소창에 손으로 수십 KB 를 붙여 넣은 것을 **찾기에 들이기 전에** 끊는 것이다.
 * 낱말 하나가 그만큼 길면 접어 둔 서재 전체에 그 길이짜리 `includes` 를 돌리게
 * 되고, 조각을 뜰 때 `locate` 가 걷는 거리도 낱말 길이를 따라 늘어난다.
 */

export async function GET(req: Request) {
  const asked = new URL(req.url).searchParams.get("q") ?? "";
  const query = clipQuery(asked);
  /*
   * 앞뒤 공백을 뗀 것과 견준다. 브라우저는 이미 자른 것을 보내므로 여기서는
   * 대개 같고, 그때 "잘랐다" 를 두 번 말하지 않는다. 주소창에 손으로 적은
   * 꼬리 공백 때문에 잘렸다고 말하는 일도 없다.
   */
  const queryTruncated = query !== asked.trim();

  /*
   * 빈 질의는 400 이 아니라 빈 결과다.
   *
   * 화면은 사람이 글자를 지우는 동안에도 이 주소를 부른다. 마지막 한 글자를
   * 지웠을 때 오류가 뜨면, 아무 잘못도 안 한 사람에게 붉은 줄이 뜨는 셈이다.
   */
  if (!query.trim()) {
    /*
     * 여기서도 잘랐다는 말은 싣는다. 낱말 하나가 상한보다 길면 자른 결과가
     * 빈 글자가 되어 이 갈래로 오는데, 아무 말 없이 빈 결과만 주면 "안 맞았다"
     * 와 "너무 길어서 못 찾았다" 가 화면에서 같아 보인다.
     */
    return NextResponse.json(
      { hits: [], ...(queryTruncated ? { queryTruncated: true } : {}) },
      { headers: { "cache-control": "no-store" } },
    );
  }

  try {
    return NextResponse.json(
      // 잘랐다는 말은 **찾기가 성공했을 때도** 실어 보낸다. 목록이 그럴듯하게
      // 나오는 것이 오히려 위험하다 — 사람은 자기가 친 글 전부로 찾은 줄 안다.
      { ...searchPapers(query), ...(queryTruncated ? { queryTruncated: true } : {}) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    console.error("[paperbento] search failed:", e);
    return NextResponse.json({ error: "찾기에 실패했습니다" }, { status: 500 });
  }
}
