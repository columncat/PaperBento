import { asc, eq, inArray, lt } from "drizzle-orm";

import { db, schema } from "./db";
import { removeStored } from "./file-store";
import type { TrashEntryDTO } from "./types";
import { uid } from "./uid";

/**
 * 30일 휴지통.
 *
 * 지운 그룹·논문을 스냅샷으로 담아두고 그 기간 안에는 되살릴 수 있다.
 *
 * 논문은 메모보다 되살리기가 훨씬 중요하다. 메모는 다시 적으면 그만이지만
 * 논문은 PDF 를 딸고 있어서, 잘못 지우면 사람이 그 파일을 다시 구해 와야 한다.
 * 그래서 만료 전까지 `files` 행도 디스크의 바이트도 건드리지 않는다 — 되살리면
 * 같은 파일이 그대로 다시 붙는다. 실제로 지우는 것은 만료되거나 사람이 영구
 * 삭제를 눌렀을 때뿐이다.
 *
 * 그룹을 지우면 **하위 그룹과 그 안의 논문까지 전부** 스냅샷에 담는다. 담지
 * 않으면 되살리기가 껍데기만 돌려준다 — 서가는 돌아오는데 안이 비어 있는
 * 것이 가장 나쁘다. 지웠다는 것도 모르고 넘어가기 때문이다.
 */

export const RETENTION_DAYS = 30;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 모양은 `types.ts` 에 있다 — 브라우저도 같은 것을 읽기 때문이다.
 * 여기서는 이름만 짧게 빌려 쓴다.
 */
export type TrashEntry = TrashEntryDTO;

// ─────────────────────────────────────────────────────────────
//   스냅샷 모양
// ─────────────────────────────────────────────────────────────

type GroupRow = typeof schema.groups.$inferSelect;
type PaperRow = typeof schema.papers.$inferSelect;
type SummaryRow = typeof schema.paperSummaries.$inferSelect;
type NoteRow = typeof schema.paperNotes.$inferSelect;

/** 트랜잭션 핸들. drizzle 이 콜백에 넘겨주는 것과 정확히 같은 타입을 뽑아 쓴다. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * 스냅샷 행 타입은 **스키마에서 파생한다.**
 *
 * MemoBento 에서 컬럼을 손으로 나열했다가 크게 데였다. 컬럼이 늘어날 때마다
 * 스냅샷에서 조용히 빠지고, 지웠다 되살리면 그 값들만 기본값으로 돌아왔다.
 * 오류가 아니라 "복원은 됐는데 뭔가 달라진" 상태라 한참 뒤에야 발견된다.
 * 타입을 파생시켜 두면 다음에 늘어나는 컬럼은 컴파일에서 걸린다.
 *
 * `Date` 는 JSON 에 담기지 않으므로 숫자(ms)로 바꾼다. `headTextAt` 처럼
 * 널 가능한 날짜도 있어서 `Date extends T[K]` 로 본다 — `T[K] extends Date`
 * 로 쓰면 `Date | null` 이 걸러지지 않고 ISO 문자열이 되어 되살릴 때 깨진다.
 */
type Snap<T> = {
  [K in keyof T]: Date extends T[K] ? Exclude<T[K], Date> | number : T[K];
};

/**
 * `parentDepth` 는 뺀다.
 *
 * `depth - 1` 로 계산되는 가상 컬럼이라 넣을 수가 없다. 스냅샷에 들고 있다가
 * 그대로 INSERT 하면 "cannot INSERT into generated column" 으로 되살리기가
 * 통째로 실패한다.
 */
type GroupSnap = Omit<Snap<GroupRow>, "parentDepth">;
type PaperSnap = Snap<PaperRow>;
type SummarySnap = Snap<SummaryRow>;
type NoteSnap = Snap<NoteRow>;

/** 논문 한 편과 거기 딸린 전부. 요약과 메모가 없으면 되살려도 반쪽이다. */
interface PaperBundle {
  paper: PaperSnap;
  summary: SummarySnap | null;
  notes: NoteSnap[];
}

interface GroupPayload {
  group: GroupSnap;
  /** 하위 그룹. 깊이가 두 단이라 이 배열은 다시 아래를 갖지 않는다. */
  children: GroupSnap[];
  /** 본체와 하위 그룹에 있던 논문 전부. 각자 groupId 를 들고 있어 제자리로 돌아간다. */
  papers: PaperBundle[];
}

type PaperPayload = PaperBundle;

const snapGroup = (row: GroupRow): GroupSnap => {
  // parentDepth 가 select 결과에 있든 없든 여기서 떨어져 나간다.
  const { parentDepth: _generated, ...rest } = row as GroupRow & {
    parentDepth?: unknown;
  };
  return {
    ...rest,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
};

const snapPaper = (row: PaperRow): PaperSnap => ({
  ...row,
  createdAt: row.createdAt.getTime(),
  updatedAt: row.updatedAt.getTime(),
  headTextAt: row.headTextAt ? row.headTextAt.getTime() : null,
});

const snapSummary = (row: SummaryRow): SummarySnap => ({
  ...row,
  createdAt: row.createdAt.getTime(),
  updatedAt: row.updatedAt.getTime(),
});

const snapNote = (row: NoteRow): NoteSnap => ({
  ...row,
  createdAt: row.createdAt.getTime(),
  updatedAt: row.updatedAt.getTime(),
});

/**
 * 되돌리기. `updatedAt` 이 없는 옛 스냅샷은 `createdAt` 으로 채운다 —
 * 스냅샷 모양이 늘어나기 전에 들어간 것이 휴지통에 남아 있을 수 있다.
 */
const unsnapGroup = (s: GroupSnap) => ({
  ...s,
  createdAt: new Date(s.createdAt),
  updatedAt: new Date(s.updatedAt ?? s.createdAt),
});

const unsnapPaper = (s: PaperSnap) => ({
  ...s,
  createdAt: new Date(s.createdAt),
  updatedAt: new Date(s.updatedAt ?? s.createdAt),
  headTextAt: s.headTextAt == null ? null : new Date(s.headTextAt),
});

const unsnapSummary = (s: SummarySnap) => ({
  ...s,
  createdAt: new Date(s.createdAt),
  updatedAt: new Date(s.updatedAt ?? s.createdAt),
});

const unsnapNote = (s: NoteSnap) => ({
  ...s,
  createdAt: new Date(s.createdAt),
  updatedAt: new Date(s.updatedAt ?? s.createdAt),
});

// ─────────────────────────────────────────────────────────────
//   담기
// ─────────────────────────────────────────────────────────────

/** 논문 하나와 거기 딸린 요약·메모를 읽어 묶는다. */
function bundleOf(paper: PaperRow): PaperBundle {
  const summary =
    db
      .select()
      .from(schema.paperSummaries)
      .where(eq(schema.paperSummaries.paperId, paper.id))
      .get() ?? null;
  const notes = db
    .select()
    .from(schema.paperNotes)
    .where(eq(schema.paperNotes.paperId, paper.id))
    .all();
  return {
    paper: snapPaper(paper),
    summary: summary ? snapSummary(summary) : null,
    notes: notes.map(snapNote),
  };
}

/**
 * 그룹을 통째로 휴지통에 넣는다. 하위 그룹과 논문이 함께 딸려 간다.
 *
 * 시스템 그룹(Inbox)은 여기서 막는다. 라우트에서만 막으면 MCP 나 백업 복원
 * 같은 다른 입구로 새어 들어온다 — 그러면 "밖에서 온 PDF 가 갈 곳" 자체가
 * 사라지고, 다음에 들어온 논문이 놓일 자리가 없어진다.
 */
export function trashGroup(groupId: string): void {
  const group = db.select().from(schema.groups).where(eq(schema.groups.id, groupId)).get();
  if (!group) throw new Error("그룹을 찾을 수 없습니다");
  if (group.systemKey) {
    throw new Error(`"${group.name}" 은(는) 시스템 그룹이라 지울 수 없습니다`);
  }

  const children = db
    .select()
    .from(schema.groups)
    .where(eq(schema.groups.parentId, groupId))
    .all();
  const groupIds = [groupId, ...children.map((c) => c.id)];

  const papers = db
    .select()
    .from(schema.papers)
    .where(inArray(schema.papers.groupId, groupIds))
    .all();

  const payload: GroupPayload = {
    group: snapGroup(group),
    children: children.map(snapGroup),
    papers: papers.map(bundleOf),
  };

  db.transaction((tx) => {
    tx.insert(schema.trash)
      .values({
        id: uid(),
        kind: "group",
        label: group.name,
        groupId: null,
        payload: JSON.stringify(payload),
      })
      .run();

    /*
     * 스냅샷을 먼저 넣고 나서 지운다. 그리고 CASCADE 에 기대지 않고 아래에서
     * 위로 직접 지운다 — 마이그레이션이 만든 외래키에 ON DELETE CASCADE 가
     * 정말 붙었는지, PRAGMA foreign_keys 가 켜져 있는지에 따라 결과가 달라지면
     * 안 되는 자리다. 남으면 곧 고아 행이 된다.
     */
    const paperIds = papers.map((p) => p.id);
    if (paperIds.length > 0) {
      tx.delete(schema.paperNotes).where(inArray(schema.paperNotes.paperId, paperIds)).run();
      tx.delete(schema.paperSummaries)
        .where(inArray(schema.paperSummaries.paperId, paperIds))
        .run();
      tx.delete(schema.papers).where(inArray(schema.papers.id, paperIds)).run();
    }
    if (children.length > 0) {
      tx.delete(schema.groups)
        .where(inArray(schema.groups.id, children.map((c) => c.id)))
        .run();
    }
    tx.delete(schema.groups).where(eq(schema.groups.id, groupId)).run();
  });
}

/** 논문 하나를 휴지통에 넣는다. 파일은 만료 전까지 그대로 둔다. */
export function trashPaper(paperId: string): void {
  const paper = db.select().from(schema.papers).where(eq(schema.papers.id, paperId)).get();
  if (!paper) throw new Error("논문을 찾을 수 없습니다");

  const payload: PaperPayload = bundleOf(paper);

  db.transaction((tx) => {
    tx.insert(schema.trash)
      .values({
        id: uid(),
        kind: "paper",
        label: paper.title.slice(0, 120) || "제목 없음",
        groupId: paper.groupId,
        payload: JSON.stringify(payload),
      })
      .run();

    tx.delete(schema.paperNotes).where(eq(schema.paperNotes.paperId, paperId)).run();
    tx.delete(schema.paperSummaries)
      .where(eq(schema.paperSummaries.paperId, paperId))
      .run();
    tx.delete(schema.papers).where(eq(schema.papers.id, paperId)).run();
  });
}

// ─────────────────────────────────────────────────────────────
//   보기
// ─────────────────────────────────────────────────────────────

function parsePayload<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function listTrash(): TrashEntry[] {
  purgeExpired();

  const rows = db.select().from(schema.trash).orderBy(asc(schema.trash.deletedAt)).all();
  const groupRows = db.select().from(schema.groups).all();
  const names = new Map(groupRows.map((g) => [g.id, g.name]));
  const depths = new Map(groupRows.map((g) => [g.id, g.depth]));

  return rows.map((r) => {
    const deletedAt = r.deletedAt.getTime();
    const daysLeft = Math.max(0, Math.ceil((deletedAt + RETENTION_MS - Date.now()) / DAY_MS));

    let papers = 0;
    let children = 0;
    let blockedReason: string | null = null;

    if (r.kind === "group") {
      const snap = parsePayload<GroupPayload>(r.payload);
      papers = snap?.papers.length ?? 0;
      children = snap?.children.length ?? 0;
      const parentId = snap?.group.parentId ?? null;
      if (parentId && !names.has(parentId)) {
        blockedReason = "원래 상위 그룹이 없습니다 — 상위 그룹을 먼저 되살리세요";
      } else if (parentId && depths.get(parentId) !== 0) {
        blockedReason = "원래 상위 그룹이 하위 그룹이 되었습니다";
      }
    } else {
      papers = 1;
      if (!r.groupId || !names.has(r.groupId)) {
        blockedReason = "원래 그룹이 없습니다 — 그룹을 먼저 되살리세요";
      }
    }

    return {
      id: r.id,
      kind: r.kind,
      label: r.label,
      groupName: r.groupId ? (names.get(r.groupId) ?? null) : null,
      papers,
      children,
      deletedAt,
      daysLeft,
      restorable: blockedReason === null,
      blockedReason,
    };
  });
}

// ─────────────────────────────────────────────────────────────
//   되살리기
// ─────────────────────────────────────────────────────────────

/** 논문 한 묶음을 제자리에 되돌린다. 그룹이 있는지는 부르는 쪽이 이미 봤다. */
function restoreBundle(tx: Tx, b: PaperBundle): void {
  tx.insert(schema.papers).values(unsnapPaper(b.paper)).onConflictDoNothing().run();
  if (b.summary) {
    tx.insert(schema.paperSummaries)
      .values(unsnapSummary(b.summary))
      .onConflictDoNothing()
      .run();
  }
  for (const n of b.notes) {
    tx.insert(schema.paperNotes).values(unsnapNote(n)).onConflictDoNothing().run();
  }
}

export function restoreFromTrash(trashId: string): void {
  const row = db.select().from(schema.trash).where(eq(schema.trash.id, trashId)).get();
  if (!row) throw new Error("휴지통 항목을 찾을 수 없습니다");

  if (row.kind === "group") {
    const snap = parsePayload<GroupPayload>(row.payload);
    if (!snap) throw new Error("스냅샷이 깨져 되살릴 수 없습니다");

    /*
     * 깊이는 여기서도 본다.
     *
     * 지운 뒤에 세상이 바뀔 수 있다. 하위 그룹이던 것을 지웠는데 그 사이 상위
     * 그룹이 남의 밑으로 들어갔다면, 그대로 되돌리면 3단이 된다. DB 의 복합
     * 외래키가 막아 주긴 하지만 그때 뜨는 말은 "FOREIGN KEY constraint failed"
     * 라 사람이 무엇을 해야 할지 알 수 없다.
     */
    const parentId = snap.group.parentId;
    if (parentId) {
      const parent = db.select().from(schema.groups).where(eq(schema.groups.id, parentId)).get();
      if (!parent) throw new Error("원래 상위 그룹이 없습니다 — 상위 그룹을 먼저 되살리세요");
      if (parent.depth !== 0) {
        throw new Error("원래 상위 그룹이 하위 그룹이 되어 되살릴 수 없습니다");
      }
    }

    db.transaction((tx) => {
      tx.insert(schema.groups).values(unsnapGroup(snap.group)).onConflictDoNothing().run();
      for (const c of snap.children) {
        tx.insert(schema.groups).values(unsnapGroup(c)).onConflictDoNothing().run();
      }
      // 논문은 그룹이 다 선 뒤에. 자기 groupId 를 들고 있어 제자리로 간다.
      const alive = new Set(
        tx.select({ id: schema.groups.id }).from(schema.groups).all().map((g) => g.id),
      );
      for (const b of snap.papers) {
        if (!alive.has(b.paper.groupId)) continue; // 갈 곳 없는 것은 건너뛴다
        restoreBundle(tx, b);
      }
      tx.delete(schema.trash).where(eq(schema.trash.id, trashId)).run();
    });
    return;
  }

  const snap = parsePayload<PaperPayload>(row.payload);
  if (!snap) throw new Error("스냅샷이 깨져 되살릴 수 없습니다");

  const target = db
    .select()
    .from(schema.groups)
    .where(eq(schema.groups.id, snap.paper.groupId))
    .get();
  if (!target) throw new Error("원래 그룹이 없습니다 — 그룹을 먼저 되살리세요");

  db.transaction((tx) => {
    restoreBundle(tx, snap);
    tx.delete(schema.trash).where(eq(schema.trash.id, trashId)).run();
  });
}

// ─────────────────────────────────────────────────────────────
//   비우기 — 여기서 처음으로 파일이 실제로 사라진다
// ─────────────────────────────────────────────────────────────

/** 항목 하나를 지금 영구 삭제 (딸린 파일까지). */
export async function purgeOne(trashId: string): Promise<void> {
  const row = db.select().from(schema.trash).where(eq(schema.trash.id, trashId)).get();
  if (!row) return;
  await removeFilesOf(row.kind, row.payload);
  db.delete(schema.trash).where(eq(schema.trash.id, trashId)).run();
}

/** 휴지통 전체 비우기. */
export async function purgeAll(): Promise<number> {
  const rows = db.select().from(schema.trash).all();
  for (const r of rows) {
    await removeFilesOf(r.kind, r.payload);
    db.delete(schema.trash).where(eq(schema.trash.id, r.id)).run();
  }
  return rows.length;
}

/**
 * 만료된 항목 정리. 목록을 볼 때마다 한 번씩 돈다.
 *
 * 따로 도는 청소 작업을 두지 않는 이유는, 이 앱이 대부분의 시간 동안 아무도
 * 안 보는 NAS 위에서 잠들어 있기 때문이다. 볼 때 치우면 충분하다.
 */
export function purgeExpired(): void {
  const cutoff = new Date(Date.now() - RETENTION_MS);
  const rows = db.select().from(schema.trash).where(lt(schema.trash.deletedAt, cutoff)).all();
  for (const r of rows) {
    // 목록 읽기를 파일 삭제가 붙들지 않게 한다. 실패해도 다음 기회에 다시 돈다.
    void removeFilesOf(r.kind, r.payload);
    db.delete(schema.trash).where(eq(schema.trash.id, r.id)).run();
  }
}

/**
 * 스냅샷이 붙들고 있던 파일을 실제로 지운다.
 *
 * 지우기 전에 **살아 있는 다른 논문이 같은 파일을 보고 있는지** 본다. 같은
 * PDF 를 두 서가에 두려고 복제하면 fileId 가 겹치는데, 한쪽을 영구 삭제했다고
 * 바이트를 지우면 멀쩡한 다른 논문이 깨진 파일을 가리키게 된다.
 */
async function removeFilesOf(kind: string, payload: string): Promise<void> {
  let fileIds: string[] = [];
  if (kind === "group") {
    const snap = parsePayload<GroupPayload>(payload);
    fileIds = (snap?.papers ?? [])
      .map((b) => b.paper.fileId)
      .filter((v): v is string => !!v);
  } else {
    const snap = parsePayload<PaperPayload>(payload);
    if (snap?.paper.fileId) fileIds = [snap.paper.fileId];
  }

  for (const fid of new Set(fileIds)) {
    const stillUsed = db
      .select({ id: schema.papers.id })
      .from(schema.papers)
      .where(eq(schema.papers.fileId, fid))
      .get();
    if (stillUsed) continue;

    const f = db.select().from(schema.files).where(eq(schema.files.id, fid)).get();
    if (!f) continue;
    await removeStored(f.path, f.thumbPath);
    db.delete(schema.files).where(eq(schema.files.id, fid)).run();
  }
}
