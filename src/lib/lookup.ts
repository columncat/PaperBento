/*
 * 바깥에서 서지정보를 찾아온다. DOI → arXiv → 제목 순.
 *
 * **컨테이너를 늘리지 않는다.** 세 곳 모두 인증이 없고 무료이며, 이 앱의 Node
 * 프로세스가 직접 부른다. Zotero 도 translation-server 도 들이지 않는다 —
 * 우리가 필요한 것은 "번역" 이 아니라 CSL-JSON 한 덩어리이고, 그건 콘텐츠
 * 협상만으로 온다.
 *
 * 세 길의 성격이 서로 다르다.
 *
 * 1. **DOI** — `doi.org` 에 `Accept: application/vnd.citationstyles.csl+json` 을
 *    붙이면 등록기관(Crossref·DataCite…)이 CSL-JSON 을 그대로 준다. 가장 정확하고
 *    한 번에 끝나며 후보가 하나뿐이다.
 * 2. **arXiv** — Atom XML 이라 뜯어야 한다. **XML 파서를 새로 들이지 않는다.**
 *    필요한 것이 열 칸 남짓이고, 그것 때문에 의존성을 하나 더 지는 것은 손해다.
 *    arXiv 응답에 DOI 가 있으면 1번으로 되돌아간다 — 출판본이 프리프린트보다
 *    정확하고, 사람이 인용하고 싶은 것도 그쪽이다.
 * 3. **제목** — Crossref 검색. 여러 후보가 나오고 1등이 맞다는 보장이 없다.
 *    그래서 **하나를 고르지 않는다.** 목록을 그대로 올려 보내고 사람이 고른다.
 *
 * 실패를 조용히 넘기지 않는다. 어느 길에서 무엇 때문에 넘어졌는지 `steps` 에
 * 담아 함께 돌려준다 — 빈 손으로 돌아왔을 때 "안 나옵니다" 만 보이면 사람이
 * 다음에 무엇을 해야 할지 알 수 없다.
 */

import {
  cslToFields,
  type BibFields,
  type CSLItem,
  type CSLName,
} from "./csl";

// ─────────────────────────────────────────────────────────────
//   모양
// ─────────────────────────────────────────────────────────────

export type LookupSource = "doi" | "arxiv" | "crossref";

export interface LookupResult {
  source: LookupSource;
  /** 받아 온 원본. 이것을 그대로 `papers.csl` 에 넣는다. */
  csl: CSLItem;
  /** 우리 컬럼으로 눌러 담은 값. 시트가 칸마다 제안으로 보여 준다. */
  fields: BibFields;
  /** 후보가 여럿일 때 견주라고 주는 점수. Crossref 만 준다. */
  score?: number;
}

export interface LookupStep {
  source: LookupSource;
  /** 무엇으로 물었는가. */
  query: string;
  ok: boolean;
  /** 무슨 일이 있었는지 한 문장. 화면이 그대로 보여 준다. */
  note: string;
}

export interface LookupReport {
  candidates: LookupResult[];
  /** 거쳐 온 길. 성공한 것도 실패한 것도 순서대로 담긴다. */
  steps: LookupStep[];
}

export interface LookupQuery {
  doi?: string | null;
  arxiv?: string | null;
  title?: string | null;
}

// ─────────────────────────────────────────────────────────────
//   바깥 요청의 규칙
// ─────────────────────────────────────────────────────────────

/**
 * 시간 제한. **없으면 안 된다.**
 *
 * doi.org 는 등록기관까지 넘겨 주는 구조라 저쪽이 느리면 그대로 끌려간다.
 * 라우트 하나가 몇 십 초를 붙들고 있으면 사람은 단추가 고장 난 줄 안다.
 */
const TIMEOUT_MS = 8000;

/**
 * 우리가 누구인지 밝힌다.
 *
 * Crossref 와 arXiv 모두 이름 없는 요청을 느린 큐로 보낸다. 밝히지 않으면
 * 차단당하는 것이 아니라 **조용히 느려진다** — 그게 더 알아채기 어렵다.
 */
const USER_AGENT = "PaperBento/0.1 (paper library; +https://github.com/paperbento)";

/**
 * Crossref 의 빠른 큐(`polite pool`)로 가는 표.
 *
 * `env.ts` 에 두지 않았다. 이 값은 없어도 그냥 가고(느린 큐로 갈 뿐) 오타가
 * 나도 눈에 띄는 고장을 만들지 않아서, 한 곳에서만 쓰는 지금은 여기 두는 편이
 * 읽기 쉽다. 다른 데서도 쓰게 되면 그때 `env.ts` 로 옮겨라.
 */
const CROSSREF_MAILTO = (process.env.CROSSREF_MAILTO ?? "").trim();

class LookupError extends Error {}

async function fetchText(url: string, accept: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { accept, "user-agent": USER_AGENT },
      // AbortSignal.timeout 은 응답 헤더뿐 아니라 본문 읽는 동안에도 살아 있다.
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
      redirect: "follow",
    });
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw new LookupError(`${TIMEOUT_MS / 1000}초 안에 답이 오지 않았습니다`);
    }
    throw new LookupError(`요청이 닿지 못했습니다 (${e instanceof Error ? e.message : "알 수 없음"})`);
  }

  if (res.status === 404) throw new LookupError("찾지 못했습니다 (404)");
  if (res.status === 406) {
    // 등록기관이 CSL-JSON 을 안 주는 경우. DOI 는 맞는데 모양이 없는 것이다.
    throw new LookupError("등록기관이 CSL-JSON 을 주지 않습니다 (406)");
  }
  if (res.status === 429) throw new LookupError("요청이 너무 잦습니다 (429). 잠시 뒤 다시 하세요");
  if (!res.ok) throw new LookupError(`서버가 거절했습니다 (HTTP ${res.status})`);

  return res.text();
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new LookupError("JSON 이 아닌 것이 돌아왔습니다");
  }
}

// ─────────────────────────────────────────────────────────────
//   식별자 다듬기
// ─────────────────────────────────────────────────────────────

/**
 * 사람이 붙여 넣는 것은 대개 DOI 자체가 아니다.
 *
 * `https://doi.org/10.…`, `doi:10.…`, 뒤에 붙은 마침표, 앞뒤 공백. 그대로 물으면
 * 전부 404 가 된다. 여기서 한 번 눌러 두면 시트도 라우트도 다시 안 챙겨도 된다.
 */
export function normalizeDoi(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .replace(/[.,;\s]+$/, "");
  return /^10\.\d{4,9}\/\S+$/.test(t) ? t : null;
}

/**
 * arXiv 번호 다듬기.
 *
 * 두 세대가 섞여 있다 — 2007년 4월 이후의 `2310.06825`(뒤에 `v3` 이 붙기도)와
 * 그 전의 `cs/0501001`, `math.GT/0309136`. 둘 다 받는다. 주소를 통째로 붙여
 * 넣는 경우도 흔해서 `abs/` 와 `pdf/` 를 함께 벗긴다.
 */
export function normalizeArxivId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let t = raw.trim();
  const fromUrl = /arxiv\.org\/(?:abs|pdf)\/([^\s?#]+)/i.exec(t);
  if (fromUrl) t = fromUrl[1];
  t = t
    .replace(/\.pdf$/i, "")
    .replace(/^arxiv:\s*/i, "")
    .replace(/[.,;\s]+$/, "");
  if (/^\d{4}\.\d{4,5}(v\d+)?$/.test(t)) return t;
  if (/^[a-z-]+(\.[A-Z]{2})?\/\d{7}(v\d+)?$/i.test(t)) return t;
  return null;
}

// ─────────────────────────────────────────────────────────────
//   받아 온 것 다듬기
// ─────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** XML/HTML 실체 참조를 되돌린다. arXiv 의 제목에 `&amp;` 가 흔하다. */
function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const n = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    if (body.startsWith("#")) {
      const n = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/**
 * Crossref 의 초록은 **JATS XML** 이다. 그대로 넣으면 `<jats:p>` 가 화면에 뜬다.
 * 태그를 공백으로 바꾸고(문단이 붙어 버리지 않게) 실체 참조를 되돌린다.
 */
function stripJats(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

/**
 * 제목·저널 이름을 다듬는다.
 *
 * **Crossref 는 CSL-JSON 안에도 HTML 을 그대로 넣는다.** 겪은 것: SIGKDD
 * 논문의 학회 이름이 `… Knowledge Discovery &amp; Data Mining` 으로 왔고,
 * 그게 BibTeX 로 `\&amp;` 가 되어 인쇄물에 "&amp;" 라고 찍혔다. 기울임을
 * 나타내는 `<i>`, 아래첨자 `<sub>` 도 섞여 온다.
 *
 * 태그는 공백 없이 지운다 — `<i>E. coli</i>-based` 가 "E. coli -based" 가 되면
 * 안 된다. 초록(`stripJats`)은 반대로 문단이 붙지 않게 공백으로 바꾼다.
 */
function cleanText(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

function firstString(v: unknown): string | undefined {
  if (typeof v === "string") return v.trim() || undefined;
  if (Array.isArray(v)) {
    for (const x of v) {
      const s = firstString(x);
      if (s) return s;
    }
  }
  return undefined;
}

function toNames(v: unknown): CSLName[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: CSLName[] = [];
  for (const raw of v) {
    if (typeof raw === "string") {
      out.push({ literal: raw });
      continue;
    }
    if (!raw || typeof raw !== "object") continue;
    const n = raw as Record<string, unknown>;
    const name: CSLName = {};
    if (typeof n.family === "string") name.family = n.family.trim();
    if (typeof n.given === "string") name.given = n.given.trim();
    if (typeof n.literal === "string") name.literal = n.literal.trim();
    if (typeof n.name === "string" && !name.family && !name.literal) {
      // Crossref 는 기관 저자를 `name` 으로 준다 (성/이름이 없다).
      name.literal = n.name.trim();
    }
    if (typeof n["non-dropping-particle"] === "string") {
      name["non-dropping-particle"] = n["non-dropping-particle"];
    }
    if (typeof n.suffix === "string") name.suffix = n.suffix;
    if (name.family || name.given || name.literal) out.push(name);
  }
  return out.length ? out : undefined;
}

/**
 * Crossref 가 쓰는 갈래 이름 → CSL 갈래 이름.
 *
 * 두 이름이 비슷하게 생겨서 그냥 통과시키고 싶어지는데, 그러면 BibTeX 로
 * 나갈 때 전부 `@misc` 가 된다. 저널 이름과 쪽 번호가 통째로 빠진 항목이
 * 나오고, 그건 인용으로 못 쓴다.
 */
const CROSSREF_TYPE: Record<string, string> = {
  "journal-article": "article-journal",
  "proceedings-article": "paper-conference",
  "book-chapter": "chapter",
  "book-part": "chapter",
  "book-section": "chapter",
  "reference-entry": "entry-encyclopedia",
  "posted-content": "article", // 프리프린트
  dissertation: "thesis",
  report: "report",
  "report-component": "report",
  book: "book",
  monograph: "book",
  "edited-book": "book",
  "reference-book": "book",
  dataset: "dataset",
  "journal-issue": "article-journal",
  "proceedings": "book",
  standard: "standard",
  component: "document",
  other: "document",
};

/**
 * 어디서 왔든 한 모양으로 눌러 둔다.
 *
 * doi.org 가 주는 것도 완전히 표준이 아니다 — 등록기관마다 `title` 을 배열로
 * 주거나, `container-title` 이 둘씩 오거나, `ISSN` 이 배열이다. 그대로 두면
 * `String(배열)` 이 "A,B" 가 되어 BibTeX 에 쉼표 섞인 저널 이름이 박힌다.
 */
function normalizeCsl(raw: unknown): CSLItem | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  const item: CSLItem = { ...(src as CSLItem) };

  const title = firstString(src.title);
  const subtitle = firstString(src.subtitle);
  if (title) {
    item.title = cleanText(subtitle && subtitle !== title ? `${title}: ${subtitle}` : title);
  } else delete item.title;
  delete item.subtitle;

  const container = firstString(src["container-title"]) ?? firstString(src["short-container-title"]);
  if (container) item["container-title"] = cleanText(container);
  else delete item["container-title"];
  delete item["short-container-title"];

  // 사람 눈에 보이는 글자는 HTML 이 섞여 오므로 `cleanText`, 번호·주소는 그대로.
  for (const k of ["collection-title", "publisher", "publisher-place"] as const) {
    const v = firstString(src[k]);
    if (v) (item as Record<string, unknown>)[k] = cleanText(v);
    else delete (item as Record<string, unknown>)[k];
  }
  for (const k of ["volume", "issue", "page", "number", "edition", "language", "URL"] as const) {
    const v = firstString(src[k]);
    if (v) (item as Record<string, unknown>)[k] = v;
    else delete (item as Record<string, unknown>)[k];
  }

  const issn = firstString(src.ISSN);
  if (issn) item.ISSN = issn;
  else delete item.ISSN;
  const isbn = firstString(src.ISBN);
  if (isbn) item.ISBN = isbn;
  else delete item.ISBN;

  const doi = firstString(src.DOI);
  if (doi) item.DOI = doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
  else delete item.DOI;

  const author = toNames(src.author);
  if (author) item.author = author;
  else delete item.author;
  const editor = toNames(src.editor);
  if (editor) item.editor = editor;
  else delete item.editor;

  /*
   * Crossref 의 `event` 는 객체다 (`{ name, location, start… }`).
   * CSL 은 글자 하나를 기대한다. 통째로 넣으면 "[object Object]" 가 나온다.
   */
  const ev = src.event;
  if (ev && typeof ev === "object" && !Array.isArray(ev)) {
    const e = ev as Record<string, unknown>;
    const name = firstString(e.name);
    const place = firstString(e.location);
    if (name) item["event-title"] = cleanText(name);
    if (place) item["event-place"] = cleanText(place);
    delete item.event;
  } else {
    const name = firstString(ev);
    if (name) item.event = cleanText(name);
    else delete item.event;
  }

  const abstract = firstString(src.abstract);
  if (abstract) item.abstract = stripJats(abstract);
  else delete item.abstract;

  const type = firstString(src.type);
  item.type = (type && (CROSSREF_TYPE[type] ?? type)) || "document";

  // 날짜는 여러 이름으로 온다. issued 가 비면 출판일로 메운다.
  if (!item.issued) {
    for (const k of ["published", "published-print", "published-online", "created", "deposited"]) {
      const d = src[k];
      if (d && typeof d === "object" && "date-parts" in (d as object)) {
        item.issued = d as CSLItem["issued"];
        break;
      }
    }
  }

  // 무거운 것은 버린다. 참고문헌 목록이 수백 개 딸려 오면 csl 한 덩어리가
  // 논문 본문만 해진다. 우리가 쓸 일도 없다.
  for (const k of ["reference", "assertion", "link", "license", "relation", "update-to", "content-domain", "journal-issue", "resource", "institution", "clinical-trial-number", "abstract-jats"]) {
    delete (item as Record<string, unknown>)[k];
  }
  delete (item as Record<string, unknown>).score;

  return item.title || item.DOI ? item : null;
}

function toResult(source: LookupSource, item: CSLItem, score?: number): LookupResult {
  return { source, csl: item, fields: cslToFields(item), ...(score != null ? { score } : {}) };
}

// ─────────────────────────────────────────────────────────────
//   1. DOI → CSL-JSON (콘텐츠 협상)
// ─────────────────────────────────────────────────────────────

const CSL_ACCEPT = "application/vnd.citationstyles.csl+json, application/json;q=0.8";

export async function lookupByDoi(rawDoi: string): Promise<LookupResult[]> {
  const doi = normalizeDoi(rawDoi);
  if (!doi) throw new LookupError("DOI 모양이 아닙니다 (10.으로 시작해야 합니다)");

  /*
   * 경로 조각을 통째로 인코딩하면 안 된다. DOI 안의 `/` 는 진짜 구분자라
   * `%2F` 로 바뀌면 doi.org 가 못 찾는다. 공백처럼 주소에 못 들어가는 것만
   * `encodeURI` 가 다듬게 둔다.
   */
  const text = await fetchText(`https://doi.org/${encodeURI(doi)}`, CSL_ACCEPT);
  const item = normalizeCsl(parseJson(text));
  if (!item) throw new LookupError("받은 것에서 서지정보를 찾지 못했습니다");
  if (!item.DOI) item.DOI = doi;
  return [toResult("doi", item)];
}

// ─────────────────────────────────────────────────────────────
//   2. arXiv → Atom XML
// ─────────────────────────────────────────────────────────────

/** `<tag …>값</tag>` 한 개. 네임스페이스 접두어(`arxiv:`)까지 이름에 넣어 부른다. */
function tag(xml: string, name: string): string | null {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(xml);
  return m ? decodeEntities(m[1]).replace(/\s+/g, " ").trim() || null : null;
}

function attr(xml: string, name: string, key: string): string | null {
  const m = new RegExp(`<${name}\\b[^>]*\\b${key}="([^"]*)"`, "i").exec(xml);
  return m ? decodeEntities(m[1]).trim() || null : null;
}

/**
 * "Ashish Vaswani" 를 성과 이름으로 가른다.
 *
 * **짐작이다.** arXiv 는 이름을 한 줄로만 준다. 마지막 낱말을 성으로 보는데,
 * "van den Berg" 나 "Kim Min-jun" 처럼 어긋나는 이름이 있다. 그래도 통째로
 * `literal` 에 두는 것보다 낫다 — BibTeX 의 저자 정렬과 "et al." 이 성을
 * 알아야 돌아가기 때문이다. 사람이 시트에서 고칠 수 있고, 출판본 DOI 가
 * 있으면 어차피 1번 길로 되돌아가 제대로 갈린 이름을 받는다.
 */
function splitArxivName(full: string): CSLName {
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return { literal: full.trim() };
  const family = parts.pop() as string;
  return { given: parts.join(" "), family };
}

export async function lookupByArxiv(rawId: string): Promise<LookupResult[]> {
  const id = normalizeArxivId(rawId);
  if (!id) throw new LookupError("arXiv 번호 모양이 아닙니다 (2310.06825 또는 cs/0501001)");

  /*
   * 명세에 적힌 주소는 `http://` 지만 https 로 부른다. 어차피 같은 곳으로
   * 넘어가고, 중간에 누가 끼어들 여지를 남길 이유가 없다.
   */
  const xml = await fetchText(
    `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}&max_results=1`,
    "application/atom+xml",
  );

  const entry = /<entry\b[^>]*>([\s\S]*?)<\/entry>/i.exec(xml)?.[1];
  if (!entry) throw new LookupError("응답에 항목이 없습니다");

  /*
   * arXiv 는 없는 번호에도 200 을 주고, 대신 `id` 가 오류 주소인 항목 하나를
   * 끼워 보낸다. 이걸 안 보면 "Error" 라는 제목의 논문이 서재에 꽂힌다.
   */
  const entryId = tag(entry, "id") ?? "";
  if (/\/api\/errors/i.test(entryId)) {
    throw new LookupError(tag(entry, "summary") ?? "arXiv 가 그 번호를 모릅니다");
  }

  /*
   * arXiv 는 늘 **판 번호가 붙은** id 를 돌려준다 — `1706.03762` 로 물어도
   * `…/abs/1706.03762v7` 이 온다. 우리 칸에는 판 번호를 떼고 넣는다.
   *
   * 그러지 않으면 두 가지가 어긋난다. 하나, 사람이 `1706.03762` 로 적어 둔
   * 논문과 겹침 검사가 안 붙는다. 둘, 나중에 v8 이 올라오면 같은 논문이
   * 다른 번호로 보인다. 인용에서 가리키는 것은 판이 아니라 논문이다.
   * 실제로 받은 판은 `custom.arxivVersion` 에 남겨 둔다.
   */
  const served = /arxiv\.org\/abs\/(.+)$/i.exec(entryId)?.[1] ?? id;
  const version = /v(\d+)$/i.exec(served)?.[1] ?? null;
  const canonical = served.replace(/v\d+$/i, "");
  const title = tag(entry, "title");
  if (!title) throw new LookupError("제목을 찾지 못했습니다");

  const authors = [...entry.matchAll(/<author\b[^>]*>([\s\S]*?)<\/author>/gi)]
    .map((m) => tag(m[1], "name"))
    .filter((s): s is string => Boolean(s))
    .map(splitArxivName);

  const published = tag(entry, "published") ?? tag(entry, "updated") ?? "";
  const y = /^(\d{4})-(\d{2})-(\d{2})/.exec(published);

  const journalRef = tag(entry, "arxiv:journal_ref");
  const comment = tag(entry, "arxiv:comment");
  const primaryClass = attr(entry, "arxiv:primary_category", "term") ?? attr(entry, "category", "term");

  const item: CSLItem = {
    type: journalRef ? "article-journal" : "article",
    title,
    author: authors.length ? authors : undefined,
    abstract: tag(entry, "summary") ?? undefined,
    URL: `https://arxiv.org/abs/${canonical}`,
    publisher: journalRef ? undefined : "arXiv",
    "container-title": journalRef ?? undefined,
    issued: y ? { "date-parts": [[Number(y[1]), Number(y[2]), Number(y[3])]] } : undefined,
    /*
     * `comment` 에 "Accepted at NeurIPS 2023" 같은 것이 자주 들어 있다.
     * 학회 이름으로 자동으로 옮기지 않는다 — "12 pages, 3 figures" 인 경우가
     * 더 많고, 잘못 옮기면 사람이 지워야 한다. 그대로 note 에 남겨 보여만 준다.
     */
    note: comment ?? undefined,
    custom: {
      arxivId: canonical,
      ...(version ? { arxivVersion: version } : {}),
      ...(primaryClass ? { primaryClass } : {}),
    },
  };

  const doi = normalizeDoi(tag(entry, "arxiv:doi"));
  if (doi) item.DOI = doi;

  const normalized = normalizeCsl(item);
  return normalized ? [toResult("arxiv", normalized)] : [];
}

// ─────────────────────────────────────────────────────────────
//   3. 제목 → Crossref 검색
// ─────────────────────────────────────────────────────────────

const CROSSREF_ROWS = 5;

/**
 * 받아 올 칸을 골라 둔다.
 *
 * 안 고르면 `reference` 가 딸려 온다 — 참고문헌 수백 개짜리 논문 다섯 편이면
 * 몇 MB 다. 다만 Crossref 는 모르는 칸 이름을 400 으로 되돌려 주므로, 그때는
 * 골라 두지 않고 한 번 더 물어본다. 검색이 통째로 죽는 것보다 낫다.
 */
const CROSSREF_SELECT = [
  "DOI", "title", "subtitle", "author", "editor", "container-title",
  "short-container-title", "event", "issued", "type", "page", "volume",
  "issue", "publisher", "publisher-location", "abstract", "URL",
  "ISSN", "ISBN", "score",
].join(",");

function crossrefUrl(title: string, select: boolean): string {
  const p = new URLSearchParams();
  p.set("query.bibliographic", title);
  p.set("rows", String(CROSSREF_ROWS));
  if (select) p.set("select", CROSSREF_SELECT);
  // 있으면 빠른 큐로 간다. 없으면 그냥 간다.
  if (CROSSREF_MAILTO) p.set("mailto", CROSSREF_MAILTO);
  return `https://api.crossref.org/works?${p.toString()}`;
}

export async function lookupByTitle(rawTitle: string): Promise<LookupResult[]> {
  const title = rawTitle.trim().replace(/\s+/g, " ");
  if (title.length < 4) throw new LookupError("제목이 너무 짧습니다 (네 글자 이상)");

  let text: string;
  try {
    text = await fetchText(crossrefUrl(title, true), "application/json");
  } catch (e) {
    if (!(e instanceof LookupError) || !/HTTP 400/.test(e.message)) throw e;
    text = await fetchText(crossrefUrl(title, false), "application/json");
  }

  const body = parseJson(text) as { message?: { items?: unknown[] } };
  const items = body?.message?.items;
  if (!Array.isArray(items) || items.length === 0) throw new LookupError("맞는 것이 없습니다");

  const out: LookupResult[] = [];
  for (const raw of items) {
    const score = typeof (raw as { score?: unknown })?.score === "number"
      ? (raw as { score: number }).score
      : undefined;
    const item = normalizeCsl(raw);
    if (item) out.push(toResult("crossref", item, score));
  }
  if (out.length === 0) throw new LookupError("받은 것에서 서지정보를 찾지 못했습니다");
  return out;
}

// ─────────────────────────────────────────────────────────────
//   묶어서 — 순서대로 해 보고 첫 성공에서 멈춘다
// ─────────────────────────────────────────────────────────────

function noteOf(e: unknown): string {
  if (e instanceof LookupError) return e.message;
  return e instanceof Error ? e.message : "알 수 없는 오류";
}

/**
 * DOI → arXiv → 제목. **첫 성공에서 멈춘다.**
 *
 * 셋을 다 해서 모으지 않는 이유는 정확도의 차이가 크기 때문이다. DOI 로 받은
 * 한 덩어리 옆에 제목 검색의 어림짐작 다섯 개를 나란히 놓으면, 사람이 고르는
 * 자리가 되어 버린다 — 고를 필요가 없는데도.
 *
 * arXiv 가 출판본 DOI 를 알려 주면 거기서 한 번 더 간다. 그때 결과의 `source`
 * 는 `"doi"` 다. 어디서 온 것인지가 그대로 남아야 나중에 되짚을 수 있다.
 */
export async function lookup(q: LookupQuery): Promise<LookupReport> {
  const steps: LookupStep[] = [];

  const doi = normalizeDoi(q.doi);
  if (doi) {
    try {
      const found = await lookupByDoi(doi);
      steps.push({ source: "doi", query: doi, ok: true, note: "등록기관에서 받았습니다" });
      return { candidates: found, steps };
    } catch (e) {
      steps.push({ source: "doi", query: doi, ok: false, note: noteOf(e) });
    }
  } else if (q.doi?.trim()) {
    steps.push({ source: "doi", query: q.doi.trim(), ok: false, note: "DOI 모양이 아닙니다" });
  }

  const arxiv = normalizeArxivId(q.arxiv);
  if (arxiv) {
    try {
      const found = await lookupByArxiv(arxiv);
      steps.push({ source: "arxiv", query: arxiv, ok: true, note: "arXiv 에서 받았습니다" });

      /*
       * 출판본이 있으면 그쪽이 낫다. 실패하면 프리프린트를 그대로 쓴다 —
       * 되돌아간 길이 막혔다고 이미 손에 든 것을 버릴 이유가 없다.
       */
      const published = found[0]?.csl.DOI;
      if (published) {
        try {
          const better = await lookupByDoi(published);
          steps.push({
            source: "doi",
            query: published,
            ok: true,
            note: "arXiv 가 알려 준 출판본 DOI 로 다시 받았습니다",
          });
          return { candidates: better, steps };
        } catch (e) {
          steps.push({ source: "doi", query: published, ok: false, note: noteOf(e) });
        }
      }
      return { candidates: found, steps };
    } catch (e) {
      steps.push({ source: "arxiv", query: arxiv, ok: false, note: noteOf(e) });
    }
  } else if (q.arxiv?.trim()) {
    steps.push({ source: "arxiv", query: q.arxiv.trim(), ok: false, note: "arXiv 번호 모양이 아닙니다" });
  }

  const title = q.title?.trim();
  if (title) {
    try {
      const found = await lookupByTitle(title);
      steps.push({
        source: "crossref",
        query: title,
        ok: true,
        note: `후보 ${found.length}개를 찾았습니다. 맞는 것을 고르세요`,
      });
      return { candidates: found, steps };
    } catch (e) {
      steps.push({ source: "crossref", query: title, ok: false, note: noteOf(e) });
    }
  }

  return { candidates: [], steps };
}
