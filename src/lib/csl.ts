/*
 * CSL-JSON 을 다루는 순수 함수들 — 우리 컬럼과의 왕복, 그리고 BibTeX·RIS 로 내보내기.
 *
 * 왜 원본(CSL-JSON)을 따로 들고 있는가.
 *
 * 우리 컬럼(title/authors/venue/year…)은 **사람이 보고 고치라고** 있는 납작한
 * 모양이다. 저자의 성/이름 구분, 편집자, 권·호·쪽, 학회가 열린 도시 같은 것은
 * 거기 담을 자리가 아예 없다. 한 줄로 눌러 담는 순간 되살릴 길이 사라진다 —
 * "Vaswani, Shazeer" 를 다시 성과 이름으로 가르는 것은 사람 이름을 아는 일이라
 * 규칙으로 못 한다. BibTeX 로 내보낼 때 필요한 것이 바로 그 잃어버린 것들이다.
 * 그래서 받아 온 그대로도 `papers.csl` 에 남긴다.
 *
 * 두 벌을 들고 있으므로 **누가 이기는지**를 정해 둬야 한다. 사람이 고친 우리
 * 컬럼이 이긴다(`toCSL` 이 그 규칙을 담는다). csl 은 사람이 손대지 않은 칸을
 * 채우고, 애초에 우리 컬럼에 자리가 없던 것들을 공급한다.
 *
 * 이 파일은 DB 도 fetch 도 건드리지 않는다. 서버 라우트와 브라우저가 함께 쓴다.
 */

// ─────────────────────────────────────────────────────────────
//   CSL-JSON 모양
// ─────────────────────────────────────────────────────────────

export interface CSLName {
  family?: string;
  given?: string;
  /** 기관 저자처럼 성/이름으로 안 갈라지는 것. */
  literal?: string;
  "non-dropping-particle"?: string;
  suffix?: string;
}

export interface CSLDate {
  /** `[[2017, 6, 12]]`. 뒤로 갈수록 생략될 수 있다. */
  "date-parts"?: (number | string)[][];
  raw?: string;
  literal?: string;
}

/**
 * 우리가 실제로 읽고 쓰는 칸만 적는다. CSL 명세는 이보다 훨씬 넓고, 모르는
 * 칸이 들어와도 **버리지 않는다** — 인덱스 시그니처로 그대로 통과시킨다.
 * 언젠가 다른 형식으로 내보낼 때 그 칸들이 필요해진다.
 */
export interface CSLItem {
  id?: string;
  type?: string;
  title?: string;
  author?: CSLName[];
  editor?: CSLName[];
  "container-title"?: string;
  "collection-title"?: string;
  event?: string;
  "event-title"?: string;
  "event-place"?: string;
  publisher?: string;
  "publisher-place"?: string;
  volume?: string;
  issue?: string;
  page?: string;
  "number-of-pages"?: string;
  number?: string;
  edition?: string;
  DOI?: string;
  URL?: string;
  ISSN?: string;
  ISBN?: string;
  issued?: CSLDate;
  abstract?: string;
  note?: string;
  keyword?: string;
  language?: string;
  /**
   * CSL-JSON 이 남겨 둔 확장 자리. citeproc 은 통째로 무시한다.
   * arXiv 번호처럼 표준 칸이 없는 것을 여기 둔다 — `note` 에 섞어 넣으면
   * 다시 꺼낼 때 글자를 헤집어야 한다.
   */
  custom?: { arxivId?: string; primaryClass?: string; [k: string]: unknown };
  [k: string]: unknown;
}

/** 우리 컬럼으로 눌러 담은 값. 시트가 칸마다 제안으로 보여 주는 것이 이것이다. */
export interface BibFields {
  title: string | null;
  authors: string | null;
  venue: string | null;
  year: number | null;
  doi: string | null;
  arxivId: string | null;
  abstract: string | null;
  url: string | null;
}

/** `toCSL` 이 받는 최소한. PaperRow 도 PaperDTO+csl 도 그대로 들어맞는다. */
export interface PaperLike {
  id?: string;
  title: string;
  authors: string | null;
  venue: string | null;
  year: number | null;
  doi: string | null;
  arxivId: string | null;
  abstract: string | null;
  url: string | null;
  /** DB 에 든 CSL-JSON 문자열. 없을 수 있다 — 손으로 적어 넣은 논문. */
  csl?: string | null;
}

export const EXPORT_FORMATS = ["bibtex", "ris", "csl"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const EXPORT_EXT: Record<ExportFormat, string> = {
  bibtex: "bib",
  ris: "ris",
  csl: "json",
};

export const EXPORT_MIME: Record<ExportFormat, string> = {
  // text/plain 으로 준다. application/x-bibtex 는 브라우저마다 다루는 법이 달라
  // 어떤 곳에서는 내려받기 대신 알 수 없는 파일 대화상자가 뜬다.
  bibtex: "text/plain; charset=utf-8",
  ris: "application/x-research-info-systems; charset=utf-8",
  csl: "application/json; charset=utf-8",
};

// ─────────────────────────────────────────────────────────────
//   읽기 — CSL → 우리 컬럼
// ─────────────────────────────────────────────────────────────

/** 깨진 JSON 이 논문 한 편을 통째로 못 쓰게 만들면 안 된다. 조용히 null 이 된다. */
export function parseCsl(raw: string | null | undefined): CSLItem | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    return v as CSLItem;
  } catch {
    return null;
  }
}

function clean(s: unknown): string | null {
  if (typeof s !== "string") return null;
  // 줄바꿈이 섞인 값이 흔하다 (Crossref 초록, arXiv 제목이 두 줄로 온다).
  // BibTeX·RIS 는 한 줄을 기대하므로 여기서 한 번에 눌러 둔다.
  const t = s.replace(/\s+/g, " ").trim();
  return t || null;
}

/** 한 사람 이름을 사람이 읽는 모양으로. */
export function nameOf(n: CSLName): string {
  if (n.literal) return n.literal.trim();
  const family = [n["non-dropping-particle"], n.family].filter(Boolean).join(" ").trim();
  if (family) return [family, n.suffix].filter(Boolean).join(" ").trim();
  return (n.given ?? "").trim();
}

/**
 * 저자 한 줄. **성만** 잇는다.
 *
 * 시트의 예시가 "Vaswani, Shazeer, Parmar…" 이고 서가 카드에 한 줄로 들어가야
 * 하므로 이름까지 넣으면 금세 넘친다. 이름을 잃는 것이 아깝지 않은 이유는
 * 원본 csl 이 그대로 남아 있기 때문이다 — 내보낼 때는 csl 을 쓴다.
 */
export function authorsLine(list: CSLName[] | undefined): string | null {
  if (!list?.length) return null;
  const parts = list
    .map((n) => (n.literal ? n.literal.trim() : (n.family ?? n.given ?? "").trim()))
    .filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

export function yearOf(d: CSLDate | undefined): number | null {
  const first = d?.["date-parts"]?.[0]?.[0];
  const n = typeof first === "string" ? Number.parseInt(first, 10) : first;
  if (typeof n === "number" && Number.isFinite(n) && n >= 1000 && n <= 3000) return n;
  // date-parts 가 없고 raw 만 오는 곳이 있다 (일부 DOI 등록기관).
  const m = /\b(1\d{3}|2\d{3}|3000)\b/.exec(`${d?.raw ?? ""} ${d?.literal ?? ""}`);
  return m ? Number(m[1]) : null;
}

function monthOf(d: CSLDate | undefined): number | null {
  const m = d?.["date-parts"]?.[0]?.[1];
  const n = typeof m === "string" ? Number.parseInt(m, 10) : m;
  return typeof n === "number" && n >= 1 && n <= 12 ? n : null;
}

/** 실릴 곳. 저널이 없으면 학회, 그것도 없으면 총서·출판사 순으로 물러선다. */
export function venueOf(item: CSLItem): string | null {
  return (
    clean(item["container-title"]) ??
    clean(item["event-title"]) ??
    clean(item.event) ??
    clean(item["collection-title"]) ??
    clean(item.publisher)
  );
}

const ARXIV_DOI = /^10\.48550\/arxiv\.(.+)$/i;
const ARXIV_URL = /arxiv\.org\/(?:abs|pdf)\/([^\s?#]+?)(?:\.pdf)?$/i;

/**
 * arXiv 번호 캐내기.
 *
 * arXiv 는 CSL 표준 칸이 없다. 그래서 네 군데를 뒤진다 — 우리가 붙인 `custom`,
 * DataCite 가 매기는 `10.48550/arXiv.…` DOI, URL, 그리고 `number`.
 */
export function arxivIdOf(item: CSLItem): string | null {
  const c = clean(item.custom?.arxivId);
  if (c) return c;

  const doi = clean(item.DOI);
  const byDoi = doi && ARXIV_DOI.exec(doi);
  if (byDoi) return byDoi[1];

  const url = clean(item.URL);
  const byUrl = url && ARXIV_URL.exec(url);
  if (byUrl) return byUrl[1];

  if (/arxiv/i.test(String(item.publisher ?? "")) || /arxiv/i.test(String(item["container-title"] ?? ""))) {
    const num = clean(item.number);
    if (num) return num.replace(/^arxiv:/i, "");
  }
  return null;
}

/** CSL 한 덩어리를 우리 컬럼 모양으로 눌러 담는다. */
export function cslToFields(item: CSLItem): BibFields {
  return {
    title: clean(item.title),
    authors: authorsLine(item.author),
    venue: venueOf(item),
    year: yearOf(item.issued),
    doi: clean(item.DOI),
    arxivId: arxivIdOf(item),
    abstract: clean(item.abstract),
    url: clean(item.URL),
  };
}

// ─────────────────────────────────────────────────────────────
//   쓰기 — 우리 논문 → CSL
// ─────────────────────────────────────────────────────────────

/**
 * 한 줄짜리 저자 문자열을 이름 목록으로 되돌린다. **되돌리기는 어림짐작이다.**
 *
 * "Vaswani, Shazeer" 가 두 사람인지 한 사람("성, 이름")인지 글자만 봐서는 모른다.
 * 그래서 성/이름으로 가르지 않고 통째로 `literal` 에 넣는다. BibTeX 로 나갈 때
 * `{Vaswani}` 처럼 중괄호에 싸여 그대로 보존되므로, 적어도 **틀리게 갈라지지는
 * 않는다.** 제대로 갈린 이름이 필요하면 그건 원본 csl 이 들고 있다 —
 * 이 함수는 사람이 손으로 고쳐서 원본과 어긋났을 때만 불린다.
 */
export function parseAuthorsLine(line: string | null): CSLName[] | undefined {
  const t = line?.trim();
  if (!t) return undefined;
  const parts = t
    .split(/\s*[;·]\s*|\s*,\s*|\s+and\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts.map((literal) => ({ literal })) : undefined;
}

const CONFERENCE_HINT =
  /\b(proc\.?|proceedings|conference|conf\.?|workshop|symposium|meeting|NeurIPS|NIPS|ICML|ICLR|CVPR|ICCV|ECCV|ACL|EMNLP|NAACL|AAAI|IJCAI|SIGGRAPH|CHI|KDD|WWW|OSDI|SOSP|USENIX)\b/i;

/** 실릴 곳만 보고 갈래를 짐작한다. BibTeX 항목 종류가 여기서 갈린다. */
function guessType(f: { venue: string | null; arxivId: string | null }): string {
  if (f.venue && CONFERENCE_HINT.test(f.venue)) return "paper-conference";
  if (f.venue) return "article-journal";
  if (f.arxivId) return "article"; // 아직 출판 전 — @misc + eprint 로 나간다
  return "document";
}

/**
 * 논문 한 편을 내보낼 수 있는 CSL 한 덩어리로.
 *
 * 저장된 csl 이 있으면 그것을 바탕으로 깔고, **사람이 고친 우리 컬럼을 위에
 * 덮는다.** 순서가 반대면 사람이 고쳐 놓은 제목이 내보내기에서 되살아나지
 * 않는다 — 고친 이유가 원본이 틀렸기 때문인데 말이다.
 *
 * 다만 저자만은 조심한다. 우리 컬럼의 저자 줄이 csl 에서 뽑아 낸 줄과 **같으면**
 * 사람이 손대지 않은 것이므로 성/이름이 갈린 원본을 그대로 둔다. 다를 때만
 * 어림짐작으로 되돌린다.
 */
export function toCSL(paper: PaperLike): CSLItem {
  const base = parseCsl(paper.csl) ?? {};
  const item: CSLItem = { ...base };

  const title = clean(paper.title);
  if (title) item.title = title;

  const authors = clean(paper.authors);
  if (authors && authors !== authorsLine(base.author)) {
    item.author = parseAuthorsLine(authors);
  } else if (!base.author && authors) {
    item.author = parseAuthorsLine(authors);
  }

  const venue = clean(paper.venue);
  if (venue && venue !== venueOf(base)) {
    // 어느 칸에 넣을지는 원본이 쓰던 칸을 따른다. 학회 논문의 booktitle 이
    // 갑자기 journal 로 옮겨 가면 내보낸 항목의 종류가 통째로 바뀐다.
    if (base["event-title"] && !base["container-title"]) item["event-title"] = venue;
    else item["container-title"] = venue;
  }

  if (paper.year != null && paper.year !== yearOf(base.issued)) {
    item.issued = { "date-parts": [[paper.year]] };
  }

  const doi = clean(paper.doi);
  if (doi) item.DOI = doi;
  const url = clean(paper.url);
  if (url) item.URL = url;
  const abstract = clean(paper.abstract);
  if (abstract) item.abstract = abstract;

  const arxivId = clean(paper.arxivId);
  if (arxivId) item.custom = { ...(item.custom ?? {}), arxivId };

  if (!item.type) {
    item.type = guessType({ venue: venueOf(item), arxivId: arxivIdOf(item) });
  }
  if (paper.id) item.id = String(paper.id);
  return item;
}

// ─────────────────────────────────────────────────────────────
//   인용 키
// ─────────────────────────────────────────────────────────────

/**
 * 키에서 빼는 흔한 첫 단어들.
 *
 * "성연도첫단어" 를 글자 그대로 지키면 `smith2020the` 같은 키가 나온다.
 * 사람이 본문에서 쳐 넣을 이름인데 아무것도 알려 주지 않는다.
 */
const KEY_STOPWORDS = new Set([
  "a", "an", "the", "on", "of", "in", "for", "to", "and", "is", "are", "with",
  "at", "by", "from", "into", "over", "using", "towards", "toward",
]);

/**
 * NFD 로 풀었을 때 떨어져 나오는 결합 악센트 (U+0300–U+036F).
 *
 * 소스에 그 글자를 직접 적지 않는다. 결합 문자라 편집기에서는 앞 글자에 달라
 * 붙어 보이고, 정규식 안에 있으면 사람이 범위를 잘못 읽는다.
 */
const COMBINING_MARKS = new RegExp("[\u0300-\u036f]", "g");

function asciiSlug(s: string): string {
  return (
    s
      // 라틴 확장 문자를 벗긴다 — Müller → muller. BibTeX 키에 비ASCII 가 들어가면
      // 오래된 bibtex 가 조용히 항목을 통째로 건너뛴다.
      .normalize("NFD")
      .replace(COMBINING_MARKS, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
  );
}

/** `vaswani2017attention`. 겹칠 수 있다 — 겹침 처리는 `assignKeys` 가 한다. */
export function bibKey(item: CSLItem): string {
  const first = item.author?.[0] ?? item.editor?.[0];
  const family = first ? asciiSlug(first.family ?? first.literal?.split(/[\s,]+/)[0] ?? "") : "";
  const year = yearOf(item.issued);
  const word =
    (clean(item.title) ?? "")
      .split(/\s+/)
      .map((w) => asciiSlug(w))
      .find((w) => w.length > 1 && !KEY_STOPWORDS.has(w)) ?? "";
  /*
   * 성도 첫 단어도 비는 일이 있다. 한글 논문이 그렇다 — `asciiSlug` 가
   * 비ASCII 를 전부 벗기므로 "홍길동" 도 "손으로" 도 빈 문자열이 된다.
   * 그대로 두면 키가 `2020` 이 되어, 무엇을 가리키는지 알 수 없는 데다
   * 같은 해의 다른 논문과 곧바로 겹친다. 그래서 `paper` 를 세워 둔다.
   */
  const stem = family || word ? `${family}${year ?? "nd"}${word}` : `paper${year ?? "nd"}`;
  return stem;
}

/** 0→a, 1→b … 25→z, 26→aa. 겹친 키 뒤에 붙는다. */
function suffix(n: number): string {
  let s = "";
  let i = n;
  do {
    s = String.fromCharCode(97 + (i % 26)) + s;
    i = Math.floor(i / 26) - 1;
  } while (i >= 0);
  return s;
}

/**
 * 목록 전체의 키를 한 번에 매긴다. 겹치면 뒤에 a/b/c.
 *
 * 한 편씩 따로 매기면 절대 알 수 없다 — 겹침은 **둘을 나란히 놓아야** 보인다.
 * 그래서 내보내기는 항상 목록 단위로 부른다.
 */
export function assignKeys(items: CSLItem[]): string[] {
  const groups = new Map<string, number[]>();
  const base = items.map((it) => bibKey(it));
  base.forEach((k, i) => {
    const g = groups.get(k);
    if (g) g.push(i);
    else groups.set(k, [i]);
  });

  const out = [...base];
  for (const [k, idxs] of groups) {
    if (idxs.length < 2) continue;
    idxs.forEach((idx, n) => {
      out[idx] = `${k}${suffix(n)}`;
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
//   BibTeX
// ─────────────────────────────────────────────────────────────

/**
 * BibTeX 가 뜻을 갖는 글자들. **순서가 중요하다** — 역슬래시를 먼저 바꾸지
 * 않으면 뒤에서 우리가 넣은 역슬래시를 또 바꾼다.
 */
const BIB_ESCAPES: [RegExp, string][] = [
  [/\\/g, "\\textbackslash{}"],
  [/\{/g, "\\{"],
  [/\}/g, "\\}"],
  [/\$/g, "\\$"],
  [/&/g, "\\&"],
  [/%/g, "\\%"],
  [/#/g, "\\#"],
  [/_/g, "\\_"],
  [/~/g, "\\textasciitilde{}"],
  [/\^/g, "\\textasciicircum{}"],
];

export function escapeBib(s: string): string {
  let out = s;
  for (const [re, to] of BIB_ESCAPES) out = out.replace(re, to);
  return out;
}

/**
 * 제목의 대문자를 지킨다.
 *
 * **이걸 빠뜨리면 제목이 조용히 뭉개진다.** 대부분의 서지 스타일(특히
 * `plain`, `abbrv`, APA 계열)은 제목을 문장 표기로 바꾸려고 소문자로 내린다.
 * 그러면 "BERT: Pre-training of Deep Bidirectional Transformers" 가
 * "Bert: pre-training of deep bidirectional transformers" 로 나온다.
 * 논문 이름이 틀리게 인쇄되는 것이고, 되돌릴 방법도 없다.
 *
 * 제목 전체를 중괄호로 한 번 더 싸면(`{{…}}`) 확실히 막히지만 그건 반대쪽으로
 * 지나치다 — 스타일이 정한 표기를 통째로 무시하게 된다. 그래서 **지켜야 하는
 * 낱말만** 싼다: 첫 글자 말고 다른 자리에 대문자가 있는 것(BERT, LaTeX,
 * ImageNet, GPT-4). 평범한 Title Case 낱말은 스타일이 알아서 하도록 둔다.
 * (Zotero 의 Better BibTeX 도 같은 규칙이다.)
 *
 * 못 잡는 것이 하나 남는다 — "Optuna" 처럼 첫 글자만 대문자인 **고유명사**다.
 * 글자만 봐서는 평범한 낱말과 구별되지 않아 규칙으로 잡을 방법이 없다.
 * 문장 표기 스타일에서는 "optuna" 로 찍힌다. 그게 거슬리면 사람이 .bib 에서
 * 그 낱말만 중괄호로 싸면 된다.
 */
export function protectCase(s: string): string {
  return s
    .split(" ")
    .map((word) => {
      if (!word) return word;
      // 이미 우리가 넣은 이스케이프 명령이 든 낱말은 건드리지 않는다.
      if (word.includes("\\")) return word;
      const rest = word.slice(1);
      return /[A-Z]/.test(rest) ? `{${word}}` : word;
    })
    .join(" ");
}

/*
 * CSL 갈래 → BibTeX 항목 종류.
 *
 * Crossref 가 쓰는 제 이름(`journal-article`, `proceedings-article`…)도 함께
 * 받아 둔다. `lookup.ts` 가 CSL 이름으로 고쳐 넣지만, 손으로 붙여 넣은 csl 이나
 * DataCite 가 준 것이 옛 이름으로 들어올 수 있다. 모르는 갈래는 `misc` 로
 * 떨어지는데 그러면 **저널 이름이 조용히 사라진다** — @misc 에는 journal 칸이
 * 없어서 우리가 안 싣는다.
 */
const BIB_TYPE: Record<string, string> = {
  "article-journal": "article",
  "journal-article": "article",
  "proceedings-article": "inproceedings",
  "book-chapter": "incollection",
  "posted-content": "misc",
  dissertation: "phdthesis",
  monograph: "book",
  /** CSL 의 `article` 은 "어디에도 안 실린 글" — 프리프린트가 여기 온다. */
  article: "misc",
  "article-magazine": "article",
  "article-newspaper": "article",
  "paper-conference": "inproceedings",
  chapter: "incollection",
  book: "book",
  thesis: "phdthesis",
  report: "techreport",
  manuscript: "unpublished",
  webpage: "misc",
  dataset: "misc",
  software: "misc",
  speech: "misc",
  document: "misc",
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function bibNames(list: CSLName[] | undefined): string | null {
  if (!list?.length) return null;
  return list
    .map((n) => {
      if (n.literal) {
        // 중괄호로 싸야 BibTeX 가 "성, 이름" 으로 가르려 들지 않는다.
        return `{${escapeBib(n.literal.trim())}}`;
      }
      const family = [n["non-dropping-particle"], n.family].filter(Boolean).join(" ").trim();
      const given = (n.given ?? "").trim();
      if (family && given) return `${escapeBib(family)}, ${escapeBib(given)}`;
      return `{${escapeBib(family || given)}}`;
    })
    .filter((s) => s !== "{}")
    .join(" and ");
}

/** "1-10" · "1–10" → "1--10". BibTeX 의 쪽 범위는 하이픈 둘이다. */
function bibPages(page: string | null): string | null {
  if (!page) return null;
  return page.replace(/\s*[-–—]+\s*/g, "--");
}

/**
 * CSL 한 덩어리를 BibTeX 항목 하나로.
 *
 * `key` 를 넘기지 않으면 혼자 만들어 쓴다. 목록으로 내보낼 때는 **반드시**
 * `assignKeys` 가 매긴 키를 넘겨라 — 안 그러면 겹친 키가 그대로 나가고,
 * LaTeX 는 나중 것으로 조용히 덮는다.
 */
export function toBibTeX(item: CSLItem, key?: string): string {
  const type = BIB_TYPE[item.type ?? ""] ?? "misc";
  const arxivId = arxivIdOf(item);
  const container = clean(item["container-title"]) ?? clean(item["event-title"]) ?? clean(item.event);
  const place = clean(item["publisher-place"]) ?? clean(item["event-place"]);

  const rows: [string, string | null][] = [];
  const put = (k: string, v: string | null | undefined, raw = false) => {
    const t = clean(v);
    if (t) rows.push([k, raw ? t : escapeBib(t)]);
  };
  /**
   * 이름이 실리는 칸. 제목과 **똑같이** 대문자를 지켜야 한다.
   *
   * 겪은 것: `booktitle` 을 그냥 넣었더니 "Proceedings of the 25th ACM SIGKDD
   * International Conference…" 가 스타일에 따라 "acm sigkdd" 로 찍혔다.
   * 학회 약자는 대문자가 곧 이름이라 뭉개지면 딴 학회가 된다.
   */
  const putName = (k: string, v: string | null | undefined) => {
    const t = clean(v);
    if (t) rows.push([k, protectCase(escapeBib(t))]);
  };

  rows.push(["author", bibNames(item.author)]);
  rows.push(["editor", bibNames(item.editor)]);

  const title = clean(item.title);
  if (title) rows.push(["title", protectCase(escapeBib(title))]);

  if (type === "article") putName("journal", container);
  else if (type === "inproceedings" || type === "incollection") putName("booktitle", container);
  else if (type === "misc" && container) putName("howpublished", container);

  if (type === "techreport") putName("institution", item.publisher);
  else if (type === "phdthesis") putName("school", item.publisher);
  else putName("publisher", item.publisher);

  put("address", place);
  putName("series", item["collection-title"]);
  put("volume", item.volume);
  put("number", item.issue ?? item.number);
  put("edition", item.edition);

  const pages = bibPages(clean(item.page));
  if (pages) rows.push(["pages", escapeBib(pages)]);

  const year = yearOf(item.issued);
  if (year != null) rows.push(["year", String(year)]);
  const month = monthOf(item.issued);
  // 월은 따옴표 없이 `jan` 같은 매크로로 쓴다 — 그래야 스타일이 언어에 맞게 편다.
  if (month != null) rows.push(["month", `@@${MONTHS[month - 1]}`]);

  put("issn", item.ISSN);
  put("isbn", item.ISBN);
  put("doi", item.DOI);
  // url 은 이스케이프하지 않는다. `_` 와 `~` 가 든 주소가 흔한데 `\_` 로 바꾸면
  // 그대로 인쇄되어 주소가 틀린다. \url{} 안에서는 원문이 맞다.
  put("url", item.URL, true);

  if (arxivId) {
    rows.push(["eprint", escapeBib(arxivId.replace(/v\d+$/, ""))]);
    rows.push(["archivePrefix", "arXiv"]);
    const pc = clean(item.custom?.primaryClass);
    if (pc) rows.push(["primaryClass", escapeBib(pc)]);
  }

  put("keywords", item.keyword);
  // 초록도 싣는다. 서지관리기가 다시 읽어 들이는 자리라, 여기서 버리면
  // 내보냈다 들여오는 것만으로 손으로 붙여 둔 초록이 사라진다.
  put("abstract", item.abstract);
  put("note", item.note);

  const body = rows
    .filter((r): r is [string, string] => Boolean(r[1]))
    .map(([k, v]) =>
      // `@@` 로 표시해 둔 것은 매크로라 중괄호를 씌우지 않는다.
      v.startsWith("@@") ? `  ${k.padEnd(13)} = ${v.slice(2)},` : `  ${k.padEnd(13)} = {${v}},`,
    )
    .join("\n");

  return `@${type}{${key ?? bibKey(item)},\n${body}\n}`;
}

// ─────────────────────────────────────────────────────────────
//   RIS
// ─────────────────────────────────────────────────────────────

const RIS_TYPE: Record<string, string> = {
  "article-journal": "JOUR",
  "journal-article": "JOUR",
  "proceedings-article": "CPAPER",
  "book-chapter": "CHAP",
  "posted-content": "UNPB",
  dissertation: "THES",
  monograph: "BOOK",
  article: "JOUR",
  "article-magazine": "MGZN",
  "article-newspaper": "NEWS",
  "paper-conference": "CPAPER",
  chapter: "CHAP",
  book: "BOOK",
  thesis: "THES",
  report: "RPRT",
  manuscript: "UNPB",
  webpage: "ELEC",
  dataset: "DATA",
  software: "COMP",
  document: "GEN",
};

function risName(n: CSLName): string {
  if (n.literal) return n.literal.trim();
  const family = [n["non-dropping-particle"], n.family].filter(Boolean).join(" ").trim();
  const given = (n.given ?? "").trim();
  // RIS 는 "성, 이름" 이 규칙이다. 뒤집으면 들여오는 쪽이 이름을 성으로 읽는다.
  return family && given ? `${family}, ${given}` : family || given;
}

/**
 * CSL 한 덩어리를 RIS 한 항목으로.
 *
 * RIS 는 `TAG  - 값` 이고 **가운데 공백이 둘**이다. 하나면 엄격한 파서가
 * 통째로 무시한다. 값에 줄바꿈이 있어도 안 된다 — `clean()` 이 이미 눌러 둔다.
 */
export function toRIS(item: CSLItem): string {
  const lines: string[] = [];
  const put = (tag: string, v: string | null | undefined) => {
    const t = clean(v);
    if (t) lines.push(`${tag.padEnd(2)}  - ${t}`);
  };

  lines.push(`TY  - ${RIS_TYPE[item.type ?? ""] ?? "GEN"}`);
  for (const a of item.author ?? []) put("AU", risName(a));
  for (const e of item.editor ?? []) put("A2", risName(e));
  put("TI", item.title);
  put("T2", venueOf(item));
  put("T3", item["collection-title"]);

  const year = yearOf(item.issued);
  if (year != null) {
    lines.push(`PY  - ${year}`);
    const month = monthOf(item.issued);
    // DA 는 `YYYY/MM/DD/` 다. 뒤 슬래시를 빼면 안 읽는 파서가 있다.
    lines.push(`DA  - ${year}/${month != null ? String(month).padStart(2, "0") : ""}//`);
  }

  put("VL", item.volume);
  put("IS", item.issue ?? item.number);

  const page = clean(item.page);
  if (page) {
    const [sp, ep] = page.split(/\s*[-–—]+\s*/);
    put("SP", sp);
    put("EP", ep);
  }

  put("PB", item.publisher);
  put("CY", item["publisher-place"] ?? item["event-place"]);
  put("SN", item.ISSN ?? item.ISBN);
  put("DO", item.DOI);
  put("UR", item.URL);
  put("AB", item.abstract);
  put("LA", item.language);
  for (const k of (clean(item.keyword) ?? "").split(/\s*,\s*/).filter(Boolean)) put("KW", k);

  const arxivId = arxivIdOf(item);
  if (arxivId) put("C1", `arXiv:${arxivId}`);
  put("N1", item.note);

  lines.push("ER  - ");
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────
//   목록 내보내기
// ─────────────────────────────────────────────────────────────

/**
 * 논문 여러 편을 한 덩어리 글로.
 *
 * **목록 단위로만 부른다.** BibTeX 키 겹침은 둘을 나란히 놓아야 보이기 때문에,
 * 한 편씩 만들어 이어 붙이면 겹친 키가 그대로 나간다.
 */
export function renderBibliography(papers: PaperLike[], format: ExportFormat): string {
  const items = papers.map((p) => toCSL(p));

  if (format === "csl") return `${JSON.stringify(items, null, 2)}\n`;
  if (format === "ris") return `${items.map((i) => toRIS(i)).join("\n\n")}\n`;

  const keys = assignKeys(items);
  return `${items.map((i, n) => toBibTeX(i, keys[n])).join("\n\n")}\n`;
}
