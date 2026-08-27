import { apiPath } from "./api-path";
import { uid } from "./uid";
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
  /**
   * 받아 온 CSL-JSON 원본이 붙어 있는가.
   *
   * 본문은 안 싣는다 — 한 편에 1~2KB 라 수백 편이 오는 목록에 실으면 그것만
   * 으로 무거워진다. 화면은 "내보내기가 온전할 것인가" 만 알면 되고, 그건
   * 있는지 여부로 충분하다.
   */
  hasCsl: boolean;
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
//   서지정보 찾아오기 · 내보내기
// ─────────────────────────────────────────────────────────────

/*
 * 모양은 `lookup.ts` 와 `csl.ts` 가 정의하고 여기서는 이름만 다시 내보낸다.
 *
 * 두 벌로 적으면 한쪽에 칸을 더할 때 다른 쪽이 조용히 옛 모양으로 남는다 —
 * JSON 은 그대로 흐르므로 컴파일러가 못 잡는다 (휴지통 DTO 에서 겪었다).
 * 화면 코드는 늘 `types.ts` 만 보면 되도록 여기에 창구를 둔다.
 */
export type {
  LookupQuery,
  LookupReport,
  LookupResult,
  LookupSource,
  LookupStep,
} from "./lookup";

export type { BibFields, CSLItem, CSLName, ExportFormat } from "./csl";
export { EXPORT_EXT, EXPORT_FORMATS } from "./csl";

/** 내보내기 주소. 논문 하나·서가 하나·서재 전체 어느 쪽이든 이 한 곳이다. */
export function bibExportUrl(opts: {
  paperId?: string;
  groupId?: string;
  format: import("./csl").ExportFormat;
}): string {
  const p = new URLSearchParams();
  if (opts.paperId) p.set("paper", opts.paperId);
  if (opts.groupId) p.set("group", opts.groupId);
  p.set("format", opts.format);
  return apiPath(`/api/export/bib?${p.toString()}`);
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

/**
 * 요약 지시문 프리셋 하나.
 *
 * **예전에는 문자열 하나였다** — 첫 줄이 이름이고 전문이 지시문이라는 규칙이
 * 있었다. 읽는 쪽이 요약 상자 하나뿐일 때는 그 규칙이 공짜였다. 설정에서
 * 고치게 되는 순간 값이 비싸진다: 이름을 고치려면 지시문의 첫 줄을 고쳐야
 * 하고, 지시문 앞에 한 줄을 덧대면 이름이 바뀌어 버린다. 사람이 고치는 칸이
 * 둘이면 저장되는 칸도 둘이어야 한다.
 *
 * `id` 는 순서를 바꿔도 흔들리지 않는 손잡이다. 목록 자리(index)를 열쇠로
 * 쓰면 위/아래로 옮길 때 React 가 다른 줄의 상태(펼쳐 둔 것, 커서)를 끌고 온다.
 */
export interface SummaryPreset {
  id: string;
  /** 목록에 한 줄로 보이는 이름. */
  name: string;
  /** 에이전트에게 실제로 가는 글. */
  prompt: string;
}

/** 새 프리셋의 id. 화면과 서버가 같은 것을 써야 저장 왕복에서 줄이 안 바뀐다. */
export function newPresetId(): string {
  return `p-${uid()}`;
}

/**
 * 처음 켰을 때 쓸 지시문들. **설정의 "기본값으로 되돌리기" 도 이것을 되살린다.**
 *
 * 프리셋이 하나도 없으면 요약 상자에 고를 것이 없고, 사람은 매번 지시문을
 * 손으로 적어야 한다. 그건 "에이전트에게 맡기기" 를 한 번도 안 누르게 되는
 * 가장 빠른 길이다.
 *
 * 서버(`api/config`)와 설정 화면이 이 한 벌을 함께 본다. 각자 한 벌씩 들고
 * 있으면 "되돌리기" 로 돌아온 것이 서버가 아는 기본값과 미묘하게 다른 날이 온다.
 */
export const DEFAULT_SUMMARY_PRESETS: readonly SummaryPreset[] = [
  {
    id: "p-core5",
    name: "핵심만 다섯 줄",
    prompt: [
      "이 논문의 핵심을 다섯 줄 안팎으로 정리해 주세요. 무엇을 풀려고 했는지,",
      "어떻게 풀었는지, 무엇이 새로운지, 결과가 어땠는지, 한계가 무엇인지를",
      "각각 한 줄씩 담아 주세요.",
    ].join("\n"),
  },
  {
    id: "p-onepage",
    name: "한 쪽 요약",
    prompt: [
      "이 논문을 한 쪽 분량으로 요약해 주세요. 배경과 문제, 제안하는 방법,",
      "실험 설정과 결과, 저자가 인정한 한계 순서로 소제목을 달아 주세요.",
      "수치는 논문에 적힌 것만 쓰고, 없으면 없다고 적어 주세요.",
    ].join("\n"),
  },
  {
    id: "p-method",
    name: "방법과 실험 위주",
    prompt: [
      "방법과 실험에 초점을 맞춰 정리해 주세요. 모델·알고리즘의 구조,",
      "학습·평가에 쓴 자료, 비교 대상, 측정 지표, 주요 수치를 담아 주세요.",
      "배경 설명과 관련 연구는 짧게 넘어가도 됩니다.",
    ].join("\n"),
  },
  {
    id: "p-novelty",
    name: "기존 연구와 무엇이 다른가",
    prompt: [
      "이 논문이 기존 연구와 무엇이 다른지에 초점을 맞춰 정리해 주세요.",
      "저자가 어떤 선행 연구를 들고 있고, 그 한계를 무엇이라고 말하며,",
      "그것을 어떻게 넘어섰다고 주장하는지 적어 주세요. 그 주장이 실험으로",
      "뒷받침되는지도 함께 짚어 주세요.",
    ].join("\n"),
  },
  {
    id: "p-reproduce",
    name: "내가 다시 만들 수 있게",
    prompt: [
      "이 논문을 직접 구현해 보려는 사람에게 필요한 것을 정리해 주세요.",
      "입력과 출력, 핵심 수식이나 절차, 하이퍼파라미터, 필요한 자료와 계산량,",
      "논문에 안 적혀 있어 막힐 만한 자리를 짚어 주세요.",
    ].join("\n"),
  },
];

/**
 * 서지정보 제안에 쓸 지시문의 기본값.
 *
 * 여기 적는 것은 **무엇을 찾아 달라고 할지**뿐이다. 출력 형식과 울타리 규칙은
 * `lib/suggest.ts` 안에 박혀 있고 밖에서 바꿀 수 없다 — 그게 바뀔 수 있으면
 * 허용목록 파싱이 무엇을 막고 있었는지가 사라진다.
 */
export const DEFAULT_BIBLIO_PROMPT = [
  "이 논문의 서지정보를 찾아 주세요. 제목, 저자, 실린 곳(학술지·학회·프리프린트),",
  "발행 연도, DOI, arXiv 번호, 초록을 논문에 적힌 그대로 옮겨 주세요.",
  "본문에서 확인되지 않는 값은 지어내지 말고 비워 두세요.",
].join("\n");

export interface AppConfigDTO {
  agentSuggestDefault: boolean;
  /** 요약 상자가 고르는 목록. 비어 있는 채로 내려오지 않는다 — 서버가 기본값으로 채운다. */
  summaryPresets: SummaryPreset[];
  /**
   * 서지정보 제안에 쓸 지시문. **하나뿐이다.**
   *
   * 요약과 달리 여러 개를 둘 이유가 없다 — 찾아올 칸이 정해져 있어 "이번엔
   * 다르게 시켜 보기" 가 성립하지 않는다. 그래서 설정 화면에서도 프리셋 목록과
   * 갈라서 그린다. 같은 목록에 섞으면 "고르는 것" 과 "하나뿐인 것" 이 한
   * 덩어리로 보인다.
   */
  biblioPrompt: string;
}
