/**
 * 응답 다듬기.
 *
 * 앱의 API 는 어떤 변경이든 **서가 전체**(`{ groups }`)를 돌려준다. 화면에는
 * 알맞지만 도구 결과로 그대로 흘리면 논문 한 편의 표식을 바꿀 때마다 수천
 * 토큰이 대화에 쌓인다. 서재에는 논문이 수백 편 있고 각 편에 초록이 붙어 있어
 * MemoBento 보다 사정이 나쁘다. 그래서 여기서 필요한 것만 남긴다 — 초록은
 * 목록에서 아예 빼고(`get_paper` 에서만), 빈 필드는 통째로 뺀다.
 *
 * 이름을 id 대신 받는 것도 여기서 푼다. 사람은 "Transformer 논문" 이라고
 * 말하지 `p_9f3…` 이라고 말하지 않는다.
 */

export interface FileInfo {
  id: string;
  name: string;
  ext: string;
  mimeType: string;
  size: number;
  kind: string;
  hasThumb: boolean;
}

export interface Paper {
  id: string;
  groupId: string;
  title: string;
  authors: string | null;
  venue: string | null;
  year: number | null;
  doi: string | null;
  arxivId: string | null;
  abstract: string | null;
  tags: string | null;
  url: string | null;
  readState: string;
  mark: string | null;
  position: number;
  file: FileInfo | null;
  hasSummary: boolean;
  noteCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface SubGroup {
  id: string;
  name: string;
  parentId: string;
  description: string | null;
  color: string | null;
  viewMode: string;
  position: number;
  collapsed: boolean;
  papers: Paper[];
}

export interface Group {
  id: string;
  name: string;
  parentId: null;
  description: string | null;
  color: string | null;
  viewMode: string;
  /** 값이 있으면 이름 변경·삭제가 잠긴 서가다 (지금은 Inbox 하나). */
  systemKey: string | null;
  position: number;
  collapsed: boolean;
  papers: Paper[];
  children: SubGroup[];
}

export interface GroupsResponse {
  groups: Group[];
}

export interface Summary {
  paperId: string;
  body: string;
  source: "human" | "agent";
  instruction: string | null;
  updatedAt: number;
}

export interface Note {
  id: string;
  paperId: string;
  page: number;
  anchor: { quote?: string; [k: string]: unknown };
  body: string;
  color: string | null;
  createdAt: number;
  updatedAt: number;
}

/** 초록이 길면 잘라서 싣는다. 전문이 필요하면 이 값을 올린다. */
export const DEFAULT_ABSTRACT_LIMIT = 600;

// ─────────────────────────────────────────────────────────────
//   PDF 글자의 쪽 다루기
// ─────────────────────────────────────────────────────────────

/**
 * 앱이 뽑아 준 글에서 쪽을 가르는 표시. `lib/pdf-text.ts` 가 이 꼴로 넣는다.
 * 여기서 쪽을 골라내는 근거가 이것뿐이라, 저쪽이 바꾸면 여기도 바뀌어야 한다.
 */
const PAGE_MARK = /^--- p\.(\d+) ---$/;

export interface PageSpec {
  wanted: Set<number>;
  /** 그중 가장 뒤 쪽. 앱에 "몇 쪽까지 뽑아 달라" 고 할 때 쓴다. */
  max: number;
}

/**
 * `"1-3"` · `"7"` · `"2,5-6"` 을 쪽 번호로 푼다.
 *
 * 앱의 추출기는 **늘 1쪽부터** 읽고 "몇 쪽까지" 만 받는다. 그래서 뒷쪽만
 * 달라고 해도 앞쪽까지 함께 뽑히는데, 그걸 그대로 흘리면 5쪽 하나 보려다
 * 1~5쪽이 대화에 쌓인다. 여기서 푼 쪽 번호로 **받은 뒤에 걸러 낸다.**
 */
export function parsePages(spec: string): PageSpec {
  const wanted = new Set<number>();
  for (const part of spec.split(",")) {
    const s = part.trim();
    if (!s) continue;
    const m = /^(\d+)\s*(?:-\s*(\d+))?$/.exec(s);
    if (!m) throw new Error(`쪽 표기를 알아볼 수 없습니다: "${part}" (예: "1-3", "7", "2,5-6")`);
    const from = Number(m[1]);
    const to = m[2] === undefined ? from : Number(m[2]);
    if (from < 1 || to < from) throw new Error(`쪽 범위가 거꾸로입니다: "${part}"`);
    // 한 번에 부를 수 있는 폭을 묶어 둔다. "1-999" 한 줄로 논문 전체를
    // 부르는 길을 열어 두면 쪽을 짚게 한 뜻이 사라진다.
    if (to - from >= 30) throw new Error(`한 번에 30쪽까지입니다: "${part}"`);
    for (let n = from; n <= to; n += 1) wanted.add(n);
  }
  if (wanted.size === 0) throw new Error("읽을 쪽이 없습니다");
  return { wanted, max: Math.max(...wanted) };
}

/** 쪽 표시로 나뉜 글에서 고른 쪽만 남긴다. 표시는 그대로 둔다. */
export function keepPages(text: string, wanted: Set<number>): string {
  const out: string[] = [];
  let keep = false;
  for (const line of text.split("\n")) {
    const m = PAGE_MARK.exec(line.trim());
    if (m) {
      keep = wanted.has(Number(m[1]));
      if (keep) out.push(line);
      continue;
    }
    if (keep) out.push(line);
  }
  // 표시가 하나도 없으면 가를 근거가 없다. 자르는 것보다 그대로 주는 편이 낫다.
  return out.length === 0 ? text : out.join("\n").trim();
}

export function clip(s: string | null, limit: number): string | null {
  if (s === null) return null;
  if (limit <= 0 || s.length <= limit) return s;
  return `${s.slice(0, limit)}… (총 ${s.length}자)`;
}

/** 빈 값을 걷어낸 얕은 객체. */
export function compact<T extends Record<string, unknown>>(o: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === null || v === undefined || v === false) continue;
    if (typeof v === "number" && v === 0) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out as Partial<T>;
}

export interface PaperShapeOptions {
  /** 초록을 실을지. 목록에서는 끈다 — 수백 편이면 초록만으로 대화가 찬다. */
  abstract?: boolean;
  abstractLimit?: number;
}

export function shapePaper(p: Paper, opts: PaperShapeOptions = {}) {
  const { abstract = false, abstractLimit = DEFAULT_ABSTRACT_LIMIT } = opts;
  return compact({
    id: p.id,
    title: p.title,
    authors: p.authors,
    venue: p.venue,
    year: p.year,
    doi: p.doi,
    arxivId: p.arxivId,
    tags: p.tags,
    url: p.url,
    // "unread" 는 기본값이라 굳이 싣지 않는다 (compact 는 못 거른다).
    readState: p.readState === "unread" ? null : p.readState,
    mark: p.mark,
    /*
     * PDF 는 있다/없다와 이름만 싣는다.
     *
     * 파일 id 를 흘리지 않는 것은 뜻이 있다 — 이 서버에는 파일을 받아 오는
     * 도구가 없다. id 를 보여 주면 에이전트가 있지도 않은 길을 찾는다.
     */
    pdf: p.file ? { name: p.file.name, size: p.file.size, kind: p.file.kind } : null,
    hasSummary: p.hasSummary,
    noteCount: p.noteCount,
    abstract: abstract ? clip(p.abstract, abstractLimit) : null,
    updatedAt: p.updatedAt,
  });
}

export interface GroupShapeOptions extends PaperShapeOptions {
  /** 논문 목록까지 실을지. false 면 편수만. */
  papers?: boolean;
}

/**
 * 다듬은 서가.
 *
 * **되돌이(자기 안에 자기)라 형을 손으로 적는다.** 안 적으면 TypeScript 가
 * `any` 로 무르고, 그때부터 안쪽은 아무 검사도 받지 못한다.
 */
export interface ShapedGroup {
  id?: string;
  name?: string;
  description?: string | null;
  color?: string | null;
  systemKey?: string | null;
  paperCount?: number;
  papers?: unknown[];
  children?: ShapedGroup[];
}

export function shapeGroup(g: Group | SubGroup, opts: GroupShapeOptions = {}): ShapedGroup {
  const { papers = true } = opts;
  const children = "children" in g ? g.children : [];
  return compact({
    id: g.id,
    name: g.name,
    description: g.description,
    color: g.color,
    // 값이 있으면 이름 변경·삭제가 잠긴 서가다
    systemKey: "systemKey" in g ? g.systemKey : null,
    paperCount: g.papers.length + children.reduce((n, c) => n + c.papers.length, 0),
    papers: papers ? g.papers.map((p) => shapePaper(p, opts)) : undefined,
    children: children.map((c) => shapeGroup(c, opts)),
  });
}

// ─────────────────────────────────────────────────────────────
//   이름으로 찾기
// ─────────────────────────────────────────────────────────────

/** 서가와 그 안의 칸을 한 줄로 편다. 이름으로 찾을 때 두 단을 함께 본다. */
export function flatGroups(res: GroupsResponse): (Group | SubGroup)[] {
  const out: (Group | SubGroup)[] = [];
  for (const g of res.groups) {
    out.push(g);
    for (const c of g.children) out.push(c);
  }
  return out;
}

/** "서가/칸" 처럼 보이게 만든 이름. 오류 문구와 검색 결과에 쓴다. */
export function groupPath(res: GroupsResponse, id: string): string {
  for (const g of res.groups) {
    if (g.id === id) return g.name;
    for (const c of g.children) if (c.id === id) return `${g.name}/${c.name}`;
  }
  return id;
}

/**
 * id · 이름 · "서가/칸" 으로 서가 하나를 고른다.
 *
 * 두 단이라 이름이 겹치기 쉽다 — 서가마다 "읽는 중" 칸을 둘 수 있다. 겹치면
 * 고르지 않고 **후보를 보여 주며 되묻는다.** 아무거나 골라 옮기면 사람은
 * 논문이 사라진 줄 안다.
 */
export function resolveGroup(res: GroupsResponse, ref: string): Group | SubGroup {
  const all = flatGroups(res);
  const byId = all.find((g) => g.id === ref);
  if (byId) return byId;

  const want = ref.trim().toLowerCase();

  // "서가/칸" 꼴이면 그것부터 본다. 이름이 겹칠 때 사람이 쓰는 길이다.
  if (want.includes("/")) {
    const [head, tail] = want.split("/").map((s) => s.trim());
    for (const g of res.groups) {
      if (g.name.toLowerCase() !== head) continue;
      const child = g.children.find((c) => c.name.toLowerCase() === tail);
      if (child) return child;
    }
  }

  const named = all.filter((g) => g.name.toLowerCase() === want);
  if (named.length === 1) return named[0];
  if (named.length > 1) {
    throw new Error(
      `"${ref}" 라는 이름이 ${named.length}곳 있습니다. "서가/칸" 이나 id 로 지정하세요: ${named
        .map((g) => `${groupPath(res, g.id)}(${g.id})`)
        .join(", ")}`,
    );
  }
  throw new Error(
    `"${ref}" 에 해당하는 서가가 없습니다. 있는 것: ${
      all.map((g) => groupPath(res, g.id)).join(", ") || "(없음)"
    }`,
  );
}

export interface FoundPaper {
  paper: Paper;
  group: Group | SubGroup;
}

export function findPaper(res: GroupsResponse, paperId: string): FoundPaper | undefined {
  for (const g of flatGroups(res)) {
    const paper = g.papers.find((p) => p.id === paperId);
    if (paper) return { paper, group: g };
  }
  return undefined;
}

/**
 * id · 제목으로 논문 하나를 고른다.
 *
 * 제목은 정확히 같은 것을 먼저 보고, 없으면 부분 일치를 본다. 부분 일치가
 * 여럿이면 고르지 않는다 — "Attention" 으로 서른 편이 걸리는 서재에서
 * 첫 번째를 집어 읽음 표시를 하면 엉뚱한 논문이 읽은 것이 된다.
 */
export function resolvePaper(res: GroupsResponse, ref: string): FoundPaper {
  const direct = findPaper(res, ref);
  if (direct) return direct;

  const want = ref.trim().toLowerCase();
  const all: FoundPaper[] = [];
  for (const g of flatGroups(res)) for (const p of g.papers) all.push({ paper: p, group: g });

  const exact = all.filter((f) => f.paper.title.trim().toLowerCase() === want);
  if (exact.length === 1) return exact[0];
  const pool = exact.length > 1 ? exact : all.filter((f) => f.paper.title.toLowerCase().includes(want));
  if (pool.length === 1) return pool[0];
  if (pool.length > 1) {
    throw new Error(
      `"${ref}" 에 맞는 논문이 ${pool.length}편입니다. id 로 지정하세요: ${pool
        .slice(0, 10)
        .map((f) => `${f.paper.title}(${f.paper.id})`)
        .join(", ")}${pool.length > 10 ? " …" : ""}`,
    );
  }
  throw new Error(`"${ref}" 에 해당하는 논문이 없습니다. search_papers 로 먼저 찾아보세요.`);
}
