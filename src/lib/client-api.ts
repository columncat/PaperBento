import { apiPath } from "./api-path";
import { readJson } from "./read-json";
import type {
  Anchor,
  AppConfigDTO,
  GroupDTO,
  ItemColor,
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
  /** PDF 에서 뽑아 둔 앞부분. 에이전트에게 넘길 재료라 목록으로는 안 내려온다. */
  headText?: string | null;
}

/*
 * 모양은 `types.ts` 가 들고 있다. 여기서 다시 적으면 서버 쪽 정의와 갈라진다.
 * 부르는 쪽이 `client-api` 에서 함께 꺼내 쓰던 것이 있어 이름은 그대로 내보낸다.
 */
export type { AppConfigDTO, TrashEntryDTO } from "./types";

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
