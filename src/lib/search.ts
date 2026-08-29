import { normalizeText } from "./anchor";
import {
  SEARCH_MAX_QUERY,
  type DeepWhere,
  type SearchHit,
  type SearchResponse,
  type SearchWhere,
} from "./client-api";
import { db } from "./db";
import { FRONT_FIELDS, normalizeForSearch, queryWords } from "./filter-papers";
import {
  foldWithMap,
  chunkStart,
  chunkSqlSpan,
  libraryIndex,
  PAGE_MARK,
  rawLimitOf,
  sqlIndexOf,
  type DeepText,
  type Folded,
  type IndexedPaper,
} from "./search-index";

/**
 * 서재 찾기 — **판정의 주인.**
 *
 * 예전에는 여기가 "브라우저가 못 보는 셋(요약·메모·PDF)" 만 맡았다. 앞 칸
 * 여덟은 브라우저가 따로 AND 를 따지고, 화면이 두 답을 OR 로 합쳤다. 그
 * 모양은 **겹을 가로지르는 AND 에서 무너진다.** 제목에만 있는 낱말과 메모에만
 * 있는 낱말을 함께 치면 앞 겹은 "메모 낱말이 앞 칸에 없다" 로 떨어뜨리고 뒤
 * 겹은 "제목 낱말이 이 본문에 없다" 로 떨어뜨려, 양쪽 다 0건이 된다.
 * `attention` 1편 · `중요한통찰` 1편 · `attention 중요한통찰` **0편**.
 *
 * 그래서 판정을 한 곳으로 모았다. 여기가 **열한 자리를 다 보고** 낱말마다
 * "이 논문 어딘가에 있나" 를 따진다 — 제목·저자·학회·연도·DOI·arXiv·태그·
 * 초록(여기까지 `papers` 의 칸) · 요약 본문 · 메모 본문 · PDF 앞부분.
 * 낱말 하나는 열한 자리 중 어디에 있어도 되고(OR), 낱말끼리는 전부여야
 * 한다(AND).
 *
 * **브라우저의 즉시 거르기는 없애지 않았다.** 왕복을 기다리지 않고 첫 글자에
 * 바로 반응하는 값이 크기 때문이다. 다만 그것은 이 답의 **부분집합**이다 —
 * 앞 칸 여덟만으로 낱말 전부가 맞는 논문은 "열한 자리 어딘가에 다 있는"
 * 논문이기도 하다. 그래서 즉시 떴다가 서버 답이 오면서 사라지는 일이
 * 구조적으로 생기지 않는다. **목록은 늘어나기만 한다.**
 *
 * 돌려주는 것은 `paperId` 와 맞은 자리 목록, 그리고 깊은 자리의 조각이다.
 * 논문의 나머지는 화면이 이미 들고 있다.
 */

// ─────────────────────────────────────────────────────────────
//   왜 SQL 이 아니라 접어 둔 글자를 훑는가
// ─────────────────────────────────────────────────────────────

/*
 * 이 파일은 예전에 `like '%…%'` 열한 개를 엮은 SQL 한 덩이였고, 낱말마다
 * "이건 LIKE 로 견줘도 되나" 를 `needsUnicodeFold` 가 정했다. 되면 LIKE,
 * 안 되면 SQLite 에 얹은 JS 함수 `ufind` 로 그 자리에서 접어 견줬다.
 *
 * **그 갈림길을 없앴다. 두 판 연속 틀렸기 때문이다.**
 *
 *   1판 — 대소문자만 보아 악센트·키릴을 LIKE 로 보냈다. `Öztürk` 가 안 걸렸다.
 *   2판 — 그건 고쳤는데 **정규화가 글자를 바꿔 버리는 경우**를 놓쳤다.
 *          `normalizeForSearch` 는 NFC 를 하므로 대소문자와 무관하게 글자를
 *          바꾼다. NFC 가 없애는 글자(호환 한자 U+F900~U+FA6D, 합성 제외
 *          U+0958, 히브리 표현형 U+FB2A, U+2329 … 모두 1,098자)가 **저장값**에
 *          있으면 그 낱말은 빠른 LIKE 로 가고 서버는 영영 못 찾는다. 화면은
 *          찾는다. 실제로 제목 `豈(U+F900) …` 에 `豈(U+8C48)` 을 치면 브라우저가
 *          띄운 500줄이 서버 답을 받고 **0줄 + "맞는 논문이 없습니다"** 가 됐다.
 *
 * 근본 원인은 하나다 — **갈림길은 질의만 보고 정하는데 어긋남은 저장값에서
 * 온다.** 질의만 보고는 맞힐 수 없다. 그래서 맞히려 들지 않고 갈림길을 없앴다.
 *
 * 없앤 자리에 남은 것은 한 줄이다: 저장값과 낱말을 **같은 함수**로 접고
 * (`normalizeForSearch`) 접힌 글자에 `includes` 를 한다. 브라우저의 즉시
 * 거르기가 하는 일과 글자 하나까지 같으므로, 부분집합 성질은 증명할 것이
 * 아니라 **정의**가 된다. 딸려서 `likeVariants`(낱말을 NFC/NFD·대소문자 네
 * 꼴로 펴기)와 LIKE 이스케이프도 없어졌다 — 견줄 자리가 SQL 이 아니니 `%`·`_`
 * 가 무늬가 될 일이 없고, `a_b` 가 `axb` 를 물어 오지 않는 것은 이제 지켜야 할
 * 규칙이 아니라 그냥 `includes` 의 뜻이다.
 *
 * 접힌 글자는 `search-index.ts` 가 서재째로 한 번 접어 들고 있다. 왜 매번
 * 접지 않는지, 언제 다시 접는지는 그 파일에 적어 뒀다.
 *
 * FTS5 를 안 쓰는 까닭은 그대로다 — `unicode61` 토크나이저가 한글을 공백으로만
 * 끊어 "학습" 으로 "강화학습" 을 못 찾는다. `trigram` 으로 우회하면 결국
 * `like` 를 인덱스로 흉내내는 것이고, 아래 숫자를 보면 흉내낼 이유가 없다.
 */

/*
 * ── 잰 값 ──
 *
 * 논문 500 · 요약 300 · 메모 2000, 훑을 글자 575만 자. 터키·키릴·그리스·악센트·
 * 호환 한자·전각·이모지를 섞어 넣은 서재에서 이 함수를 그대로 불러 잰 것이다.
 * 중앙값 / 21회 중 최악(ms), 질의마다 깨끗한 프로세스에서.
 *
 *                        갈림길이 있던 때      접어 두고 훑는 지금
 *   한글 1낱말               11.1 / 13.1         21.5 / 23.8
 *   ASCII 1낱말              10.7 / 13.1         22.4 / 27.1
 *   악센트 1낱말             51.0 / 57.8         21.7 / 28.5
 *   한글 16낱말              28.5 / 37.0         23.5 / 27.8
 *   악센트 16낱말          172.9 / 303.3         18.6 / 22.4
 *   하나도 안 맞는 낱말        9.5 / 10.6          0.6 / 2.6
 *
 * 왼쪽 다섯째 줄이 이 고치기의 절반이다 — 악센트 16낱말이 303ms 까지 갔다.
 * 화면이 200ms 를 미뤄 두고 부르는 자리라, 그 위는 요청이 밀린다는 뜻이다.
 * 지금은 어떤 질의를 넣어도 30ms 를 안 넘는다.
 *
 * **싼 질의 둘은 두 배 느려졌다**(11 → 22ms). 숨기지 않고 적어 둔다. 찾는
 * 일 자체는 0.3ms 로 거의 사라졌고(접어 둔 글자에 `includes` 뿐이다), 늘어난
 * 것은 전부 **조각을 뜨는 값**이다 — 200줄 × 깊은 자리 셋이면 창을 600번
 * 따로 떠 와야 하고(6.9ms), 창마다 다듬고(4.8ms) 접어 자리표를 만든다
 * (10.2ms). 예전에는 창을 본 질의 SQL 안에서 함께 떠 와 왕복이 없었고, 조각
 * 안에서 낱말을 찾는 것도 정규식이라 쌌다. 그 정규식이 **접기 규칙과 달라서**
 * 호환 한자·전각 영문에서는 딱지만 붙고 조각에 낱말이 없었다(결함 B). 11ms 를
 * 22ms 로 치르고 그 갈래를 없앴다.
 *
 * 위 숫자는 접어 둔 것을 쓰는 값이다. **서재가 바뀐 뒤 첫 찾기**는 통째로
 * 다시 접으므로 이 서재에서 127ms 안팎이 한 번 든다(그 뒤로는 두 정수를
 * 견주는 것이 전부다 — `search-index.ts`). 사람이 글자를 치는 동안 서재는
 * 안 바뀌므로 타이핑 중에는 안 나타나고, 메모를 하나 쓴 직후의 첫 찾기에서
 * 한 번 나타난다. 그 127ms 는 끌어오기 25 · 접기 25 · 자리표 30 · 찾기 22 ·
 * 나머지(옛 사본 버리기)로 갈린다.
 *
 * ── 접기가 안 보이는 글자와 줄 끝 하이픈을 지우게 된 뒤 (같은 서재, 765만 자) ──
 *
 * 규칙을 한 벌로 모으느라 접기에 정규식 둘이 붙었다. 그 값을 숨기지 않고 적는다.
 * 같은 DB · 같은 프로세스 모양으로 전후를 나란히 쟀다(중앙값 / 최악, ms).
 *
 *                          전            후
 *   한글 1낱말          24.6 / 30.0   29.2 / 38.4
 *   ASCII 1낱말         25.4 / 29.0   30.6 / 33.0
 *   악센트 16낱말       25.2 / 27.9   29.4 / 33.1
 *   하나도 안 맞음       1.6 /  2.4    1.7 /  2.3
 *   **쓴 직후 첫 찾기** 191.9 / 293.7  253.6 / 441.6
 *
 * 정상 상태는 30ms 언저리로 상한(100ms)에서 한참 아래다. 값을 무는 곳은
 * **다시 접는 자리**이고, 접기 한 번을 뜯어 보면 이렇다(같은 글자 618만 자):
 * NFC 16 · 소문자 23.8 · `\p{Cf}` 13.9 · 하이픈 6.2 · `toWellFormed` 2 —
 * 3판 접기 37.6ms 가 4판 59.2ms 가 됐다. 무늬 둘을 하나로 합쳐도 56ms 라
 * (3ms) 뜻이 없어서 안 합쳤다. 자리표(`foldWithMap`)는 덩이로 한 번 더 접으므로
 * 그 두 배를 문다: 109.5 → 152.3ms.
 *
 * **자리표를 미루는 길은 재 보고 안 갔다.** 자리표는 조각을 뜰 때만 쓰지만,
 * 만들려면 그 행의 **원문 전체**가 있어야 한다(앞에서부터 세어야 자리가 맞는다).
 * 색인은 원문을 안 들고 있으므로 미루면 질의마다 행을 다시 끌어와 접어야 한다.
 * 이 서재에서 상한(200줄)을 채우는 질의는 깊은 자리 533행 · 248만 자를 건드리고,
 * 그 자리표를 만드는 데만 62~107ms 가 든다(전체의 40%). 끌어오는 값(약 22ms)은
 * 별도다. 한 번 무는 93ms 를 **질의마다 무는 85~130ms** 로 바꾸는 셈이라,
 * 정상 상태 100ms 를 지키려면 지금처럼 미리 만들어 두는 편이 맞다.
 */

// ─────────────────────────────────────────────────────────────
//   상한
// ─────────────────────────────────────────────────────────────

/**
 * 낱말 수.
 *
 * **말없이 버리지 않는다.** 예전에는 여덟 개에서 잘라 냈는데, 서재에 없는
 * 낱말을 아홉 번째로 치면 그 낱말이 통째로 버려진 채 논문이 떴다 — 조각
 * 어디에도 그 낱말이 없는데도. 사람이 보기에 이건 그냥 고장이다.
 *
 * 이제 넘으면 찾기를 **안 한다.** `tooManyWords` 로 돌아서고 `hits` 를 비운다.
 * 열여섯이면 AND 로 의미 있게 칠 수 있는 수보다 한참 위라, 여기 걸리는 것은
 * 대개 문단을 통째로 붙여 넣은 경우다. 그때 필요한 말은 "몇 건" 이 아니라
 * "낱말이 너무 많다" 이다.
 */
const MAX_WORDS = 16;

/*
 * 낱말 하나의 길이 상한은 두지 않는다.
 *
 * 예전에는 100자에서 잘랐는데, 그것도 말없이 하는 일이었다. 게다가 라우트가
 * 질의 전체를 200자로 자르므로 낱말 하나는 어차피 200자를 넘을 수 없다.
 * 두 곳에서 자르면 어느 쪽이 잘랐는지 말할 수 없게 되기만 한다.
 */

/**
 * 결과 상한. 넘치면 `truncated` 로 **말한다.**
 *
 * 화면이 한 번에 그리는 줄이 200 이라 그 위는 어차피 안 보인다. 조각이
 * 자리마다 160자 안쪽이고 한 논문에 최대 셋이라, 최악이라도 응답은 100KB
 * 언저리다.
 *
 * 넘칠 때 무엇이 살아남는지를 등수로 고르지 **않는다.** 등수는 화면의 몫인데
 * 여기서 한 번 더 매기면 순서가 왜 이런지 아무도 설명할 수 없게 된다. 그래도
 * 목록 머리가 망가지지 않는 것은 **앞 겹 덕분이다** — 브라우저는 서재 500편을
 * 전부 제 손으로 훑으므로 제목이 맞은 논문을 여기서 잘리든 말든 들고 있다
 * (`truncated` 를 받으면 화면이 즉시 거르기의 줄을 지우지 않는다).
 */
const RESULT_LIMIT = 200;

/**
 * 본문에서 잘라 올 창의 크기와, 맞은 자리 **앞**에 두는 자락.
 *
 * **본문을 통째로 끌고 오면 안 된다.** 요약 하나가 최대 200,000자다(zod 상한).
 * 흔한 낱말 하나에 200행이 걸리면 그것만으로 수십 MB 가 JS 로 넘어온다.
 * 그래서 맞은 자리를 접힌 글자에서 짚고, 그 둘레만 SQL `substr` 로 떠 온다.
 *
 * 창은 **덩이 하나 + 낱말 하나**를 덮어야 한다. 자리표가 덩이 머리를 돌려주므로
 * 참값이 최대 한 덩이 뒤에 있고, 낱말 자체가 질의 상한(200자)까지 길 수 있다.
 * 이 부등식이 깨지면 "맞았다는데 인용문에 그 낱말이 없는" 결함이 그대로
 * 되살아난다.
 *
 * **그런데 덩이는 늘 `CHUNK`(256) 가 아니다.** 빈칸 뭉치를 만나면 그 너머까지
 * 밀린다(`search-index.ts` 의 `isSpace`) — 하이픈으로 잘린 낱말이 빈칸 2,000개를
 * 사이에 두고 이어지면 덩이가 그만큼 길어지고, 800자 창은 그 낱말을 못 덮는다.
 * 실제로 그 자리에서 조각이 본문 앞머리로 물러섰다. 그래서 상수를 키우는 대신
 * **덩이 길이를 물어보고 창을 그만큼 늘린다** (`chunkSqlSpan`). 아래 `WINDOW` 는
 * 흔한 경우(덩이 256)의 값이자 바닥이고, 셈은 `windowOf` 에 있다.
 *
 * **단위는 코드포인트다** — `substr` 에 넘기는 값이라 SQLite 가 세는 방식을
 * 따른다. 덩이 256은 UTF-16 칸으로 센 것이라 코드포인트로는 그 이하이고,
 * 낱말 200자도 마찬가지다.
 */
const WINDOW = 800;
const WINDOW_LEAD = 200;

/**
 * 덩이가 길어 창을 늘릴 때의 천장.
 *
 * 늘리는 것은 자리를 짚기 위해서지 본문을 퍼 오기 위해서가 아니다. 여기를 넘는
 * 덩이는 포기하고 본문 앞머리를 보여 준다 — 빈칸이 1만 자 넘게 이어지는 글은
 * 사람이 읽으라고 쓴 글이 아니고, 그런 창을 200줄 × 셋만큼 뜨면 그 질의만
 * 눈에 띄게 느려진다.
 */
const WINDOW_MAX = 8192;

/** 맞은 자리 앞뒤로 보여 줄 글자. */
const SNIPPET_RADIUS = 55;

/** 맞은 덩어리 자체가 길 때 잘라 낼 자리. 조각은 최대 55+50+55 = 160자다. */
const MATCH_CAP = 50;

/**
 * 창 안에서 낱말 자리를 짚을 때 쓰는 덩이 크기.
 *
 * 서재를 접을 때(`CHUNK`, 256자)보다 잘게 끊는다. 저기서는 800자 창 안에만
 * 들면 됐지만 여기서는 **반지름 55자 안**에 들어야 하고, `locate` 가 덩이
 * 머리에서부터 한 글자씩 걸어 오므로 덩이가 크면 그 걸음이 길어진다. 창이
 * 800자뿐이라 잘게 끊어도 값이 안 든다.
 */
const SNIPPET_CHUNK = 16;

// ─────────────────────────────────────────────────────────────
//   질의를 낱말로
// ─────────────────────────────────────────────────────────────

/*
 * 낱말 나누기는 **화면이 쓰는 함수를 그대로 부른다** (`queryWords`).
 *
 * 예전에는 여기에 `splitWords` 가 따로 있었다. 나눈 뒤에 낱말마다 접느냐 마느냐를
 * 정해야 해서 "사람이 친 그대로" 를 들고 있어야 했기 때문인데, 그 갈림길이
 * 없어졌으니 들고 있을 이유도 없어졌다. 같은 함수를 부르면 **화면이 하나로
 * 세는 낱말을 서버가 둘로 세는 일**이 아예 생길 수 없다 — 낱말 상한
 * (`MAX_WORDS`)이 양쪽에서 갈리면 "왜 이 질의만 안 찾아지지" 가 된다.
 */

// ─────────────────────────────────────────────────────────────
//   열한 자리
// ─────────────────────────────────────────────────────────────

/**
 * 낱말 하나가 이 논문 **어딘가에** 있는가.
 *
 * 차례가 값이다. 처음 맞는 데서 멈추므로 **짧은 칸을 앞에** 둔다 — 제목·저자
 * 처럼 한 줄짜리가 먼저 걸리면 초록(수 KB)과 PDF 앞부분(6,000자)은 아예 안
 * 읽는다. 요약·메모를 맨 뒤에 두는 것도 같은 이유다.
 */
function wordAnywhere(p: IndexedPaper, word: string): boolean {
  for (const f of p.front) if (f.includes(word)) return true;
  if (p.head !== null && p.head.text.includes(word)) return true;
  if (p.summary !== null && p.summary.text.includes(word)) return true;
  for (const n of p.notes) if (n.text.includes(word)) return true;
  return false;
}

/**
 * 이 본문에서 **맞은 첫 낱말**의 접힌 자리. 하나도 없으면 `-1`.
 *
 * 기준을 "첫 낱말" 이 아니라 "맞은 첫 낱말" 로 잡는다. 낱말마다 어느 자리에
 * 있어도 되므로 첫 낱말이 이 본문에 없는 일이 흔한데, 그때 늘 본문 앞머리를
 * 보여 주면 "맞았다면서 왜 안 보이냐" 가 된다.
 */
function firstWordAt(d: DeepText, words: string[]): number {
  for (const w of words) {
    const at = d.text.indexOf(w);
    if (at >= 0) return at;
  }
  return -1;
}

// ─────────────────────────────────────────────────────────────
//   창 떠 오기
// ─────────────────────────────────────────────────────────────

/*
 * 맞은 자리 둘레만 떠 온다. **원문은 안 들고 있다** — `search-index.ts` 가
 * 접힌 사본만 붙들고 있으므로(원문까지 들면 메모리가 두 배다) 조각을 뜰 때만
 * 그 행을 다시 짚는다. 결과 200줄 × 깊은 자리 셋이라 최악이 600번이고,
 * 한 번에 800자씩이라 다 합쳐도 50만 자다.
 */
const WINDOW_SQL: Record<DeepWhere, string> = {
  summary: "select substr(body, ?, ?) as w from paper_summaries where paper_id = ?",
  note: "select substr(body, ?, ?) as w from paper_notes where id = ?",
  pdf: "select substr(head_text, ?, ?) as w from papers where id = ?",
};

/*
 * 준비한 문장을 들고 있는다. **`prepare()` 를 조각마다 부르면 안 된다** —
 * 그때마다 SQL 을 다시 컴파일하는데, 200줄 × 세 자리면 한 질의에 600번이라
 * 그것만으로 10ms 가 넘게 든다. 연결이 하나뿐이라(`db/index.ts`) 한 번 준비해
 * 두면 계속 쓴다.
 */
type WindowStmt = { get(from: number, len: number, key: string): { w: string | null } | undefined };
const windowStmt = new Map<DeepWhere, WindowStmt>();

function stmtFor(place: DeepWhere) {
  let st = windowStmt.get(place);
  if (!st) {
    st = db.$client.prepare<[number, number, string], { w: string | null }>(WINDOW_SQL[place]);
    windowStmt.set(place, st);
  }
  return st;
}

/**
 * 접힌 자리를 원문 자리로 바꿔 그 둘레를 떠 온다.
 *
 * 자리표(`sqlIndexOf`)는 덩이 머리로 내려 주므로 참값보다 늘 앞이고 어긋남이
 * 한 덩이를 안 넘는다. 창을 그 자리 앞뒤 400자로 잡으므로 맞은 낱말은 반드시
 * 창 안에 있다. **예전에는 여기서 줄어든 비율로 곱해 짐작했고**, 비율이 본문
 * 안에서 고르지 않으면(앞은 NFD 한글, 뒤는 아스키) 수천 자 어긋나 창 밖으로
 * 나갔다 — 그러면 딱지는 "요약에서 맞음" 인데 인용문에 찾은 낱말이 없다.
 *
 * **자리는 SQLite 가 세는 방식(코드포인트)으로 받는다.** JS 자리를 그대로
 * 넘기면 안 된다 — JS 는 UTF-16 칸이라 이모지 하나가 두 칸인데 `substr` 은
 * 한 글자로 세므로, 맞은 자리 앞의 BMP 밖 글자 수만큼 창이 뒤로 밀린다.
 * 그 밀림이 뒷자락(600)을 넘으면 낱말이 창 밖으로 나가고, 더 크면 창이 본문
 * 끝을 지나 조각이 아예 안 나온다. 같은 결함이 다른 옷을 입고 되살아나는
 * 자리라 셈을 아예 `FoldMap.sql` 에 따로 적어 둔다.
 */
function windowOf(place: DeepWhere, d: DeepText, foldAt: number): string {
  const at = sqlIndexOf(d, foldAt);
  const from = Math.max(1, at + 1 - WINDOW_LEAD);
  /*
   * 창 = 앞자락 + **이 덩이 전체** + 낱말이 가질 수 있는 최대 길이 + 여유.
   * 덩이 길이를 모르면(자리표가 끊긴 창) 흔한 경우의 값을 쓴다.
   */
  const span = chunkSqlSpan(d, foldAt);
  const need = span < 0 ? WINDOW : WINDOW_LEAD + span + SEARCH_MAX_QUERY + 144;
  const row = stmtFor(place).get(from, Math.min(WINDOW_MAX, Math.max(WINDOW, need)), d.key);
  return row?.w ?? "";
}

// ─────────────────────────────────────────────────────────────
//   조각 자르기
// ─────────────────────────────────────────────────────────────

/*
 * 쪽 표시는 조각에서 **지운다.** 몇 쪽인지 실을 자리가 없고, 계약을 넓히는
 * 것보다 조각이 깨끗한 편이 낫다. 무늬는 `search-index.ts` 것을 가져다 쓴다 —
 * 접어 둘 때는 같은 무늬를 **같은 길이의 빈칸으로** 갈아 끼워 그 자리가 아예
 * 안 맞게 해 뒀다. 두 곳이 다른 무늬를 쓰면 "표시에서 맞고 조각에서는 지워진"
 * 논문이 생긴다.
 */

/**
 * 창 한 조각을 사람이 읽을 한 줄로.
 *
 * `normalizeText()` 를 그대로 쓴다 — NFC 로 맞추고, 안 보이는 글자를 지우고,
 * 줄 끝에서 하이픈으로 잘린 낱말을 잇고, 줄바꿈을 공백 하나로 접는다.
 * 마지막 것이 특히 중요하다. 안 접으면 목록 한 줄이 세 줄로 늘어난다.
 *
 * **예전에는 이 다듬기가 판정보다 한 겹 더 지웠다. 그게 결함이었다.**
 * 판정(`normalizeForSearch`)은 U+00AD 를 안 지우니 `diffu<U+00AD>sion` 이
 * 그대로 맞았는데, 여기서 다듬고 나면 그 낱말이 `diffusion` 이 되어 아래
 * `locate` 가 못 짚고 조각이 본문 앞머리로 물러섰다 — 딱지는 "요약에서 맞음"
 * 인데 인용문에는 그 낱말이 없다. 거친 표본에서 조각 12.2%가 그랬다.
 *
 * 이제 **접기가 그 셋 중 둘(안 보이는 글자 · 줄 끝 하이픈)을 먼저 한다.**
 * 여기 남은 것은 공백 접기뿐이고, 낱말은 공백을 품을 수 없으므로 다듬은 창을
 * 접은 것에는 판정이 맞힌 낱말이 그대로 들어 있다. 규칙을 판정 쪽으로 모은
 * 것이지 여기서 덜 지우게 만든 것이 아니다 — 보여 줄 때 줄바꿈을 접는 일은
 * 여전히 여기 몫이다.
 *
 * **자리는 여기서 다시 짚는다.** 다듬기가 글자를 지우고 이어 붙여 자리를
 * 옮기므로, 창을 뜰 때 쓴 자리를 그대로 쓰면 어긋난다. 다듬은 글자를 그
 * 자리에서 한 번 더 접어(창이 800자뿐이라 값이 없다) 접힌 낱말을 찾고, 그 자리를
 * 자리표로 되돌린다. **낱말도 창도 같은 함수로 접히므로 여기서 못 찾는 일은
 * 창이 애초에 낱말을 안 품었을 때뿐이다.**
 *
 * 예전에는 여기서 낱말마다 `new RegExp(…, "i")` 를 만들어 원문에 그대로
 * 댔다. 정규식의 `i` 는 유니코드 단순 접기라 **접기 규칙과 다르다** — 호환
 * 한자·전각 영문처럼 NFC 가 바꾸는 글자는 딱지가 붙어도 조각에서 못 찾아
 * 늘 본문 앞머리가 나왔다. 규칙을 한 벌로 모으면서 그 갈래도 없어졌다.
 *
 * **자르기 전에 NFC 로 맞추는 것이 핵심이다.** SQLite `substr` 은 글자 단위라
 * 완성형 한글은 안 깨지지만 조합형은 자모를 가른다(`강` → `ᆼ`). NFC 로 맞춘
 * 뒤에 JS 에서 자르면 그 문제가 통째로 사라지고, 남는 것은 서로게이트 쌍
 * (이모지)뿐이라 양 끝만 한 칸씩 봐 주면 된다.
 *
 * **요약과 메모는 사람이 쓴 글이라 통째로 내보내지 않는다.** 여기서 잘라
 * 나가는 160자가 밖으로 나가는 전부다.
 */
/**
 * 다듬은 창에서 접힌 낱말이 **실제로** 시작하는 자리와, 그것을 덮는 원문 길이.
 * 못 짚으면 `null`.
 *
 * 접기는 글자 수를 바꾼다(조합형 `ö` 는 원문 두 글자가 접히면 한 글자다).
 * 그래서 접힌 자리를 그대로 원문 자리로 쓰면 조각이 낱말을 비껴간다 — 예전
 * `uat` 이 줄어든 비율로 곱해 짐작하다가 1,024자를 어긋난 그 자리다.
 *
 * 여기서는 짐작하지 않는다. 자리표가 짚어 준 **덩이 머리**에서 시작해
 * (`foldWithMap` 이 거기서 끊어도 정본과 같음을 확인해 뒀다) 원문을 한 글자씩
 * 늘려 가며 접어 보고, 접은 것이 정본과 그대로 맞는 지점만 "짝이 맞는 자리" 로
 * 센다. 접힌 자리가 낱말을 막 지나기 직전의 원문 자리가 낱말의 시작이다.
 *
 * **늘 앞에서부터 통째로 접는 것이 요점이다.** 한 글자만 떼어 접으면 앞뒤
 * 문맥을 잃는다 — 그리스 `Σ` 는 뒤에 대소문자 있는 글자가 오면 `σ`, 아니면
 * `ς` 이고, 결합 기호는 앞 글자와 합쳐진다. 문맥을 잃은 채로 견주면 맞는 자리를
 * 영영 못 찾아 조각이 본문 앞머리로 물러선다(그 갈래를 실제로 밟아 봤다).
 *
 * 걷다가 어디서 포기할지는 **자리표에게 묻는다** (`rawLimitOf`). 예전에는
 * `낱말 길이 × 3` 으로 어림했는데 — "접힌 글자 하나가 원문에서 셋을 안 넘는다"
 * 는 조합형 한글 표에 기댄 값이다 — 접기가 안 보이는 글자를 지우게 되면서
 * 그 표가 깨졌다. 낱말 사이에 U+00AD 가 끼면 원문은 접힌 것의 몇 배도 된다.
 * 못 찾고 포기하면 본문 앞머리를 보여 준다. 엉뚱한 데를 가리키는 것보다 낫다.
 */
function locate(
  hay: string,
  folded: Folded,
  foldAt: number,
  word: string,
): [number, number] | null {
  const [p0, q0] = chunkStart(folded, foldAt);
  const end = rawLimitOf(folded, foldAt + word.length);
  const limit = end < 0 ? hay.length : Math.min(hay.length, end);
  let start = p0;
  for (let e = p0; e <= limit; e++) {
    const f = normalizeForSearch(hay.slice(p0, e));
    if (!folded.text.startsWith(f, q0)) continue;
    const q = q0 + f.length;
    if (q <= foldAt) start = e;
    if (q >= foldAt + word.length) return [start, e - start];
  }
  return null;
}

function cut(window: string, words: string[], isPdf: boolean): string {
  const hay = normalizeText(isPdf ? window.replace(PAGE_MARK, " ") : window);
  if (!hay) return "";

  const folded = foldWithMap(hay, SNIPPET_CHUNK);
  let from = 0;
  let to = Math.min(hay.length, SNIPPET_RADIUS * 2);
  for (const w of words) {
    const at = folded.text.indexOf(w);
    if (at < 0) continue;
    const found = locate(hay, folded, at, w);
    if (found === null) continue;
    const [start, len] = found;
    from = Math.max(0, start - SNIPPET_RADIUS);
    to = Math.min(hay.length, start + Math.min(len, MATCH_CAP) + SNIPPET_RADIUS);
    break;
  }

  // 반쪽 서로게이트가 새어 나가면 화면에 깨진 네모가 뜬다.
  if (from > 0 && hay.charCodeAt(from) >= 0xdc00 && hay.charCodeAt(from) <= 0xdfff) from -= 1;
  if (to < hay.length && hay.charCodeAt(to) >= 0xdc00 && hay.charCodeAt(to) <= 0xdfff) to += 1;

  return (from > 0 ? "…" : "") + hay.slice(from, to) + (to < hay.length ? "…" : "");
}

// ─────────────────────────────────────────────────────────────
//   찾기
// ─────────────────────────────────────────────────────────────

/**
 * 열한 자리에서 낱말 전부를 찾는다. 낱말마다 자리 사이는 OR, 낱말끼리는 AND.
 *
 * 조각은 맞은 깊은 자리마다 하나씩, 최대 셋이다. 메모는 논문 하나에 여럿이라
 * **가장 앞 쪽의 맞은 메모** 하나만 뜬다 — 읽은 순서와 같아서 사람이 짚기
 * 쉽고, 안 접으면 메모 스무 개를 단 논문 하나가 결과를 통째로 채운다.
 *
 * 실패를 삼키지 않는다. 여기서 던지면 라우트가 500 과 한 문장을 준다.
 */
export function searchPapers(query: string): SearchResponse {
  const words = queryWords(query);
  if (words.length === 0) return { hits: [] };
  /*
   * 넘치면 **찾지 않는다.** 앞의 열여섯 개로 찾아 보여 주면 사람은 자기가
   * 친 낱말이 전부 반영된 목록으로 읽는다. 안 찾고 말하는 편이 정직하다.
   */
  if (words.length > MAX_WORDS) return { hits: [], tooManyWords: true };

  /*
   * 걸러 내기와 딱지 붙이기를 두 판으로 나눈다.
   *
   * 걸러 내기는 낱말이 하나라도 없으면 그 논문에서 바로 손을 떼지만, 딱지는
   * 어느 칸에서 맞았는지를 **전부** 알아야 붙는다. 한 판으로 합치면 떨어질
   * 논문에서도 여덟 칸을 끝까지 다 훑게 된다. 상한(`RESULT_LIMIT`)에서 일찍
   * 멈추는 것도 첫 판이라 할 수 있다.
   */
  const matched: IndexedPaper[] = [];
  for (const p of libraryIndex()) {
    let all = true;
    for (const w of words) {
      if (!wordAnywhere(p, w)) {
        all = false;
        break;
      }
    }
    if (!all) continue;
    matched.push(p);
    // 한 편 더 모아 두면 따로 세지 않고도 잘렸는지 안다.
    if (matched.length > RESULT_LIMIT) break;
  }

  const truncated = matched.length > RESULT_LIMIT;
  const hits: SearchHit[] = [];

  for (const p of matched.slice(0, RESULT_LIMIT)) {
    const where: SearchWhere[] = [];
    for (let i = 0; i < FRONT_FIELDS.length; i++) {
      const hay = p.front[i];
      if (words.some((w) => hay.includes(w))) where.push(FRONT_FIELDS[i]);
    }

    /*
     * 메모는 **맞은 것 중 가장 앞 쪽** 하나만 본다. `notes` 가 이미 쪽 차례라
     * 처음 맞는 데서 멈추면 그것이 그 하나다.
     */
    let note: DeepText | null = null;
    let noteAt = -1;
    for (const n of p.notes) {
      const at = firstWordAt(n, words);
      if (at >= 0) {
        note = n;
        noteAt = at;
        break;
      }
    }

    const deep: [DeepWhere, DeepText | null, number, boolean][] = [
      ["summary", p.summary, p.summary === null ? -1 : firstWordAt(p.summary, words), false],
      ["note", note, noteAt, false],
      ["pdf", p.head, p.head === null ? -1 : firstWordAt(p.head, words), true],
    ];

    const snippets: { where: DeepWhere; text: string }[] = [];
    for (const [place, d, at, isPdf] of deep) {
      if (d === null || at < 0) continue;
      where.push(place);
      /*
       * 딱지는 붙이고 조각은 안 붙일 수 있다. 쪽 표시밖에 없는 창처럼
       * 다듬고 나면 아무것도 안 남는 자리가 있는데, 그때 빈 줄을 보내면
       * 화면에 빈 인용이 그려진다. "여기서 맞았다" 는 사실은 딱지가 이미 말한다.
       */
      const text = cut(windowOf(place, d, at), words, isPdf);
      if (text) snippets.push({ where: place, text });
    }

    hits.push({ paperId: p.id, where, snippets });
  }

  return truncated ? { hits, truncated: true } : { hits };
}
