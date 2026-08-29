import type { GroupDTO, PaperDTO, PaperMark, ReadState } from "./types";

/**
 * 앞(즉시) 계층 — **브라우저가 이미 들고 있는 칸만으로** 거른다.
 *
 * `/api/groups` 는 논문의 제목·저자·학회·연도·DOI·arXiv·태그·**초록**까지
 * 한 번에 내려보낸다 (`paper-server.ts` 의 select 에 `abstract` 가 있다).
 * 그래서 이 여덟 칸은 서버에 묻지 않고 그 자리에서 답할 수 있다 — 사람이
 * 글자 하나를 칠 때마다 왕복하면 그것만으로 목록이 흔들린다.
 *
 * **판정의 주인은 서버다.** `GET /api/search` 가 열한 자리(이 여덟 칸 + 요약
 * 본문 · 메모 본문 · PDF 앞부분)를 한꺼번에 보고 낱말마다 "이 논문 어딘가에
 * 있나" 를 따진다. 여기 있는 `matchFront` 는 그 답을 **기다리는 동안** 쓰는
 * 임시 답이다.
 *
 * 임시 답이어도 거짓말은 아니다 — 여덟 칸은 열한 자리의 부분집합이므로,
 * 앞에서 맞은 논문은 서버 답에도 반드시 들어 있다. 그래서 목록은 답이 오면
 * **늘어나기만 하고 줄이 사라지지 않는다.** (`search-panel.tsx` 가 이 성질에
 * 기대어 그린다. 여기서 칸을 하나라도 빼면 그 성질이 깨진다.)
 *
 * 자리만 부분집합이면 되는 것이 아니다. **글자를 접는 규칙도 같아야 한다.**
 * 여기서 `öztürk` 를 찾아내고 서버가 못 찾으면 자리와 상관없이 줄이 사라진다.
 * 그래서 접기는 이 파일의 `normalizeForSearch` 한 곳에 있고, 서버
 * (`search-index.ts`)는 **그 함수로 접어 둔 글자**에 `includes` 를 할 뿐이다.
 * 접기가 한 벌이고 견주는 방법까지 같아서, 부분집합 성질은 지켜야 할 규율이
 * 아니라 **정의**다.
 *
 * 이 파일에는 리액트가 없다. 순수 함수만 두는 이유는 두 가지다 — 화면 없이
 * 검증할 수 있고, `useMemo` 로 언제 다시 도는지를 부르는 쪽이 정한다.
 */

// ─────────────────────────────────────────────────────────────
//   맞은 자리
// ─────────────────────────────────────────────────────────────

/** 앞(즉시)이 뒤지는 칸. 화면 딱지가 붙는 차례도 이 차례다. */
export const FRONT_FIELDS = [
  "title",
  "authors",
  "venue",
  "year",
  "doi",
  "arxiv",
  "tags",
  "abstract",
] as const;

export type FrontField = (typeof FRONT_FIELDS)[number];

export const FRONT_LABEL: Record<FrontField, string> = {
  title: "제목",
  authors: "저자",
  venue: "학회",
  year: "연도",
  doi: "DOI",
  arxiv: "arXiv",
  tags: "태그",
  abstract: "초록",
};

/**
 * 결과를 세우는 차례.
 *
 * 서재 차례 그대로 두면 흔한 낱말 하나에 제목이 맞은 논문이 초록이 맞은
 * 논문 200편 밑으로 밀린다 — 찾는 사람이 보려던 것은 대개 제목 쪽이다.
 * 그래서 **맞은 칸 중 가장 앞선 것**으로만 한 번 세우고, 같은 값끼리는
 * 서재 차례를 그대로 지킨다(JS 의 sort 는 안정 정렬이다). 점수를 더 정교하게
 * 매기지 않는 것은, 순서가 왜 이런지 사람이 설명할 수 없게 되면 그 순간부터
 * 목록을 못 믿기 때문이다.
 */
const FIELD_RANK: Record<FrontField, number> = {
  title: 0,
  authors: 1,
  tags: 1,
  venue: 2,
  year: 3,
  doi: 3,
  arxiv: 3,
  abstract: 4,
};

/** 앞에서는 안 걸리고 깊은 자리(요약·메모·PDF)로만 걸린 논문. 늘 맨 뒤다. */
export const DEEP_ONLY_RANK = 5;

/**
 * 맞은 앞 칸으로 등수를 매긴다.
 *
 * **빈 배열이면 `DEEP_ONLY_RANK` 다.** 서버가 준 자리가 깊은 것뿐일 때가
 * 바로 그 경우라, 부르는 쪽은 갈래를 따로 태우지 않고 `frontRank(앞 칸)` 한
 * 번으로 "앞이 섞였으면 그 등수, 깊은 것뿐이면 맨 뒤" 를 얻는다.
 */
export function frontRank(fields: FrontField[]): number {
  let best = DEEP_ONLY_RANK;
  for (const f of fields) best = Math.min(best, FIELD_RANK[f]);
  return best;
}

/**
 * 서버가 준 자리 목록에서 **앞 칸만** 골라 낸다.
 *
 * 서버는 열한 자리를 한 배열(`where`)에 섞어 보낸다. 화면은 앞 칸과 깊은 칸에
 * 다른 딱지를 붙이고(꽉 찬 것 · 점선), 등수도 앞 칸으로만 매긴다. 가르는 자리를
 * 여기 두는 것은 **`FRONT_FIELDS` 가 여기 있기 때문**이다 — 칸이 하나 늘 때
 * 고칠 곳이 한 군데로 남는다. 차례도 `FRONT_FIELDS` 를 따르므로 딱지가 붙는
 * 차례는 서버가 배열에 담은 차례와 무관하게 늘 같다.
 */
export function frontFieldsOf(where: readonly string[]): FrontField[] {
  if (where.length === 0) return [];
  const got = new Set<string>(where);
  return FRONT_FIELDS.filter((f) => got.has(f));
}

// ─────────────────────────────────────────────────────────────
//   눕혀 둔 서재
// ─────────────────────────────────────────────────────────────

/*
 * 안 보이면서 견주기만 어긋나게 하는 글자 — soft hyphen(U+00AD) · zero width
 * 계열(U+200B~200D) · BOM(U+FEFF) 이 모두 유니코드 분류 Cf 다. 목록을 손으로
 * 적으면 다음에 새로운 놈이 나왔을 때 또 빠진다. **`anchor.ts` 와 같은 무늬다.**
 */
const INVISIBLE = /\p{Cf}/gu;

/*
 * 줄 끝에서 낱말을 자른 하이픈. 아스키 하이픈과 U+2010/U+2011 만 본다 —
 * 줄표(em dash)까지 넣으면 "문장 —\n다음" 이 "문장다음" 으로 붙는다.
 * 이것도 `anchor.ts` 와 같은 무늬다.
 */
const HYPHEN_BREAK = /[-‐‑][ \t]*\r?\n[ \t]*/g;

/**
 * 안 보이는 글자를 지우고 · 줄 끝 하이픈을 잇고 · NFC · 소문자.
 * **찾기의 접기 규칙은 이 함수 하나다 — 서버도 이것을 쓴다.**
 *
 * NFC 로 맞추는 것은 같은 한글이 조합형과 완성형으로 갈리기 때문이다 —
 * `anchor.ts` 가 PDF 글자에서 이미 겪은 문제이고, 사람이 키보드로 친 글자와
 * 서지정보에 저장된 글자가 다른 꼴일 수 있다. 소문자는 대소문자를 안 가리기
 * 위해서다. 한국어에 `toLowerCase()` 는 무해하다.
 *
 * **서버가 같은 함수로 저장값을 접어 둔다.** `search-index.ts` 가 열한 자리의
 * 글자를 이 함수로 한 번 접어 들고 있고, `search.ts` 는 그 접힌 글자에
 * `includes` 를 할 뿐이다. 그래서 "즉시 거르기가 서버 답의 부분집합" 이라는
 * 성질이 **증명할 것이 아니라 정의**다 — 같은 함수로 접은 같은 문자열을
 * 같은 방법으로 견주므로 갈릴 데가 없다.
 *
 * ── 여기 있던 예외 넷을 없앤 이유 ──
 *
 * 예전에는 접어도 **아스키가 새어 나오는** 글자 넷(U+0130 터키 İ · U+037E
 * 그리스 물음표 · U+1FEF 바레이아 · U+212A 켈빈 기호)을 일부러 안 접었다.
 * 서버가 순수 아스키 낱말을 SQLite `LIKE` 로 견줬고 LIKE 는 `İ` 를 `i` 로 안
 * 접으니, 화면만 접으면 떴던 줄이 서버 답을 받고 사라졌기 때문이다.
 *
 * **그 LIKE 갈래가 이제 없다.** 서버도 이 함수로 접은 글자만 본다. 예외를
 * 남겨 둘 이유가 사라졌을 뿐 아니라, 남기면 `istanbul` 로 `İstanbul` 을 못
 * 찾는 한계가 그대로 남는다. 그래서 지웠고, 그 덕에 접기가 갈래 없는 한 줄이
 * 되었다(같은 서재에서 서재 전체를 접는 값이 36.5ms → 21.2ms 로 줄었다).
 *
 * **성능을 이유로 "아스키 낱말은 LIKE 로" 를 되살리지 마라.** 그 갈림길이 두
 * 판 연속 틀렸다. 갈림길은 **질의**만 보고 정하는데 어긋남은 **저장값**에서
 * 온다 — 질의가 순수 아스키여도 저장값에 NFC 가 바꿔 버리는 글자(호환 한자
 * U+F900~U+FA6D 따위 1,098자)가 있으면 LIKE 는 영영 못 찾고 화면은 찾는다.
 * 질의만 보고는 맞힐 수 없는 판단이라, 맞히는 대신 갈림길을 없앴다.
 *
 * ── 안 보이는 글자와 줄 끝 하이픈을 여기서 지우는 이유 ──
 *
 * 예전에는 이 둘을 **조각을 뜨는 쪽에서만** 지웠다(`anchor.ts` 의
 * `normalizeText`, `search.ts` 의 `cut`). 판정은 안 지우고 짚기는 지우니
 * 규칙이 둘로 갈렸고, 그 틈에서 두 가지가 났다.
 *
 *   · 딱지는 "요약에서 맞음" 인데 인용문에는 그 낱말이 없다. 판정에서는
 *     `diffu<U+00AD>sion` 이 그대로 맞았는데, 조각 창은 다듬으면서 U+00AD 를
 *     지워 `diffusion` 이 되고, 거기서 원래 낱말을 못 짚어 본문 앞머리로
 *     물러선다. 거친 표본에서 조각 12.2%가 이 꼴이었다.
 *   · `attention` 을 쳐서 `atten<U+200B>tion` 을 **영영 못 찾는다.** 이 글자들은
 *     보이지 않으므로 사람이 칠 수가 없는데, PDF 에서 복사한 요약·메모에는
 *     실제로 섞여 온다. 줄 끝 하이픈(`trans-\nformer`)도 마찬가지다.
 *
 * 그래서 판정 쪽으로 맞췄다. 접기가 지우면 두 자리가 같은 글자를 보게 되고,
 * 덤으로 사람이 눈에 보이는 대로 쳐서 찾을 수 있다. **화면도 같은 함수를
 * 부르므로 부분집합 성질은 그대로다** — 규칙이 한 벌인 것이 요점이지 어느
 * 쪽으로 맞추느냐가 아니다.
 *
 * 순서가 중요하다: 안 보이는 글자를 **NFC 앞에서** 지워야 그 글자에 가로막혀
 * 못 합쳐지던 결합 기호가 제 글자로 돌아간다(`a` + U+00AD + U+0301 → `á`).
 * 공백 접기(`normalizeText` 의 마지막 단계)는 여기서 안 한다 — 낱말은 공백을
 * 품을 수 없어 판정에 아무 값이 없고, 접힌 자리표(`search-index.ts`)만
 * 흔들린다. 그건 보여 줄 때의 몫이다.
 */
export function normalizeForSearch(s: string): string {
  /*
   * 짝 잃은 서로게이트를 먼저 U+FFFD 로 바꾼다. **SQLite 가 그렇게 하기
   * 때문이다** — UTF-8 로는 반쪽 서로게이트를 담을 수 없어 드라이버가 U+FFFD
   * 로 바꿔 넣는다. JS 문자열은 UTF-16 코드 단위라 반쪽만으로도 `includes` 가
   * 참이 되므로, 안 맞추면 화면만 찾아내는 줄이 생긴다. 질의를 낱말 사이에서
   * 자르게 된 뒤로도 이 줄은 남는다 — 주소창에 손으로 적은 `?q=` 와 저장값
   * 자체가 반쪽을 물고 올 수 있다.
   * (`toWellFormed` 는 Tailwind v4 가 요구하는 브라우저 바닥과 같은 세대다.)
   */
  return s
    .toWellFormed()
    .replace(INVISIBLE, "")
    .replace(HYPHEN_BREAK, "")
    .normalize("NFC")
    .toLowerCase();
}

export interface FlatPaper {
  paper: PaperDTO;
  /** 뿌리 서가부터의 이름. 깊이가 두 단으로 고정이라 1칸 아니면 2칸이다. */
  path: string[];
  /** 사람이 읽는 그대로의 태그. 칩 목록을 만들 때 쓴다. */
  tags: string[];
  /** 칩 대조용으로 눕힌 태그. */
  tagKeys: string[];
  /**
   * 칸마다 미리 눕혀 둔 찾기용 글자. **이게 이 파일의 핵심이다.**
   *
   * 초록은 한 편에 수 KB 다. 키를 칠 때마다 500편의 초록에 `normalize()` 와
   * `toLowerCase()` 를 돌리면 그것만으로 한 프레임이 날아간다. 서재가 바뀔
   * 때 한 번만 눕혀 두면, 이후 판정은 눕은 문자열에 `includes()` 하는 것뿐이다.
   */
  hay: Record<FrontField, string>;
}

function flatOne(paper: PaperDTO, path: string[]): FlatPaper {
  const tags = (paper.tags ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  return {
    paper,
    path,
    tags,
    tagKeys: tags.map(normalizeForSearch),
    hay: {
      title: normalizeForSearch(paper.title),
      authors: normalizeForSearch(paper.authors ?? ""),
      venue: normalizeForSearch(paper.venue ?? ""),
      year: paper.year != null ? String(paper.year) : "",
      doi: normalizeForSearch(paper.doi ?? ""),
      arxiv: normalizeForSearch(paper.arxivId ?? ""),
      tags: normalizeForSearch(tags.join(" ")),
      abstract: normalizeForSearch(paper.abstract ?? ""),
    },
  };
}

/**
 * 서재를 한 줄로 눕힌다. 서가 차례 · 서가 안 논문 · 그 다음 칸들 차례다.
 *
 * 결과 목록은 **늘 이 배열에서 파생시킨다.** 따로 스냅샷을 들면 4초마다
 * 도는 폴링(`library.tsx` 의 `agentRev`)이 서재를 갈아 끼운 뒤에도 지워진
 * 논문이 결과에 남는다.
 */
export function flattenLibrary(groups: GroupDTO[]): FlatPaper[] {
  const out: FlatPaper[] = [];
  for (const g of groups) {
    for (const p of g.papers) out.push(flatOne(p, [g.name]));
    for (const c of g.children) {
      for (const p of c.papers) out.push(flatOne(p, [g.name, c.name]));
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
//   질의
// ─────────────────────────────────────────────────────────────

/**
 * 질의를 낱말로 나눈다. 공백으로 끊고, 눕히고, 같은 낱말은 한 번만 본다.
 *
 * 낱말이 **전부** 있어야 맞는다(AND). 그런데 "한 칸 안에 전부" 는 아니다 —
 * `matchFront` 를 보라.
 */
export function queryWords(query: string): string[] {
  const seen = new Set<string>();
  for (const w of normalizeForSearch(query).split(/\s+/)) {
    if (w) seen.add(w);
  }
  return [...seen];
}

/**
 * 같은 질의를 **사람이 친 글자 그대로** 낱말로 나눈다. `queryWords` 의 쌍둥이다.
 *
 * 왜 둘이 필요한가. `queryWords` 는 접은 **뒤에** 나누므로 사람이 친 표기를
 * 잃는다. 그런데 질의를 상한 안으로 줄이는 자리(`client-api.ts` 의 `clipQuery`)
 * 는 사람이 친 글자를 그대로 보내야 하고, 그러면서도 **`queryWords` 와 같은
 * 자리에서 나눠야** 한다. 나누는 자리가 갈리면 서버가 사람이 친 적 없는 낱말로
 * 찾게 된다.
 *
 * 그래서 접기가 지우는 둘을 여기서도 "낱말 안" 으로 친다 — 줄 끝 하이픈
 * (`trans-\nformer` 는 한 낱말이다)과 안 보이는 글자(U+FEFF 는 `\s` 에 들어
 * 있어서, 무심코 공백으로 나누면 `mo<U+FEFF>del` 이 두 낱말이 된다).
 * 갈래를 앞에 두는 것이 요점이다: `[^\s]` 를 먼저 놓으면 `-` 를 삼킨 뒤
 * 줄바꿈에서 멈춰 `trans-` 로 끊긴다.
 *
 * 붙는 성질: `rawQueryWords(q).map(normalizeForSearch)` 에서 빈 것을 뺀 것이
 * `queryWords(q)` 와 같다. 이게 깨지면 부분집합 성질이 깨진다.
 */
const QUERY_WORD = /(?:[-‐‑][ \t]*\r?\n[ \t]*|\p{Cf}|[^\s])+/gu;

export function rawQueryWords(query: string): string[] {
  return query.match(QUERY_WORD) ?? [];
}

/**
 * 앞(즉시) 판정 — **서버 답을 기다리는 동안 쓰는 임시 답.**
 *
 * 낱말 하나하나가 **여덟 칸 중 어디엔가는** 있어야 하고, 그런 낱말이 전부여야
 * 맞는다. 칸을 가로질러 인정하는 이유: `attention 2017` 을 치는 사람은 제목에
 * "attention", 연도에 "2017" 인 논문을 찾는 것이지 한 칸에 둘 다 든 논문을
 * 찾는 것이 아니다. 칸마다 따로 AND 를 걸면 이 흔한 질의가 하나도 안 맞는다.
 *
 * 판정 규칙이 서버(열한 자리)와 **같은 모양**이고 보는 자리만 좁다. 접는
 * 규칙도 같다 — 눕힌 글자(`hay`)와 눕힌 낱말(`queryWords`)이 둘 다
 * `normalizeForSearch` 를 지났고, 서버도 저장값을 같은 함수로 접어 둔 뒤
 * 같은 `includes` 로 견준다.
 * 그래서 여기서 맞은 것은 서버 답에도 반드시 들어 있다 — 이 성질이 있어야
 * 답이 왔을 때 줄이 사라지지 않는다. 규칙을 여기서만 바꾸면 그 성질이 깨진다.
 *
 * 돌려주는 것은 **낱말 중 하나라도 맞은 칸 전부**다 (`FRONT_FIELDS` 차례).
 * 하나도 못 맞으면 `null` — 빈 배열과 구별해야 한다. 빈 배열은 "질의 없이
 * 칩만으로 걸러진 줄" 이라는 다른 뜻으로 쓴다.
 */
export function matchFront(flat: FlatPaper, words: string[]): FrontField[] | null {
  const hit = new Set<FrontField>();
  for (const w of words) {
    let any = false;
    for (const f of FRONT_FIELDS) {
      if (flat.hay[f].includes(w)) {
        hit.add(f);
        any = true;
      }
    }
    if (!any) return null;
  }
  return FRONT_FIELDS.filter((f) => hit.has(f));
}

// ─────────────────────────────────────────────────────────────
//   칩
// ─────────────────────────────────────────────────────────────

/**
 * 켜 둔 칩.
 *
 * **묶음 안에서는 OR, 묶음끼리는 AND.** "안 읽음이거나 읽는 중" 이면서
 * "별표" 인 것 — 이게 사람이 칩을 눌러 기대하는 뜻이다. 묶음 안에서도 AND
 * 를 걸면 읽기 상태 칩 두 개를 켜는 순간 결과가 반드시 0이 되어, 칩이
 * 고장 난 것처럼 보인다.
 *
 * 태그는 **사람이 보는 글자 그대로** 담는다. 눕힌 키로 담지 않는 것은 이 값이
 * 주소에도 실리고(`?tag=`) 서재에서 사라진 태그의 칩에 그대로 쓰이기 때문이다 —
 * 눕혀 담으면 대문자로 쓰던 태그가 주소를 한 번 거치고 나면 소문자로 바뀐다.
 *
 * 대신 **견주는 것은 늘 눕힌 키다** (`hasTag` · `toggleTag` · `matchChips`).
 * 표기로 견주면 서재의 표기가 바뀌는 순간 켜 둔 칩을 못 끄게 된다.
 */
export interface Chips {
  read: ReadState[];
  marks: PaperMark[];
  tags: string[];
}

export const EMPTY_CHIPS: Chips = { read: [], marks: [], tags: [] };

/** 켜진 칩 개수. 0 이면 칩은 아무것도 안 거른다. */
export function chipCount(c: Chips): number {
  return c.read.length + c.marks.length + c.tags.length;
}

/** 켜 둔 태그 칩을 눕힌 키로. 논문마다 다시 눕히지 않으려고 따로 뽑는다. */
export function chipTagKeys(c: Chips): string[] {
  return c.tags.map(normalizeForSearch);
}

/**
 * `tagKeys` 는 `chipTagKeys(c)` 를 미리 뽑아 둔 것이다.
 *
 * 안 넘기면 그 자리에서 뽑는다(그전과 같다). 목록 전체를 도는 자리에서는
 * 반드시 넘겨라 — 안 넘기면 논문 500편마다 켜 둔 칩을 다시 눕힌다.
 */
export function matchChips(flat: FlatPaper, c: Chips, tagKeys?: string[]): boolean {
  if (c.read.length > 0 && !c.read.includes(flat.paper.readState)) return false;
  if (c.marks.length > 0) {
    const m = flat.paper.mark;
    if (m === null || !c.marks.includes(m)) return false;
  }
  if (c.tags.length > 0) {
    const want = tagKeys ?? chipTagKeys(c);
    if (!want.some((t) => flat.tagKeys.includes(t))) return false;
  }
  return true;
}

/** 칩 하나를 켜고 끈다. 배열을 새로 만든다 — 상태를 제자리에서 고치지 않는다. */
export function toggleIn<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/** 켜 둔 태그인가. **표기가 달라도 눕힌 키가 같으면 같은 태그다.** */
export function hasTag(tags: readonly string[], tag: string): boolean {
  const key = normalizeForSearch(tag);
  return tags.some((t) => normalizeForSearch(t) === key);
}

/**
 * 태그 칩 하나를 켜고 끈다. `toggleIn` 과 달리 **눕힌 키로** 찾아 끈다.
 *
 * 글자 그대로 견주면(`toggleIn`) 켜 둘 때의 표기와 지금 칩에 적힌 표기가
 * 다른 순간 — 서재의 표기가 `RL` 에서 `rl` 로 바뀌었을 때 — 끄려고 누른 것이
 * 같은 태그를 **하나 더 켜는** 일이 된다. 그러면 거르개는 그대로인데 칩만
 * 늘어나 영영 못 끈다.
 */
export function toggleTag(tags: string[], tag: string): string[] {
  const key = normalizeForSearch(tag);
  const without = tags.filter((t) => normalizeForSearch(t) !== key);
  return without.length === tags.length ? [...tags, tag] : without;
}

export interface TagOption {
  /** 화면에 보이는 표기. */
  tag: string;
  /** 눕힌 키. 켜졌는지 견주는 것은 늘 이 값이다. */
  key: string;
  /** 지금 서재에서 이 태그를 단 논문 수. **0 이면 켜 두기만 하고 서재에는 없다.** */
  count: number;
}

/**
 * 칩으로 내놓을 태그 — 서재에 있는 것 **+ 지금 켜 둔 것.**
 *
 * 눕힌 글자로 묶는 것은 대소문자만 다른 같은 태그가 두 칩이 되는 것을 막으려는
 * 것이고, 그 자체는 옳다. 문제는 묶은 뒤 **표기 하나만** 내놓는다는 데 있었다.
 * 그 표기를 가진 논문이 지워지거나 태그가 고쳐지면 칩은 목록에서 사라지는데,
 * 거르개(`matchChips`)는 눕힌 키로 견주므로 **살아 있다.** 끌 단추가 없는
 * 거르개가 남고, "켜 둔 칩을 꺼 보세요" 라는 안내가 가리킬 칩이 화면에 없다.
 *
 * 그래서 켜 둔 것은 서재에서 사라져도 `count: 0` 으로 남긴다. 0편이라는 숫자가
 * "지금 서재에 없다" 를 그대로 말해 주고, 누르면 꺼진다.
 *
 * 켜 둔 칩과 서재의 표기가 다를 때는 **서재의 표기**를 보인다. 화면 다른 곳
 * (논문 줄의 태그)에 적히는 글자와 같아야 같은 것으로 읽히기 때문이다. 켜졌는지는
 * 눕힌 키로 보므로 표기가 달라도 칩은 켜진 채로 보이고 눌러 끌 수 있다.
 * 서재에 아예 없는 태그일 때만 사람이 켤 때 쓴 표기를 그대로 쓴다.
 *
 * 차례는 많이 쓰인 순, 같으면 이름 순. 0편은 자연히 맨 뒤로 가는데, 접어 둔
 * 자리에 숨어 못 끄는 일이 없도록 **펼치는 쪽은 부르는 화면이 따로 챙긴다.**
 */
export function collectTags(flats: FlatPaper[], active: readonly string[] = []): TagOption[] {
  const byKey = new Map<string, TagOption>();
  for (const f of flats) {
    for (let i = 0; i < f.tags.length; i++) {
      const key = f.tagKeys[i];
      const found = byKey.get(key);
      if (found) found.count += 1;
      else byKey.set(key, { tag: f.tags[i], key, count: 1 });
    }
  }
  for (const tag of active) {
    const key = normalizeForSearch(tag);
    if (!key || byKey.has(key)) continue;
    byKey.set(key, { tag, key, count: 0 });
  }
  return [...byKey.values()].sort(
    (a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "ko"),
  );
}
