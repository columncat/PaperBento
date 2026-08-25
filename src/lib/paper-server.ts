import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { db, schema } from "./db";
import type {
  Anchor,
  FileDTO,
  GroupDTO,
  NoteDTO,
  PaperDTO,
  SubGroupDTO,
  SummaryDTO,
} from "./types";
import { uid } from "./uid";

/**
 * 그룹·논문·요약·메모의 단일 진입점.
 *
 * 라우트는 여기 있는 함수만 부른다. SQL 이 라우트로 새어 나가면 같은 규칙이
 * 여러 벌 생기고, 그중 하나만 고치는 날이 온다 — 특히 "깊이는 두 단" 처럼
 * 여러 입구에서 지켜야 하는 규칙이 그렇다.
 */

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what}을(를) 찾을 수 없습니다`);
    this.name = "NotFoundError";
  }
}

export class LockedError extends Error {
  constructor(name: string) {
    super(`"${name}" 은(는) 시스템 그룹이라 이름을 바꾸거나 지울 수 없습니다`);
    this.name = "LockedError";
  }
}

/** 세 단이 되려는 것을 막았을 때. 사람이 읽을 문구로 던진다. */
export class TooDeepError extends Error {
  constructor(msg = "그룹은 두 단까지입니다. 하위 그룹은 다시 하위 그룹을 가질 수 없습니다") {
    super(msg);
    this.name = "TooDeepError";
  }
}

// ─────────────────────────────────────────────────────────────
//   시스템 그룹
// ─────────────────────────────────────────────────────────────

/** 밖에서 들어온 PDF 가 갈 곳을 못 정했을 때 놓이는 자리. */
export const INBOX_GROUP_ID = "sys-inbox";

export function ensureSystemGroups(): void {
  db.insert(schema.groups)
    .values({
      id: INBOX_GROUP_ID,
      name: "Inbox",
      depth: 0,
      parentId: null,
      systemKey: "inbox",
      position: -1, // 늘 맨 앞
    })
    .onConflictDoNothing()
    .run();
}

// ─────────────────────────────────────────────────────────────
//   읽기
// ─────────────────────────────────────────────────────────────

function fileDto(f: typeof schema.files.$inferSelect | undefined): FileDTO | null {
  if (!f) return null;
  return {
    id: f.id,
    name: f.name,
    ext: f.ext,
    mimeType: f.mimeType,
    size: f.size,
    kind: f.kind,
    hasThumb: f.thumbPath !== null,
  };
}

/**
 * 서재 전체를 한 번에 읽는다.
 *
 * 논문 수백 편까지는 이 편이 훨씬 단순하다 — 화면이 그룹을 펼칠 때마다
 * 더 받아 오는 길을 만들면 상태가 두 곳으로 갈린다. 요약 본문과 메모 본문은
 * 싣지 않고 있는지 여부와 개수만 얹는다. 그게 목록이 커지는 진짜 원인이다.
 *
 * 수천 편이 되면 접힌 그룹의 papers 를 빈 배열로 내리고 펼칠 때 받아 오면
 * 된다. DTO 모양이 그대로라 화면은 안 바뀐다.
 */
export function listGroups(): GroupDTO[] {
  ensureSystemGroups();

  const groupRows = db
    .select()
    .from(schema.groups)
    .orderBy(asc(schema.groups.position), asc(schema.groups.createdAt))
    .all();

  const paperRows = db
    .select()
    .from(schema.papers)
    .orderBy(asc(schema.papers.position), asc(schema.papers.createdAt))
    .all();

  const fileRows = db.select().from(schema.files).all();
  const filesById = new Map(fileRows.map((f) => [f.id, f]));

  // 요약과 메모는 "있는가 / 몇 개인가" 만 필요하다. 본문을 끌고 오지 않는다.
  const summaryIds = new Set(
    db
      .select({ id: schema.paperSummaries.paperId })
      .from(schema.paperSummaries)
      .all()
      .map((r) => r.id),
  );
  const noteCounts = new Map<string, number>();
  for (const r of db
    .select({ paperId: schema.paperNotes.paperId, n: sql<number>`count(*)` })
    .from(schema.paperNotes)
    .groupBy(schema.paperNotes.paperId)
    .all()) {
    noteCounts.set(r.paperId, Number(r.n));
  }

  const papersByGroup = new Map<string, PaperDTO[]>();
  for (const p of paperRows) {
    const dto: PaperDTO = {
      id: p.id,
      groupId: p.groupId,
      title: p.title,
      authors: p.authors,
      venue: p.venue,
      year: p.year,
      doi: p.doi,
      arxivId: p.arxivId,
      abstract: p.abstract,
      tags: p.tags,
      url: p.url,
      readState: p.readState,
      mark: p.mark,
      position: p.position,
      file: fileDto(p.fileId ? filesById.get(p.fileId) : undefined),
      hasSummary: summaryIds.has(p.id),
      noteCount: noteCounts.get(p.id) ?? 0,
      createdAt: p.createdAt.getTime(),
      updatedAt: p.updatedAt.getTime(),
    };
    const list = papersByGroup.get(p.groupId);
    if (list) list.push(dto);
    else papersByGroup.set(p.groupId, [dto]);
  }

  const childrenByParent = new Map<string, SubGroupDTO[]>();
  for (const g of groupRows) {
    if (g.depth !== 1 || !g.parentId) continue;
    const sub: SubGroupDTO = {
      id: g.id,
      name: g.name,
      parentId: g.parentId,
      description: g.description,
      color: g.color,
      viewMode: g.viewMode,
      position: g.position,
      collapsed: g.collapsed === 1,
      papers: papersByGroup.get(g.id) ?? [],
    };
    const list = childrenByParent.get(g.parentId);
    if (list) list.push(sub);
    else childrenByParent.set(g.parentId, [sub]);
  }

  return groupRows
    .filter((g) => g.depth === 0)
    .map((g) => ({
      id: g.id,
      name: g.name,
      parentId: null as null,
      description: g.description,
      color: g.color,
      viewMode: g.viewMode,
      systemKey: g.systemKey,
      position: g.position,
      collapsed: g.collapsed === 1,
      papers: papersByGroup.get(g.id) ?? [],
      children: childrenByParent.get(g.id) ?? [],
    }));
}

export function getGroupRow(id: string) {
  return db.select().from(schema.groups).where(eq(schema.groups.id, id)).get();
}

export function getPaperRow(id: string) {
  return db.select().from(schema.papers).where(eq(schema.papers.id, id)).get();
}

// ─────────────────────────────────────────────────────────────
//   그룹 쓰기
// ─────────────────────────────────────────────────────────────

/**
 * 부모로 삼아도 되는지 본다.
 *
 * DB 의 복합 외래키가 이미 3단을 막지만, 거기 걸리면 오류 문구가 "FOREIGN KEY
 * constraint failed" 다. 사람이 무엇을 잘못했는지 알 수 없고, MCP 로 들어온
 * 에이전트도 마찬가지다. 그래서 여기서 먼저 보고 읽을 수 있는 말로 던진다.
 */
function assertCanParent(parentId: string): void {
  const parent = getGroupRow(parentId);
  if (!parent) throw new NotFoundError("상위 그룹");
  if (parent.depth !== 0) throw new TooDeepError();
}

function nextPosition(parentId: string | null): number {
  const row = db
    .select({ max: sql<number | null>`max(${schema.groups.position})` })
    .from(schema.groups)
    .where(parentId === null ? isNull(schema.groups.parentId) : eq(schema.groups.parentId, parentId))
    .get();
  return (row?.max ?? 0) + 1;
}

export function createGroup(input: { name: string; parentId?: string | null }): string {
  const name = input.name.trim();
  if (!name) throw new Error("이름이 비어 있습니다");
  const parentId = input.parentId ?? null;
  if (parentId) assertCanParent(parentId);

  const id = uid();
  db.insert(schema.groups)
    .values({
      id,
      name,
      depth: parentId ? 1 : 0,
      parentId,
      position: nextPosition(parentId),
    })
    .run();
  return id;
}

export interface UpdateGroupInput {
  name?: string;
  description?: string | null;
  color?: GroupDTO["color"];
  viewMode?: GroupDTO["viewMode"];
  collapsed?: boolean;
  /**
   * 옮기기. `null` 이면 뿌리로 꺼낸다.
   *
   * **여기가 가장 새기 쉬운 자리다.** 만들 때만 깊이를 보면, 뿌리에 만든
   * 그룹(자식을 여럿 거느린)을 나중에 다른 그룹 밑으로 넣어 3단이 된다.
   */
  parentId?: string | null;
}

export function updateGroup(id: string, patch: UpdateGroupInput): void {
  const row = getGroupRow(id);
  if (!row) throw new NotFoundError("그룹");
  if (row.systemKey && (patch.name !== undefined || patch.parentId !== undefined)) {
    throw new LockedError(row.name);
  }

  db.transaction((tx) => {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new Error("이름이 비어 있습니다");
      set.name = name;
    }
    if (patch.description !== undefined) set.description = patch.description;
    if (patch.color !== undefined) set.color = patch.color;
    if (patch.viewMode !== undefined) set.viewMode = patch.viewMode;
    if (patch.collapsed !== undefined) set.collapsed = patch.collapsed ? 1 : 0;

    if (patch.parentId !== undefined) {
      const nextParent = patch.parentId;
      if (nextParent === id) throw new TooDeepError("자기 자신 밑으로 넣을 수 없습니다");

      if (nextParent === null) {
        // 뿌리로 꺼내기. 이건 언제나 된다 — 깊이가 줄어드는 쪽이다.
        set.depth = 0;
        set.parentId = null;
      } else {
        const parent = tx
          .select()
          .from(schema.groups)
          .where(eq(schema.groups.id, nextParent))
          .get();
        if (!parent) throw new NotFoundError("상위 그룹");
        if (parent.depth !== 0) throw new TooDeepError();

        /*
         * 자식을 거느린 그룹은 남의 밑으로 못 들어간다.
         *
         * DB 의 외래키는 "이 행의 부모가 온전한가" 만 본다. 자기 **자식**이
         * 함께 2단 아래로 밀려나는 것은 못 본다 — 그 자식들의 parentDepth 는
         * 그대로라 검사가 통과해 버린다. 그러니 여기서 막아야 한다.
         */
        const kids = tx
          .select({ n: sql<number>`count(*)` })
          .from(schema.groups)
          .where(eq(schema.groups.parentId, id))
          .get();
        if (Number(kids?.n ?? 0) > 0) {
          throw new TooDeepError(
            "하위 그룹을 가진 그룹은 다른 그룹 밑으로 옮길 수 없습니다. 먼저 하위 그룹을 꺼내세요",
          );
        }
        set.depth = 1;
        set.parentId = nextParent;
      }
      // 옮기면 형제가 달라진다. 맨 뒤로 보낸다.
      const sib = tx
        .select({ max: sql<number | null>`max(${schema.groups.position})` })
        .from(schema.groups)
        .where(
          patch.parentId === null
            ? isNull(schema.groups.parentId)
            : eq(schema.groups.parentId, patch.parentId),
        )
        .get();
      set.position = (sib?.max ?? 0) + 1;
    }

    tx.update(schema.groups).set(set).where(eq(schema.groups.id, id)).run();
  });
}

/**
 * 형제 안에서 순서를 다시 매긴다.
 *
 * **트랜잭션 안에서 한다.** MailBento 의 계정 순서 바꾸기는 트랜잭션 없이
 * for 문으로 UPDATE 를 돌리는데, 중간에 끊기면 반쯤 적용된 순서가 남는다.
 * 보관함 쪽은 트랜잭션으로 감싸 두었고 그쪽이 옳다.
 */
export function reorderGroups(parentId: string | null, orderedIds: string[]): void {
  db.transaction((tx) => {
    const siblings = tx
      .select({ id: schema.groups.id, systemKey: schema.groups.systemKey })
      .from(schema.groups)
      .where(parentId === null ? isNull(schema.groups.parentId) : eq(schema.groups.parentId, parentId))
      .all();
    /*
     * 시스템 그룹은 순서를 못 바꾼다.
     *
     * `ensureSystemGroups()` 가 Inbox 를 `position: -1` 로 놓아 늘 맨 앞에
     * 세운다. 여기서 형제를 0부터 다시 매기면 Inbox 도 함께 0,1,2… 를 받아
     * **-1 을 영영 잃는다.** 뿌리 순서를 한 번만 바꿔도 그렇게 되고, 그 뒤로는
     * 되돌릴 길이 없다(`ensureSystemGroups` 는 onConflictDoNothing 이라 이미
     * 있는 행의 position 을 손대지 않는다).
     *
     * 그래서 건너뛴다. 화면이 Inbox 를 끼워 보낸 순서를 보내와도 Inbox 는
     * -1 에 남고, 나머지 형제만 0부터 촘촘해진다.
     */
    const allowed = new Set(siblings.filter((r) => !r.systemKey).map((r) => r.id));
    let i = 0;
    for (const id of orderedIds) {
      if (!allowed.has(id)) continue; // 남의 형제를, 그리고 시스템 그룹을 끼워 넣지 못하게
      tx.update(schema.groups)
        .set({ position: i, updatedAt: new Date() })
        .where(eq(schema.groups.id, id))
        .run();
      i += 1;
    }
  });
}

// ─────────────────────────────────────────────────────────────
//   논문 쓰기
// ─────────────────────────────────────────────────────────────

export interface CreatePaperInput {
  groupId: string;
  title: string;
  fileId?: string | null;
  authors?: string | null;
  venue?: string | null;
  year?: number | null;
  doi?: string | null;
  arxivId?: string | null;
  abstract?: string | null;
  tags?: string | null;
  url?: string | null;
}

export function createPaper(input: CreatePaperInput): string {
  const group = getGroupRow(input.groupId);
  if (!group) throw new NotFoundError("그룹");
  const title = input.title.trim() || "제목 없음";

  const id = uid();
  const pos = db
    .select({ max: sql<number | null>`max(${schema.papers.position})` })
    .from(schema.papers)
    .where(eq(schema.papers.groupId, input.groupId))
    .get();

  db.insert(schema.papers)
    .values({
      id,
      groupId: input.groupId,
      fileId: input.fileId ?? null,
      title,
      authors: input.authors ?? null,
      venue: input.venue ?? null,
      year: input.year ?? null,
      doi: input.doi ?? null,
      arxivId: input.arxivId ?? null,
      abstract: input.abstract ?? null,
      tags: input.tags ?? null,
      url: input.url ?? null,
      position: (pos?.max ?? 0) + 1,
    })
    .run();
  return id;
}

export interface UpdatePaperInput extends Partial<Omit<CreatePaperInput, "groupId">> {
  groupId?: string;
  readState?: PaperDTO["readState"];
  mark?: PaperDTO["mark"];
  /** PDF 에서 뽑아 둔 앞부분. 에이전트에게 넘길 재료라 서버만 쓴다. */
  headText?: string | null;
}

export function updatePaper(id: string, patch: UpdatePaperInput): void {
  const row = getPaperRow(id);
  if (!row) throw new NotFoundError("논문");

  db.transaction((tx) => {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.title !== undefined) set.title = patch.title.trim() || "제목 없음";
    for (const k of ["authors", "venue", "doi", "arxivId", "abstract", "tags", "url"] as const) {
      if (patch[k] !== undefined) set[k] = patch[k];
    }
    if (patch.year !== undefined) set.year = patch.year;
    if (patch.fileId !== undefined) set.fileId = patch.fileId;
    if (patch.readState !== undefined) set.readState = patch.readState;
    if (patch.mark !== undefined) set.mark = patch.mark;
    if (patch.headText !== undefined) {
      set.headText = patch.headText;
      set.headTextAt = patch.headText === null ? null : new Date();
    }

    if (patch.groupId !== undefined && patch.groupId !== row.groupId) {
      const target = tx
        .select()
        .from(schema.groups)
        .where(eq(schema.groups.id, patch.groupId))
        .get();
      if (!target) throw new NotFoundError("옮길 그룹");
      set.groupId = patch.groupId;
      const pos = tx
        .select({ max: sql<number | null>`max(${schema.papers.position})` })
        .from(schema.papers)
        .where(eq(schema.papers.groupId, patch.groupId))
        .get();
      set.position = (pos?.max ?? 0) + 1;
    }

    tx.update(schema.papers).set(set).where(eq(schema.papers.id, id)).run();
  });
}

export function reorderPapers(groupId: string, orderedIds: string[]): void {
  db.transaction((tx) => {
    const mine = new Set(
      tx
        .select({ id: schema.papers.id })
        .from(schema.papers)
        .where(eq(schema.papers.groupId, groupId))
        .all()
        .map((r) => r.id),
    );
    let i = 0;
    for (const id of orderedIds) {
      if (!mine.has(id)) continue;
      tx.update(schema.papers)
        .set({ position: i, updatedAt: new Date() })
        .where(eq(schema.papers.id, id))
        .run();
      i += 1;
    }
  });
}

/** 같은 DOI·arXiv 번호가 이미 있는지. 막지 않고 알려 주기만 한다. */
export function findDuplicates(opts: {
  doi?: string | null;
  arxivId?: string | null;
  exceptId?: string;
}): { id: string; title: string }[] {
  const keys: ReturnType<typeof eq>[] = [];
  if (opts.doi?.trim()) keys.push(eq(schema.papers.doi, opts.doi.trim()));
  if (opts.arxivId?.trim()) keys.push(eq(schema.papers.arxivId, opts.arxivId.trim()));
  if (keys.length === 0) return [];

  return db
    .select({ id: schema.papers.id, title: schema.papers.title })
    .from(schema.papers)
    .where(keys.length === 1 ? keys[0] : sql`${keys[0]} or ${keys[1]}`)
    .all()
    .filter((r) => r.id !== opts.exceptId);
}

// ─────────────────────────────────────────────────────────────
//   요약 — 논문당 하나
// ─────────────────────────────────────────────────────────────

export function getSummary(paperId: string): SummaryDTO | null {
  const row = db
    .select()
    .from(schema.paperSummaries)
    .where(eq(schema.paperSummaries.paperId, paperId))
    .get();
  if (!row) return null;
  return {
    paperId: row.paperId,
    body: row.body,
    source: row.source,
    instruction: row.instruction,
    updatedAt: row.updatedAt.getTime(),
  };
}

/**
 * 요약을 넣거나 고친다.
 *
 * 사람이 고치면 출처가 사람이 된다. 에이전트가 만든 것을 손보면 그때부터
 * 그건 사람의 글이고, 다음에 다시 만들 때 덮어써도 되는지 물어야 한다.
 */
export function setSummary(
  paperId: string,
  body: string,
  opts: { source?: "human" | "agent"; instruction?: string | null } = {},
): void {
  if (!getPaperRow(paperId)) throw new NotFoundError("논문");
  const source = opts.source ?? "human";
  db.insert(schema.paperSummaries)
    .values({
      paperId,
      body,
      source,
      instruction: opts.instruction ?? null,
    })
    .onConflictDoUpdate({
      target: schema.paperSummaries.paperId,
      set: {
        body,
        source,
        ...(opts.instruction !== undefined ? { instruction: opts.instruction } : {}),
        updatedAt: new Date(),
      },
    })
    .run();
}

export function deleteSummary(paperId: string): void {
  db.delete(schema.paperSummaries).where(eq(schema.paperSummaries.paperId, paperId)).run();
}

// ─────────────────────────────────────────────────────────────
//   메모 — PDF 위 자리
// ─────────────────────────────────────────────────────────────

function noteDto(row: typeof schema.paperNotes.$inferSelect): NoteDTO {
  let anchor: Anchor;
  try {
    anchor = JSON.parse(row.anchor) as Anchor;
  } catch {
    // 앵커가 깨져도 메모 글은 살린다. 자리는 1쪽 머리로 떨어뜨린다.
    anchor = { v: 1, page: row.page, rects: [], box: [0, 0, 0, 0] };
  }
  return {
    id: row.id,
    paperId: row.paperId,
    page: row.page,
    anchor,
    body: row.body,
    color: row.color,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

/** 읽는 순서대로. 쪽 → 쪽 안에서는 위에서 아래로. */
export function listNotes(paperId: string): NoteDTO[] {
  return db
    .select()
    .from(schema.paperNotes)
    .where(eq(schema.paperNotes.paperId, paperId))
    .orderBy(asc(schema.paperNotes.page), asc(schema.paperNotes.createdAt))
    .all()
    .map(noteDto)
    .sort((a, b) => a.page - b.page || a.anchor.box[1] - b.anchor.box[1]);
}

export function createNote(input: {
  paperId: string;
  anchor: Anchor;
  body: string;
  color?: NoteDTO["color"];
}): string {
  if (!getPaperRow(input.paperId)) throw new NotFoundError("논문");
  const id = uid();
  db.insert(schema.paperNotes)
    .values({
      id,
      paperId: input.paperId,
      page: input.anchor.page,
      anchor: JSON.stringify(input.anchor),
      body: input.body,
      color: input.color ?? null,
    })
    .run();
  return id;
}

export function updateNote(
  id: string,
  patch: { body?: string; color?: NoteDTO["color"]; anchor?: Anchor },
): void {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.body !== undefined) set.body = patch.body;
  if (patch.color !== undefined) set.color = patch.color;
  if (patch.anchor !== undefined) {
    set.anchor = JSON.stringify(patch.anchor);
    set.page = patch.anchor.page;
  }
  const r = db.update(schema.paperNotes).set(set).where(eq(schema.paperNotes.id, id)).run();
  if (r.changes === 0) throw new NotFoundError("메모");
}

export function deleteNote(id: string): void {
  db.delete(schema.paperNotes).where(eq(schema.paperNotes.id, id)).run();
}

// ─────────────────────────────────────────────────────────────
//   내보내기 — 백업
// ─────────────────────────────────────────────────────────────

/** 파일 바이트는 뺀 전부. 되살릴 때 파일은 따로 챙겨야 한다. */
export function exportAll() {
  return {
    version: 1 as const,
    groups: db.select().from(schema.groups).orderBy(asc(schema.groups.position)).all(),
    papers: db.select().from(schema.papers).orderBy(asc(schema.papers.position)).all(),
    summaries: db.select().from(schema.paperSummaries).all(),
    notes: db.select().from(schema.paperNotes).orderBy(desc(schema.paperNotes.createdAt)).all(),
    files: db.select().from(schema.files).all(),
  };
}

/** 지울 때 딸려 사라질 것들을 미리 센다. 확인 문구에 쓴다. */
export function groupContents(id: string): { papers: number; children: number } {
  const kids = db
    .select({ id: schema.groups.id })
    .from(schema.groups)
    .where(eq(schema.groups.parentId, id))
    .all()
    .map((r) => r.id);
  const ids = [id, ...kids];
  const n = db
    .select({ n: sql<number>`count(*)` })
    .from(schema.papers)
    .where(inArray(schema.papers.groupId, ids))
    .get();
  return { papers: Number(n?.n ?? 0), children: kids.length };
}

export { and, eq };
