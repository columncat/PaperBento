import { apiPath } from "./api-path";
import type {
  FileKind,
  ItemColor,
  PaperMark,
  ReadState,
  ViewMode,
} from "./db/schema";

export type { FileKind, ItemColor, PaperMark, ReadState, ViewMode };

/**
 * 화면으로 내려가는 모양.
 *
 * DB 행을 그대로 내리지 않는다. `parentDepth` 같은 것은 제약을 걸려고 만든
 * 것이지 화면이 알 일이 아니고, 반대로 `hasSummary` 처럼 화면에 필요한 것은
 * 행에 없다.
 */

export interface FileDTO {
  id: string;
  name: string;
  ext: string;
  mimeType: string;
  size: number;
  kind: FileKind;
  /** 표지 썸네일이 있는가. 없으면 화면이 첫 쪽을 그려 만들어 올린다. */
  hasThumb: boolean;
}

export interface PaperDTO {
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
  readState: ReadState;
  mark: PaperMark | null;
  position: number;
  file: FileDTO | null;
  /** 요약이 있는가. 본문은 목록에 싣지 않는다 — 서재 한 화면에 수백 편이 온다. */
  hasSummary: boolean;
  /** 붙어 있는 메모 수. */
  noteCount: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * 서가 안의 칸. **여기서 더 깊어지지 않는다.**
 *
 * `GroupDTO` 와 달리 `children` 이 없다. 타입에 그 자리를 만들지 않는 것이
 * 세 겹 방어의 셋째다 — 화면 코드가 3단을 그리려야 그릴 수 없다.
 */
export interface SubGroupDTO {
  id: string;
  name: string;
  parentId: string;
  description: string | null;
  color: ItemColor | null;
  viewMode: ViewMode;
  position: number;
  collapsed: boolean;
  papers: PaperDTO[];
}

export interface GroupDTO {
  id: string;
  name: string;
  parentId: null;
  description: string | null;
  color: ItemColor | null;
  viewMode: ViewMode;
  /** 값이 있으면 이름 변경과 삭제가 막힌다. */
  systemKey: string | null;
  position: number;
  collapsed: boolean;
  /** 이 서가에 바로 놓인 논문. */
  papers: PaperDTO[];
  /** 서가 안의 칸들. 이들은 더 이상 칸을 갖지 못한다. */
  children: SubGroupDTO[];
}

export interface SummaryDTO {
  paperId: string;
  body: string;
  source: "human" | "agent";
  instruction: string | null;
  updatedAt: number;
}

/**
 * PDF 위의 자리.
 *
 * 좌표는 **쪽 크기에 대한 비율**이다 (0~1, y 는 위에서부터). 배율을 바꾸거나
 * 창을 줄여도 자리가 버티게 하려면 픽셀이면 안 된다. 기준은 pdf.js 가 그리는
 * `.page` 요소이고 캔버스가 아니다 — 캔버스는 다시 그리는 동안 CSS 로 늘려
 * 두는 구간이 있어 그때 어긋난다.
 *
 * `quote` 는 보험이다. 같은 논문의 다른 판본으로 PDF 를 갈아 끼우면 좌표가
 * 통째로 어긋나는데, 그때 글자로 다시 찾을 수 있다. 앞뒤 몇 글자를 함께 두는
 * 것은 같은 문장이 여러 번 나올 때 가리기 위해서다.
 */
export interface Anchor {
  /** 모양이 바뀌면 올린다. 옛 메모를 읽을 때 갈래를 탄다. */
  v: 1;
  page: number;
  /** 칠할 조각들. [x, y, w, h] 비율. */
  rects: [number, number, number, number][];
  /** rects 를 감싸는 상자. 스크롤 목표는 이것만 본다. */
  box: [number, number, number, number];
  /** 고른 글자. 없을 수 있다 — 글자 없는 자리를 짚었을 때. */
  quote?: string;
  prefix?: string;
  suffix?: string;
}

export interface NoteDTO {
  id: string;
  paperId: string;
  page: number;
  anchor: Anchor;
  body: string;
  color: ItemColor | null;
  createdAt: number;
  updatedAt: number;
}

// ─────────────────────────────────────────────────────────────
//   주소
// ─────────────────────────────────────────────────────────────

/** 저장된 바이트 그대로. Range 를 지원하므로 PDF 뷰어가 조각으로 받는다. */
export function fileUrl(fileId: string, dl = false): string {
  return apiPath(`/api/files/${encodeURIComponent(fileId)}${dl ? "?dl=1" : ""}`);
}

/**
 * 표지로 쓸 주소. 없으면 null → 화면이 아이콘으로 대신한다.
 *
 * PDF 는 원본을 걸 수 없다(`<img>` 에 물리지 못한다). 그래서 표지는 브라우저가
 * 첫 쪽을 그려 만들어 올린 것이 있을 때만 뜬다.
 */
export function coverUrl(file: Pick<FileDTO, "id" | "kind" | "hasThumb">): string | null {
  if (file.hasThumb) return apiPath(`/api/files/${encodeURIComponent(file.id)}/thumb`);
  if (file.kind === "image") return fileUrl(file.id);
  return null;
}

/** 논문 상세 주소. */
export function paperUrl(paperId: string): string {
  return `/papers/${encodeURIComponent(paperId)}`;
}

// ─────────────────────────────────────────────────────────────
//   보기 좋게
// ─────────────────────────────────────────────────────────────

export function formatBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(1)}GB`;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`;
  if (n >= 1024) return `${Math.round(n / 1024)}KB`;
  return `${n}B`;
}

/** 서지정보 한 줄. 비어 있는 것은 건너뛴다. */
export function citationLine(p: Pick<PaperDTO, "authors" | "venue" | "year">): string {
  return [p.authors, p.venue, p.year != null ? String(p.year) : null]
    .filter((v) => v && String(v).trim())
    .join(" · ");
}

/** 논문 한 편이 몇 편인지 세는 자리에서 쓴다 — 칸에 든 것까지 더한다. */
export function countPapers(g: GroupDTO): number {
  return g.papers.length + g.children.reduce((n, c) => n + c.papers.length, 0);
}

// ─────────────────────────────────────────────────────────────
//   휴지통 · 앱 설정
// ─────────────────────────────────────────────────────────────

/*
 * 이 둘도 다른 DTO 와 같은 자리에 둔다.
 *
 * 서버(`lib/trash.ts`)와 브라우저(`lib/client-api.ts`)가 각자 같은 모양을
 * 손으로 적어 두면, 한쪽에 칸을 더할 때 다른 쪽은 조용히 옛 모양으로 남는다.
 * 타입이 갈라져도 JSON 은 그대로 흐르므로 컴파일러가 못 잡는다.
 */

export interface TrashEntryDTO {
  id: string;
  kind: "group" | "paper";
  label: string;
  /** 논문이라면 원래 있던 서가 이름 (서가가 이미 없으면 null). */
  groupName: string | null;
  /** 서가라면 딸려 들어간 것의 수. "무엇이 함께 사라졌는지" 를 보여 준다. */
  papers: number;
  children: number;
  deletedAt: number;
  /** 자동 삭제까지 남은 일수. */
  daysLeft: number;
  /** 지금 되살릴 수 있는가. 돌아갈 자리가 없으면 false. */
  restorable: boolean;
  /** 되살릴 수 없다면 그 이유. 화면이 그대로 보여 준다. */
  blockedReason: string | null;
}

export interface AppConfigDTO {
  agentSuggestDefault: boolean;
  summaryPresets: string[];
}
