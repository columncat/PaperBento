import { apiPath } from "./api-path";
import { rawQueryWords, type FrontField } from "./filter-papers";
import { readJson } from "./read-json";
import type {
  Anchor,
  AppConfigDTO,
  GroupDTO,
  ItemColor,
  LookupReport,
  NoteDTO,
  PaperMark,
  ReadState,
  SummaryDTO,
  TrashEntryDTO,
  ViewMode,
} from "./types";

/**
 * 브라우저에서 서버를 부르는 한 곳.
 *
 * 모든 변경 API 는 갱신된 **서가 전체**를 돌려준다. 한 사람이 쓰는 앱이고
 * 목록에 무거운 것(요약 본문·메모 본문·썸네일 바이트)이 안 실리기 때문에,
 * 이렇게 하면 화면이 재조회할 자리가 아예 없어진다. "고쳤는데 화면은 옛것" 이
 * 되는 구간이 사라지는 것이 진짜 이득이다.
 *
 * 주소는 전부 `apiPath()` 를 통과한다. 하위 경로 배포(`/paper`)에서 Next 는
 * **손으로 적은 주소에 접두어를 붙여 주지 않는다.** 호출부마다 챙기게 두면
 * 언젠가 하나가 빠지고, 그건 배포한 뒤에야 404 로 드러난다.
 */

/**
 * 예전에는 파싱 실패를 `{}` 로 뭉갰다.
 *
 * 그 한 줄이 조용한 사고를 만들었다. 세션이 풀리면 미들웨어가 로그인 페이지로
 * 리다이렉트했고, fetch 는 그걸 따라가 **HTML 을 200 으로** 받아 왔다.
 * `res.ok` 는 참이라 오류로 잡히지 않고, 파싱 실패는 `{}` 가 되고, 결국
 * `json.groups ?? []` 가 빈 배열을 돌려줬다. 화면은 그 빈 배열을 그대로
 * 상태에 넣었다 — **서재가 통째로 사라진 것처럼 보였다.** 아무 오류도 뜨지
 * 않은 채로.
 *
 * 이제 두 겹으로 막는다. 미들웨어가 API 에는 401 JSON 을 주고, 여기서는
 * `readJson` 이 읽지 못한 응답을 조용히 넘기지 않는다.
 */
async function send<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiPath(url), { cache: "no-store", ...init });
  return readJson<T>(res);
}

/** 변경 호출. 돌려받는 것은 늘 갱신된 서가 전체다. */
async function mutate(url: string, init: RequestInit): Promise<GroupDTO[]> {
  const json = await send<{ groups?: GroupDTO[] }>(url, init);
  return json.groups ?? [];
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const q = (s: string) => encodeURIComponent(s);

export interface PaperInput {
  title?: string;
  authors?: string | null;
  venue?: string | null;
  year?: number | null;
  doi?: string | null;
  arxivId?: string | null;
  abstract?: string | null;
  tags?: string | null;
  url?: string | null;
  readState?: ReadState;
  mark?: PaperMark | null;
  fileId?: string | null;
  groupId?: string;
  /**
   * 받아 온 CSL-JSON 원본 (문자열). 찾아오기에서 후보를 적용했을 때만 싣는다.
   *
   * **안 실으면 서버가 손대지 않는다.** 이 구분이 없으면 시트에서 제목만
   * 고쳐 저장할 때마다 애써 받아 둔 원본이 조용히 지워진다. `null` 을 실으면
   * 그때는 진짜로 뗀다.
   */
  csl?: string | null;
  /** PDF 에서 뽑아 둔 앞부분. 에이전트에게 넘길 재료라 목록으로는 안 내려온다. */
  headText?: string | null;
}

/*
 * 모양은 `types.ts` 가 들고 있다. 여기서 다시 적으면 서버 쪽 정의와 갈라진다.
 * 부르는 쪽이 `client-api` 에서 함께 꺼내 쓰던 것이 있어 이름은 그대로 내보낸다.
 */
export type { AppConfigDTO, SummaryPreset, TrashEntryDTO } from "./types";

// ─────────────────────────────────────────────────────────────
//   에이전트 서지정보 제안
// ─────────────────────────────────────────────────────────────

/*
 * 이 모양들은 `lib/suggest.ts` 가 서버에서 들고 있는 것과 짝이다.
 *
 * `types.ts` 를 거치지 않고 여기 적는 것은 `suggest.ts` 가 better-sqlite3 와
 * `node:fs` 를 끌고 오는 서버 전용 모듈이기 때문이다 — 브라우저 번들이 타입
 * 하나 때문에 그 파일을 쳐다보게 두면 안 된다.
 */

/**
 * 에이전트가 짐작한 값.
 *
 * **찾아온 값과 한 자루에 담지 마라.** 등록기관이 준 것은 정확한 것이고 이건
 * 추측이다. 화면이 둘을 갈라 보여 주고 적용 순서도 다르게 매기는데, 여기서
 * 하나로 합쳐 두면 그 구분이 타입에서 사라진다.
 */
export interface BiblioGuess {
  title?: string;
  authors?: string;
  venue?: string;
  year?: number;
  doi?: string;
  arxivId?: string;
  abstract?: string;
  /** 단서와 논문이 어긋난 자리 한 문장. 논문 칸이 아니라 사람에게 하는 말이다. */
  mismatch?: string;
}

/** 찾아오기가 먼저 받아 온 것. 에이전트에게 단서로 함께 넘긴다. */
export interface BiblioClue {
  source?: "doi" | "arxiv" | "crossref";
  title?: string | null;
  authors?: string | null;
  venue?: string | null;
  year?: number | null;
  doi?: string | null;
  arxivId?: string | null;
  abstract?: string | null;
  url?: string | null;
}

export interface BiblioSuggestionDTO {
  id: string;
  state: "running" | "done" | "failed";
  /** `done` 일 때만 채워진다. 서버의 허용목록을 지난 값이다. */
  fields: BiblioGuess | null;
  error: string | null;
  applied: boolean;
}

export interface BiblioAgentState {
  suggestion: BiblioSuggestionDTO | null;
  /** 부를 수 있는가. 못 부르면 화면은 토글을 아예 안 켠다. */
  agent: { ready: boolean; reason: string | null };
}

// ─────────────────────────────────────────────────────────────
//   논문 대화
// ─────────────────────────────────────────────────────────────

/*
 * 이 모양들은 BentoAgent 의 `/paper` 계열이 내놓는 것과 짝이다. 프록시
 * (`/api/papers/:id/chat`)는 거의 그대로 흘려보내므로 여기가 유일한 정의다.
 */

export interface PaperChatTurn {
  role: "me" | "agent";
  text: string;
  at?: number;
}

/**
 * 진행 중인 요청의 상태.
 *
 * `toolCount` 와 `lastTool` 은 **없을 수 있다.** 계약이 약속한 것은
 * `state`·`elapsedMs`·`reply` 까지고 나머지는 덤이라, 화면은 온 것만 그린다.
 * 없다고 진행 표시가 사라지지는 않는다 — 경과 초는 늘 온다.
 */
export interface PaperChatStatus {
  state: "running" | "done";
  elapsedMs: number;
  toolCount?: number;
  lastTool?: string | null;
  reply?: string;
  isError?: boolean;
  denials?: string[];
}

export interface PaperChatHistory {
  turns: PaperChatTurn[];
  /** 부를 수 있는가. 못 부르면 대화창은 꺼진 채로 이유만 적는다. */
  agent: { ready: boolean; reason: string | null };
}

// ─────────────────────────────────────────────────────────────
//   찾기
// ─────────────────────────────────────────────────────────────

/**
 * 목록에 안 실려 브라우저가 **볼 수 없는** 세 곳.
 *
 * 나머지 여덟(`FrontField`)은 `/api/groups` 가 이미 내려보냈다. 그래서 화면은
 * 왕복 없이 그 여덟으로 먼저 거르고, 이 셋은 서버 답을 기다린다.
 */
export const DEEP_WHERE = ["summary", "note", "pdf"] as const;
export type DeepWhere = (typeof DEEP_WHERE)[number];

/** 낱말이 맞을 수 있는 자리 열한. 앞 칸 여덟 + 깊은 자리 셋. */
export type SearchWhere = FrontField | DeepWhere;

/**
 * 찾기에 걸린 논문 하나.
 *
 * **판정은 전부 서버가 한다.** 낱말 하나는 열한 자리 중 어디에 있어도 되고
 * (OR), 낱말끼리는 전부여야 한다(AND). 예전처럼 앞 겹과 뒤 겹이 각자 AND 를
 * 따지면, 제목에만 있는 낱말과 메모에만 있는 낱말을 함께 친 순간 양쪽 다
 * 떨어뜨려 0건이 된다.
 *
 * 화면이 그 자리에서 하는 즉시 거르기는 이 답의 **부분집합**이다 — 앞 칸
 * 여덟만으로 낱말이 다 맞는 논문은 열한 자리로도 다 맞는다. 그래서 즉시
 * 떴다가 답이 오면서 사라지는 줄은 없다. **목록은 늘어나기만 한다.**
 *
 * `paperId` 만 오는 것은 논문의 나머지를 화면이 이미 들고 있기 때문이다.
 * **`groups` 에서 그 id 를 못 찾으면 그 줄은 버려라** — 폴링과 이 요청 사이에
 * 지워진 논문이다.
 */
export interface SearchHit {
  paperId: string;
  /** 이 논문에서 맞은 자리 전부. 앞 칸과 깊은 칸이 섞여 온다. */
  where: SearchWhere[];
  /**
   * 깊은 자리에서 맞았을 때만. 자리마다 최대 하나(그러니 최대 셋).
   *
   * **`where` 에 있다고 조각이 따라오는 것은 아니다.** 쪽 표시밖에 없는
   * 자리처럼 다듬고 나면 한 글자도 안 남는 창이 있어서, 그때는 딱지만 가고
   * 조각은 안 간다. 조각은 `where` 가 아니라 이 배열에서 찾아라.
   */
  snippets: { where: DeepWhere; text: string }[];
}

export interface SearchResponse {
  hits: SearchHit[];
  /** 낱말이 상한(16)을 넘어 **아예 안 찾았다.** `hits` 는 비어 있다. */
  tooManyWords?: boolean;
  /** 결과가 상한(200)에서 잘렸다. 걸린 논문이 더 있다. */
  truncated?: boolean;
  /** 질의가 길어 앞 `SEARCH_MAX_QUERY` 자로 자른 뒤 찾았다. */
  queryTruncated?: boolean;
}

/**
 * 한 번에 물을 수 있는 질의 길이.
 *
 * **주소에 싣기 전에 여기서 자른다.** 안 자르면 조금 긴 글을 붙여 넣는 것만으로
 * 요청이 431 로 죽는다 — 한글 한 글자가 `%XX` 세 벌(9자)로 부풀어 1,800자쯤에서
 * 헤더 한도를 넘는다. 라우트도 자르지만 그건 주소가 이미 닿은 **뒤**라 431 은
 * 거기까지 가지도 못한다. 그래서 두 곳에서 자르고, **라우트는 이 길이가 아니라
 * 아래 `clipQuery` 를 통째로 가져다 쓴다** — 길이만 나눠 가지면 자르는 자리가
 * 갈리고, 그 갈림이 바로 결함이었다.
 *
 * 잘랐다는 것은 `queryTruncated` 로 말한다. 조용히 자르면 사람은 자기가 친
 * 글 전부로 찾은 목록이라고 읽는다.
 */
export const SEARCH_MAX_QUERY = 200;

/**
 * 질의를 상한 안으로 줄인다. **낱말 사이에서만 자른다.**
 *
 * 예전에는 `slice(0, SEARCH_MAX_QUERY)` 였다. UTF-16 칸으로 자르니 **글자
 * 한가운데**가 갈렸다 — 조합형 한글(NFD)이나 악센트는 한 글자가 두세 칸이고
 * 이모지는 서로게이트 쌍이다. 갈린 반쪽은 접고 나면 저장값 어디에도 없는
 * 글자가 되므로 서버는 0건을 내놓는데, 화면은 안 자른 질의로 이미 줄을 띄워
 * 놓았다. **그 줄이 사라진다.** 맥에서 복사한 조합형 한글은 음절 하나가 두세
 * 칸이라 94글자 문장이 250칸이 되고, 낱말 열 개짜리 흔한 초록 한 문장이 그
 * 길로 들어간다. (`"x"×199 + é(NFD)` 하나로 재현된다.)
 *
 * 낱말 사이에서 자르면 이 갈래가 통째로 없어진다. 질의는 어차피 공백으로
 * 나뉘므로(`queryWords`) 남는 것은 **사람이 친 낱말 그대로**이고, 접힌 값도
 * 그대로다. 서버가 보는 낱말이 화면이 보는 낱말의 부분집합이 되니 부분집합
 * 성질도 지켜진다 — 낱말이 줄면 서버 쪽이 **넓게** 맞을 뿐이다.
 *
 * **낱말 하나가 통째로 상한을 넘으면 그 낱말부터 버린다.** 첫 낱말이 그러면
 * 빈 질의가 된다. 낱말 안에서는 안전하게 자를 자리가 없기 때문이다: 어디서
 * 자르든 남는 앞부분이 저장값에 그대로 있으리라는 보장이 없다(`강`(NFD)을
 * 반만 남기면 `가`가 되고, 저장값의 `강` 은 그 `가` 를 안 품는다). 자르면
 * 부분집합이 깨지고, 안 자르면 431 로 요청 자체가 죽는다. 그래서 버린다 —
 * 대신 `queryTruncated` 가 서고, 화면은 그때 즉시 거르기의 줄을 그대로 둔다
 * (`search-panel.tsx` 의 `cut`). 200자를 넘는 낱말 하나짜리 질의는 요약·메모·
 * PDF 본문까지는 못 뒤지지만, 앞 칸 여덟으로 찾은 줄은 그대로 보인다.
 *
 * 나누는 자리는 `rawQueryWords` 다 — 공백으로 그냥 나누면 안 된다. 접기가
 * **낱말 안으로 치는** 두 가지가 있어서다: 줄 끝 하이픈(`trans-\nformer` 는 한
 * 낱말)과 안 보이는 글자(U+FEFF 는 `\s` 에 들어 있다). 거기서 나누면 서버가
 * `trans-` 나 `mo` 처럼 **사람이 친 적 없는 낱말**로 찾게 된다.
 *
 * 넘칠 때만 낱말로 다시 잇는다(공백이 하나로 접힌다). 상한 안이면 사람이 친
 * 글자를 앞뒤 공백만 떼고 그대로 돌려준다.
 */
export function clipQuery(query: string): string {
  const asked = query.trim();
  if (asked.length <= SEARCH_MAX_QUERY) return asked;

  const kept: string[] = [];
  let len = 0;
  for (const w of rawQueryWords(asked)) {
    const add = (kept.length === 0 ? 0 : 1) + w.length;
    if (len + add > SEARCH_MAX_QUERY) break;
    kept.push(w);
    len += add;
  }
  return kept.join(" ");
}

export const api = {
  list: () => mutate("/api/groups", { method: "GET" }),

  /**
   * 에이전트가 마지막으로 뭔가 바꾼 기록의 번호.
   *
   * 화면이 짧은 간격으로 부르는 자리라 목록이 아니라 숫자 하나만 받는다.
   * 사람이 화면에서 한 일은 여기 잡히지 않는다 — MCP 로 들어온 요청만 기록에
   * 남기 때문이다. 그래서 내가 방금 누른 표식 때문에 서재를 다시 읽는 일이 없다.
   *
   * 기록을 비우면 이 값이 0 으로 **떨어진다.** 보는 쪽은 커졌는지가 아니라
   * 달라졌는지를 봐야 한 번 헛도는 것으로 끝난다.
   */
  agentRev: async (): Promise<number> => {
    const json = await send<{ rev?: number }>("/api/agent-log?head=1");
    return typeof json.rev === "number" ? json.rev : 0;
  },

  // ── 서가 ────────────────────────────────────────────────
  createGroup: (name: string, parentId: string | null = null) =>
    mutate("/api/groups", jsonInit("POST", { name, parentId })),

  updateGroup: (
    id: string,
    patch: {
      name?: string;
      description?: string | null;
      color?: ItemColor | null;
      viewMode?: ViewMode;
      collapsed?: boolean;
      /** `null` 이면 뿌리로 꺼낸다. 세 단이 되려 하면 서버가 409 로 거절한다. */
      parentId?: string | null;
    },
  ) => mutate(`/api/groups/${q(id)}`, jsonInit("PATCH", patch)),

  deleteGroup: (id: string) => mutate(`/api/groups/${q(id)}`, { method: "DELETE" }),

  reorderGroups: (parentId: string | null, orderedIds: string[]) =>
    mutate("/api/groups/reorder", jsonInit("POST", { parentId, orderedIds })),

  // ── 논문 ────────────────────────────────────────────────
  /** PDF 없이 서지정보만 먼저 적어 두는 길. 파일로 만드는 길은 업로드 쪽이다. */
  createPaper: async (
    groupId: string,
    input: PaperInput = {},
  ): Promise<{ groups: GroupDTO[]; paperId: string }> => {
    // 펼치기를 먼저 둔다. 뒤에 두면 `title: undefined` 가 앞의 기본값을 덮어쓴다.
    const json = await send<{ groups?: GroupDTO[]; paperId: string }>(
      "/api/papers",
      jsonInit("POST", { ...input, groupId, title: input.title ?? "" }),
    );
    return { groups: json.groups ?? [], paperId: json.paperId };
  },

  updatePaper: (id: string, patch: PaperInput) =>
    mutate(`/api/papers/${q(id)}`, jsonInit("PATCH", patch)),

  deletePaper: (id: string) => mutate(`/api/papers/${q(id)}`, { method: "DELETE" }),

  reorderPapers: (groupId: string, orderedIds: string[]) =>
    mutate("/api/papers/reorder", jsonInit("POST", { groupId, orderedIds })),

  /**
   * 같은 DOI·arXiv 번호가 이미 있는지. 막지 않고 알려 주기만 한다.
   *
   * 고치는 중이라면 `exceptId` 로 자기를 빼라. 안 그러면 자기 DOI 를 자기가
   * 겹친 것으로 잡아 늘 경고가 뜬다.
   */
  findDuplicates: async (opts: {
    doi?: string | null;
    arxivId?: string | null;
    exceptId?: string;
  }): Promise<{ id: string; title: string }[]> => {
    const p = new URLSearchParams();
    if (opts.doi) p.set("doi", opts.doi);
    if (opts.arxivId) p.set("arxivId", opts.arxivId);
    if (opts.exceptId) p.set("exceptId", opts.exceptId);
    if ([...p.keys()].length === 0) return [];
    const json = await send<{ papers?: { id: string; title: string }[] }>(
      `/api/papers/duplicates?${p.toString()}`,
    );
    return json.papers ?? [];
  },

  /**
   * 바깥에서 서지정보를 찾아온다. DOI → arXiv → 제목 순으로 첫 성공에서 멈춘다.
   *
   * 세 칸을 **함께** 보내라. 무엇이 쓸모 있는지는 서버가 정한다.
   *
   * 후보가 하나도 없어도 오류가 아니다 — `steps` 에 어느 길에서 무엇 때문에
   * 넘어졌는지 담겨 온다. 화면은 그걸 그대로 보여 줘야 한다. "찾지 못했습니다"
   * 한 줄로 뭉개면 사람이 다음에 무엇을 할지 알 수 없다.
   */
  lookup: async (q: {
    doi?: string | null;
    arxiv?: string | null;
    title?: string | null;
  }): Promise<LookupReport> => {
    const p = new URLSearchParams();
    if (q.doi?.trim()) p.set("doi", q.doi.trim());
    if (q.arxiv?.trim()) p.set("arxiv", q.arxiv.trim());
    if (q.title?.trim()) p.set("title", q.title.trim());
    if ([...p.keys()].length === 0) return { candidates: [], steps: [] };
    const json = await send<LookupReport>(`/api/lookup?${p.toString()}`);
    return { candidates: json.candidates ?? [], steps: json.steps ?? [] };
  },

  // ── 찾기 ────────────────────────────────────────────────
  /**
   * 서재에서 찾는다. **판정은 서버가 한다** — 열한 자리를 한꺼번에 본다.
   *
   * 인자 이름이 `query` 인 데는 이유가 있다. 이 모듈에는
   * `const q = (s) => encodeURIComponent(s)` 가 있어서 인자를 `q` 로 받으면
   * **그 인코더가 문자열에 가려진다.** 그러면 `q(query)` 가 "문자열을 부르려
   * 했다" 로 터진다. 다른 곳(`lookup`)이 같은 이름으로 가리고 있는데 거기서는
   * 인코더를 안 써서 아직 안 드러났을 뿐이다.
   *
   * `signal` 은 `send()` 가 `init` 을 그대로 `fetch` 로 펼치므로 그냥 통한다.
   * 사람이 한 글자 칠 때마다 부르는 자리라, **먼저 보낸 요청을 끊지 않으면
   * 늦게 도착한 옛 답이 새 답을 덮는다.** 부르는 쪽이 반드시 실어 보내라.
   *
   * 질의가 비면 아예 안 부른다. 서버도 빈 결과를 주지만, 글자를 다 지운 순간
   * 오갈 이유가 없는 요청 하나가 나가는 것을 여기서 막는다.
   *
   * 답을 벗기지 않고 `SearchResponse` 를 그대로 돌려준다. `hits` 말고도
   * "낱말이 너무 많다" · "결과가 잘렸다" · "질의를 잘랐다" 가 함께 오고,
   * 그건 화면이 사람에게 해 줘야 하는 말이다.
   *
   * **질의는 사람이 친 그대로 넘겨라.** 접기는 서버가 화면과 같은 규칙
   * (`normalizeForSearch`)으로 맡는다. 미리 눕혀(소문자 · NFC) 보내면 서버가
   * 사람이 친 글자를 못 보게 되고, 잘랐다는 말과 낱말 수는 사람이 친 것
   * 기준이어야 한다. 여기서 손대는 것은 앞뒤 공백과 길이뿐이다.
   *
   * **"두 번 접어도 같으니 상관없다" 고 생각하지 마라 — 같지 않다.** 유니코드
   * 전체를 한 번 훑어 재 보면 두 번 접은 값이 달라지는 자리가 여섯 있다
   * (`Α` + U+0342 처럼 그리스 결합 기호가 붙은 꼴; NFC 뒤에 소문자를 씌우면
   * 결과가 NFC 가 아니게 되어 다음 판에 또 바뀐다). 지금 규칙에서 그것이
   * 문제가 안 되는 이유는 멱등이라서가 아니라 **양쪽이 원본을 딱 한 번씩만
   * 접기 때문**이다. 그러니 어느 쪽에든 접기를 한 겹 더 얹지 마라.
   */
  search: async (
    query: string,
    init?: { signal?: AbortSignal },
  ): Promise<SearchResponse> => {
    const asked = query.trim();
    if (!asked) return { hits: [] };

    /*
     * **주소에 싣기 전에 자른다.** 여기서 안 자르면 431 이고, 431 은 서버
     * 코드가 한 줄도 안 돌고 나므로 "잘랐다" 는 말조차 할 수 없다.
     * 자르는 자리는 낱말 사이다 — 왜인지는 `clipQuery` 에 적어 뒀다.
     */
    const sent = clipQuery(asked);

    /*
     * 낱말 하나가 통째로 상한을 넘어 남는 것이 없으면 **부르지 않는다.**
     * 서버도 빈 질의에는 빈 결과를 주지만, 답이 뻔한 요청 하나가 사람이
     * 글자를 칠 때마다 나가는 것을 여기서 막는다. 잘랐다는 말은 그대로 한다.
     */
    if (!sent) return { hits: [], queryTruncated: true };

    const json = await send<Partial<SearchResponse>>(`/api/search?q=${q(sent)}`, init);
    return {
      hits: json.hits ?? [],
      tooManyWords: json.tooManyWords,
      truncated: json.truncated,
      // 라우트도 자르지만(주소를 손으로 친 경우), 여기서 자른 것은 서버가 모른다.
      queryTruncated: json.queryTruncated || sent !== asked,
    };
  },

  // ── 서지정보 제안 ───────────────────────────────────────
  /**
   * 에이전트에게 빈 칸을 맡긴다. **찾아오기가 먼저 돈 뒤에 부른다.**
   *
   * `start` 에 넘기는 `clue` 는 방금 `lookup` 이 받아 온 값이다. 등록기관이
   * 준 것은 정확한 것이고 모델이 PDF 를 읽어 내놓는 것은 추측이라, 정확한
   * 것을 먼저 쥐여 주지 않으면 같은 칸에 두 값이 앉고 어느 쪽이 맞는지
   * 사람이 가려야 한다. 순서를 뒤집지 마라.
   *
   * 여기서도 **논문은 바뀌지 않는다.** 제안은 `paper_suggestions` 에 앉고,
   * 논문이 바뀌는 것은 사람이 확인한 값을 싣는 `updatePaper` 뿐이다.
   */
  biblio: {
    /**
     * 지금 상태. `suggestionId` 를 주면 그 제안을, 안 주면 가장 최근 것을 본다.
     *
     * **이 요청이 서버 쪽 진행을 민다.** 순수한 읽기가 아닌 것은 알고 쓴다.
     * 부를 수 있는지(`agent`)도 함께 온다 — 시트가 열릴 때 한 번으로
     * "토글을 켜도 되는가" 와 "받아 둔 제안이 있는가" 를 같이 알아야 한다.
     */
    status: (paperId: string, suggestionId?: string): Promise<BiblioAgentState> =>
      send<BiblioAgentState>(
        `/api/papers/${q(paperId)}/suggest${suggestionId ? `?id=${q(suggestionId)}` : ""}`,
      ),

    /** 시작만 시키고 번호를 받는다. 끝은 `status` 로 물어본다. */
    start: async (
      paperId: string,
      clue?: BiblioClue | null,
    ): Promise<BiblioSuggestionDTO | null> => {
      const json = await send<{ suggestion: BiblioSuggestionDTO | null }>(
        `/api/papers/${q(paperId)}/suggest`,
        jsonInit("POST", { kind: "biblio", clue: clue ?? null }),
      );
      return json.suggestion;
    },

    /**
     * "봤고 적용했다" 는 표시. **논문을 바꾸는 요청이 아니다.**
     *
     * 저장(`updatePaper`)이 성공한 **뒤에** 부른다. 순서가 그래야 저장이
     * 실패했는데 "적용됨" 으로 남는 일이 없다.
     */
    markApplied: (paperId: string, suggestionId: string): Promise<void> =>
      send<unknown>(
        `/api/papers/${q(paperId)}/suggest`,
        jsonInit("PATCH", { id: suggestionId, applied: true }),
      ).then(() => undefined),
  },

  // ── 논문 대화 ───────────────────────────────────────────
  /**
   * 이 논문을 두고 나누는 대화. **논문마다 따로 이어진다.**
   *
   * 서재 머리말의 채팅창(`/api/agent/chat`)과 길이 다르다. 저쪽은 Discord 와
   * 공유하는 세션 하나를 보고, 이쪽은 `paperId` 로 갈린 세션을 본다. 주소가
   * `/api/papers/:id/chat` 인 것이 곧 그 뜻이다 — 논문에 딸린 대화다.
   *
   * 여기서도 **논문은 바뀌지 않는다.** 이 함수들이 건드리는 것은 대화뿐이고,
   * 서지정보·요약·앵커 메모는 사람이 화면에서 저장할 때만 바뀐다.
   */
  paperChat: {
    /**
     * 지난 대화와 "지금 부를 수 있는가" 를 한 번에 받는다.
     *
     * 둘을 따로 묻지 않는 이유는 대화창이 열릴 때 둘 다 필요하기 때문이다.
     * 못 부르는 이유는 서버가 문장으로 준다 — 화면이 짐작해 적으면 진짜
     * 이유(환경변수가 없다 / 안 떠 있다)가 어디에도 안 나온다.
     */
    history: (paperId: string): Promise<PaperChatHistory> =>
      send<PaperChatHistory>(`/api/papers/${q(paperId)}/chat?history=1`),

    /**
     * 시작만 시키고 번호를 받는다. 끝은 `status` 로 물어본다.
     *
     * `context` 는 계약에 있는 칸이지만 지금 화면은 안 싣는다 — 자세한 것은
     * 프록시 라우트의 `bodySchema` 주석에 적었다.
     */
    send: async (
      paperId: string,
      message: string,
      context?: string,
    ): Promise<{ id: string | null }> => {
      const json = await send<{ id?: string }>(
        `/api/papers/${q(paperId)}/chat`,
        jsonInit("POST", { message, ...(context ? { context } : {}) }),
      );
      return { id: json.id ?? null };
    },

    /**
     * 진행 상황. 없는 작업이면 404 로 온다 — 부르는 쪽이 `HttpError.status`
     * 로 알아보고 기록을 다시 읽는다.
     *
     * `signal` 을 받는다. 대화를 지우거나 화면을 떠날 때 돌던 폴링을 끊어야
     * 늦게 온 답이 없는 대화에 끼어들지 않는다.
     */
    status: (paperId: string, job: string, signal?: AbortSignal): Promise<PaperChatStatus> =>
      send<PaperChatStatus>(`/api/papers/${q(paperId)}/chat?job=${q(job)}`, { signal }),

    /** 이 논문의 대화만 버린다. 다른 논문과 Discord 쪽 맥락은 그대로다. */
    reset: (paperId: string): Promise<void> =>
      send<unknown>(`/api/papers/${q(paperId)}/chat`, { method: "DELETE" }).then(() => undefined),
  },

  // ── 요약 ────────────────────────────────────────────────
  /** 본문은 목록에 안 실린다 — 서재 한 화면에 수백 편이 온다. 여기서 따로 받는다. */
  getSummary: async (paperId: string): Promise<SummaryDTO | null> => {
    const json = await send<{ summary: SummaryDTO | null }>(
      `/api/papers/${q(paperId)}/summary`,
    );
    return json.summary;
  },

  saveSummary: async (
    paperId: string,
    body: string,
    opts: { source?: "human" | "agent"; instruction?: string | null } = {},
  ): Promise<{ summary: SummaryDTO | null; groups: GroupDTO[] }> => {
    const json = await send<{ summary: SummaryDTO | null; groups?: GroupDTO[] }>(
      `/api/papers/${q(paperId)}/summary`,
      jsonInit("PUT", { body, ...opts }),
    );
    return { summary: json.summary, groups: json.groups ?? [] };
  },

  deleteSummary: (paperId: string) =>
    mutate(`/api/papers/${q(paperId)}/summary`, { method: "DELETE" }),

  // ── 메모 ────────────────────────────────────────────────
  listNotes: async (paperId: string): Promise<NoteDTO[]> => {
    const json = await send<{ notes?: NoteDTO[] }>(`/api/papers/${q(paperId)}/notes`);
    return json.notes ?? [];
  },

  createNote: async (
    paperId: string,
    anchor: Anchor,
    body = "",
    color: ItemColor | null = null,
  ): Promise<{ notes: NoteDTO[]; noteId: string; groups: GroupDTO[] }> => {
    const json = await send<{ notes?: NoteDTO[]; noteId: string; groups?: GroupDTO[] }>(
      `/api/papers/${q(paperId)}/notes`,
      jsonInit("POST", { anchor, body, color }),
    );
    return { notes: json.notes ?? [], noteId: json.noteId, groups: json.groups ?? [] };
  },

  updateNote: async (
    paperId: string,
    noteId: string,
    patch: { body?: string; color?: ItemColor | null; anchor?: Anchor },
  ): Promise<NoteDTO[]> => {
    const json = await send<{ notes?: NoteDTO[] }>(
      `/api/papers/${q(paperId)}/notes/${q(noteId)}`,
      jsonInit("PATCH", patch),
    );
    return json.notes ?? [];
  },

  deleteNote: async (
    paperId: string,
    noteId: string,
  ): Promise<{ notes: NoteDTO[]; groups: GroupDTO[] }> => {
    const json = await send<{ notes?: NoteDTO[]; groups?: GroupDTO[] }>(
      `/api/papers/${q(paperId)}/notes/${q(noteId)}`,
      { method: "DELETE" },
    );
    return { notes: json.notes ?? [], groups: json.groups ?? [] };
  },

  // ── 표지 ────────────────────────────────────────────────
  /**
   * 브라우저가 그린 첫 쪽을 표지로 붙인다.
   *
   * `dataUrl` 은 `data:image/webp;base64,…` 통째로 준다 — 접두어를 떼고 보내면
   * 서버가 종류를 알 수 없다. base64 조각만 보내다가 그림이 조용히 깨진 적이 있다.
   */
  putThumb: (fileId: string, dataUrl: string) =>
    mutate(`/api/files/${q(fileId)}/thumb`, jsonInit("POST", { thumb: dataUrl })),

  // ── 설정 ────────────────────────────────────────────────
  getConfig: async (): Promise<AppConfigDTO> => {
    const json = await send<{ config: AppConfigDTO }>("/api/config");
    return json.config;
  },

  /**
   * 고칠 칸만 실어 보낸다. **안 실은 칸은 서버가 손대지 않는다.**
   *
   * 설정 화면이 요약 프리셋과 서지정보 지시문을 따로 저장하기 때문에 이 구분이
   * 필요하다. 한쪽을 저장할 때 전부를 실어 보내면, 다른 쪽에서 아직 적고 있던
   * 글이 화면에 있던 옛 값으로 덮인다.
   *
   * 돌려받는 것은 서버가 세운 뒤의 설정 전체다 — 새로 붙은 프리셋 `id` 처럼
   * 서버에서 정해지는 것이 있어서, 화면은 이 답으로 갈아 끼워야 한다.
   */
  saveConfig: async (patch: Partial<AppConfigDTO>): Promise<AppConfigDTO> => {
    const json = await send<{ config: AppConfigDTO }>("/api/config", jsonInit("PUT", patch));
    return json.config;
  },

  // ── 휴지통 ──────────────────────────────────────────────
  trash: {
    list: async (): Promise<TrashEntryDTO[]> => {
      const json = await send<{ trash?: TrashEntryDTO[] }>("/api/trash");
      return json.trash ?? [];
    },

    /** 되살리기·비우기는 서가도 함께 바뀐다. 둘 다 돌려받아 한 번에 갈아 끼운다. */
    restore: (id: string) => trashAction({ action: "restore", id }),
    purge: (id: string) => trashAction({ action: "purge", id }),
    empty: () => trashAction({ action: "empty" }),
  },
};

async function trashAction(
  body: { action: "restore" | "purge"; id: string } | { action: "empty" },
): Promise<{ trash: TrashEntryDTO[]; groups: GroupDTO[] }> {
  const json = await send<{ trash?: TrashEntryDTO[]; groups?: GroupDTO[] }>(
    "/api/trash",
    jsonInit("POST", body),
  );
  return { trash: json.trash ?? [], groups: json.groups ?? [] };
}
