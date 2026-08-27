import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/*
 * 열거값은 여기 한 곳에 두고 화면과 zod 검증이 함께 가져다 쓴다.
 * 두 벌로 두면 한쪽만 늘어나는 날이 반드시 온다 (MailBento 관례).
 */

/** 그룹 표시 방식. 그룹마다 따로 저장된다. */
export const VIEW_MODES = ["list", "grid"] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

/** 눈에 띄게 하려고 붙이는 표식. */
export const PAPER_MARKS = ["star", "circle", "triangle", "cross", "exclaim", "check"] as const;
export type PaperMark = (typeof PAPER_MARKS)[number];

/** 읽기 상태. 논문은 "읽음/안읽음" 둘로는 모자란다 — 읽다 만 것이 대부분이다. */
export const READ_STATES = ["unread", "reading", "read"] as const;
export type ReadState = (typeof READ_STATES)[number];

/** 색. 그룹과 메모에 쓴다. */
export const ITEM_COLORS = [
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "violet",
  "pink",
] as const;
export type ItemColor = (typeof ITEM_COLORS)[number];

/** 파일 갈래. PaperBento 는 pdf 가 본체지만 표지 이미지 따위가 붙을 수 있다. */
export const FILE_KINDS = ["pdf", "image", "text", "file"] as const;
export type FileKind = (typeof FILE_KINDS)[number];

/**
 * 시스템 예약 그룹.
 *
 * 이름 바꾸기와 지우기가 잠긴다. 지금은 하나뿐이다 — 밖에서(에이전트·다른 앱)
 * 들어온 PDF 가 갈 곳을 정하지 못했을 때 놓이는 자리. MemoBento 의 Inbox 와
 * 같은 생각이다: 어디 둘지 나중에 정해도 잃어버리지 않아야 한다.
 */
export const GROUP_SYSTEM_KEYS = ["inbox"] as const;
export type GroupSystemKey = (typeof GROUP_SYSTEM_KEYS)[number];

const stamp = (name: string) =>
  integer(name, { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`);

// ─────────────────────────────────────────────────────────────
//   논문 그룹 — 딱 두 단
// ─────────────────────────────────────────────────────────────

/**
 * 논문 그룹. 서가 한 칸.
 *
 * **깊이는 0 아니면 1 뿐이다.** 그룹이 그룹을 품을 수 있지만 그 안의 그룹은
 * 또 품지 못한다. 이 규칙을 세 군데에서 각각 지킨다.
 *
 * 1. 여기(DB) — `parentDepth` 는 `depth - 1` 로 계산되는 가상 컬럼이고,
 *    `(parentId, parentDepth) → (id, depth)` 복합 외래키가 걸려 있다.
 *    depth 1 인 그룹을 부모로 삼으려면 자식의 depth 가 2 여야 하는데,
 *    `depthCk` 가 2 를 막는다. 즉 **3단은 표현 자체가 불가능하다.**
 * 2. 서버 — 옮기기·만들기는 트랜잭션 안에서 부모의 depth 를 확인한다.
 *    DB 가 막아도 오류 문구가 "제약 위반" 이면 사람이 뭘 잘못했는지 모른다.
 * 3. DTO — 재귀할 자리를 아예 만들지 않는다 (`GroupDTO.children: GroupDTO[]`
 *    가 아니라 `SubGroupDTO[]`). 화면 코드가 3단을 그리려야 그릴 수 없다.
 *
 * 하나로 충분해 보이지만 입구가 넷이다 — 화면 API, MCP, 에이전트, 백업 복원.
 * 특히 **옮기기**에서 샌다. 만들 때만 검사하면 나중에 옮겨서 3단이 된다.
 */
export const groups = sqliteTable(
  "groups",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    /** 0 = 서가, 1 = 서가 안의 칸. 2 는 존재할 수 없다. */
    depth: integer("depth").notNull().default(0),
    parentId: text("parent_id"),
    /**
     * `depth - 1`. 복합 외래키가 가리킬 값을 만들기 위한 것이고 사람이 읽거나
     * 쓰지 않는다. depth 0 이면 -1 이 되는데, 그때는 `parentId` 가 NULL 이라
     * SQLite 가 외래키 검사를 건너뛴다.
     */
    parentDepth: integer("parent_depth").generatedAlwaysAs(sql`depth - 1`, {
      mode: "virtual",
    }),
    description: text("description"),
    color: text("color", { enum: ITEM_COLORS }),
    viewMode: text("view_mode", { enum: VIEW_MODES }).notNull().default("list"),
    /** 값이 있으면 이름 변경·삭제가 막힌다. */
    systemKey: text("system_key", { enum: GROUP_SYSTEM_KEYS }),
    /** 형제 안에서의 순서. 루트끼리 / 같은 부모의 자식끼리만 견준다. */
    position: integer("position").notNull().default(0),
    /** 접어 둔 그룹. 화면에서만 뜻이 있다. */
    collapsed: integer("collapsed").notNull().default(0),
    createdAt: stamp("created_at"),
    updatedAt: stamp("updated_at"),
  },
  (t) => ({
    // 복합 외래키가 가리킬 대상. (id, depth) 가 유일해야 참조할 수 있다.
    identity: uniqueIndex("groups_id_depth_uq").on(t.id, t.depth),
    parentFk: foreignKey({
      columns: [t.parentId, t.parentDepth],
      foreignColumns: [t.id, t.depth],
      name: "groups_parent_fk",
    }).onDelete("cascade"),
    depthCk: check("groups_depth_ck", sql`depth in (0, 1)`),
    // 뿌리인 것과 부모가 없는 것은 같은 말이어야 한다.
    rootCk: check("groups_root_ck", sql`(depth = 0) = (parent_id is null)`),
    // 시스템 그룹은 갈래마다 하나. NULL 끼리는 서로 다르므로 보통 그룹은 제한 없다.
    systemUq: uniqueIndex("groups_system_uq").on(t.systemKey),
    siblingIdx: index("groups_parent_idx").on(t.parentId, t.position),
  }),
);

export type GroupRow = typeof groups.$inferSelect;

// ─────────────────────────────────────────────────────────────
//   파일
// ─────────────────────────────────────────────────────────────

/**
 * 저장된 파일. MemoBento 의 같은 테이블에서 암호화 흔적만 뺀 것이다.
 *
 * 논문 본체(PDF)가 여기 산다. 파일은 그대로 디스크에 놓이고 `/api/files/:id`
 * 가 Range 를 지원하며 서빙한다 — PDF 뷰어가 보이는 쪽만 조각으로 받으려면
 * 그 지원이 있어야 한다.
 */
export const files = sqliteTable("files", {
  id: text("id").primaryKey(),
  /** 올릴 때의 원본 이름. 표시용. */
  name: text("name").notNull(),
  /** 소문자 확장자, 점 없음. */
  ext: text("ext").notNull().default(""),
  mimeType: text("mime_type").notNull().default("application/octet-stream"),
  size: integer("size").notNull().default(0),
  kind: text("kind", { enum: FILE_KINDS }).notNull().default("file"),
  /** UPLOAD_DIR 기준 상대 경로. */
  path: text("path").notNull(),
  /** 표지 썸네일 (없으면 아이콘). 브라우저가 첫 쪽을 그려 만든다. */
  thumbPath: text("thumb_path"),
  createdAt: stamp("created_at"),
});

export type FileRow = typeof files.$inferSelect;

// ─────────────────────────────────────────────────────────────
//   논문
// ─────────────────────────────────────────────────────────────

/**
 * 논문 한 편.
 *
 * MailBento 의 메일과 달리 **앱이 소유하는 1급 행**이다. 메일은 남의 서버가
 * 들고 있어서 사본(archived_messages)과 표식(message_flags)을 따로 둬야 했지만,
 * 논문은 파일도 서지정보도 우리 것이라 한 테이블에 함께 산다.
 *
 * `doi` 에 유일 제약을 걸지 않는다. 두 가지 이유다 — 같은 논문을 두 서가에
 * 두고 싶은 날이 오면 그 길이 막히고, 에이전트가 틀린 DOI 를 제안했을 때
 * 저장이 "제약 위반" 으로 죽는다. 대신 입력하는 자리에서 미리 찾아 알려 준다.
 */
export const papers = sqliteTable(
  "papers",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    /**
     * 본체 PDF. 없을 수 있다 — 서지정보만 먼저 적어 두는 경우.
     * 파일이 지워져도 논문 행은 남아야 하므로 set null 이다.
     */
    fileId: text("file_id").references(() => files.id, { onDelete: "set null" }),

    /** 제목. 파일을 올리면 일단 파일 이름에서 확장자를 뗀 것이 들어간다. */
    title: text("title").notNull(),
    /** 저자. 사람이 읽는 한 줄로 둔다 — 정규화하면 입력이 고달프고 얻는 것이 적다. */
    authors: text("authors"),
    /** 학회·저널 이름. */
    venue: text("venue"),
    year: integer("year"),
    doi: text("doi"),
    arxivId: text("arxiv_id"),
    /** 초록. 서지정보의 일부라 여기 둔다. */
    abstract: text("abstract"),
    /** 사람이 붙이는 꼬리표. 쉼표로 나눈 한 줄. */
    tags: text("tags"),
    /** 원문이나 프로젝트 페이지 주소. */
    url: text("url"),

    /**
     * 받아 온 서지정보 **원본**. CSL-JSON 한 덩어리를 문자열로 넣는다.
     *
     * 위의 칸들과 겹쳐 보이지만 하는 일이 다르다. 위는 사람이 보고 고치는
     * 납작한 모양이고, 이건 **내보낼 때 쓰는 진짜 자료**다. 우리 모양으로만
     * 두면 저자의 성/이름 구분, 편집자, 권·호·쪽, 학회가 열린 도시가 통째로
     * 버려져서 BibTeX 로 나갈 때 되살릴 수 없다. "Vaswani, Shazeer" 를 다시
     * 성과 이름으로 가르는 것은 사람 이름을 아는 일이라 규칙으로 못 한다.
     *
     * 목록 DTO 로는 안 내려간다 — 한 편에 1~2KB 라 서재 한 화면(수백 편)에
     * 실리면 그것만으로 목록이 무거워진다. 있는지 여부만 `hasCsl` 로 간다.
     */
    csl: text("csl"),

    readState: text("read_state", { enum: READ_STATES }).notNull().default("unread"),
    mark: text("mark", { enum: PAPER_MARKS }),
    /** 그룹 안에서의 순서. */
    position: integer("position").notNull().default(0),

    /**
     * PDF 에서 뽑아 둔 앞부분 글자.
     *
     * 에이전트에게 넘길 재료다. 서지정보와 요약을 잇달아 부를 때 두 번 뽑지
     * 않으려고 캐시한다. 없으면 아직 안 뽑은 것이고, 빈 문자열이면 뽑았는데
     * 글자층이 없었다는 뜻이다(스캔본).
     */
    headText: text("head_text"),
    headTextAt: integer("head_text_at", { mode: "timestamp" }),

    createdAt: stamp("created_at"),
    updatedAt: stamp("updated_at"),
  },
  (t) => ({
    byGroup: index("papers_group_idx").on(t.groupId, t.position),
    byDoi: index("papers_doi_idx").on(t.doi),
    byArxiv: index("papers_arxiv_idx").on(t.arxivId),
  }),
);

export type PaperRow = typeof papers.$inferSelect;

// ─────────────────────────────────────────────────────────────
//   요약 — 논문당 하나
// ─────────────────────────────────────────────────────────────

/**
 * 논문 하나에 요약 하나. 마크다운.
 *
 * `papers` 안의 칸으로 두지 않고 테이블을 나눈 이유는 둘이다. 1:1 을 DB 가
 * 지키게 되고(기본키가 곧 paperId), 목록을 읽을 때 긴 글이 딸려 오지 않는다.
 * 서재 화면은 논문 수백 편을 한 번에 그리는데 거기 요약까지 실리면 안 된다.
 */
export const paperSummaries = sqliteTable("paper_summaries", {
  paperId: text("paper_id")
    .primaryKey()
    .references(() => papers.id, { onDelete: "cascade" }),
  body: text("body").notNull().default(""),
  /** 에이전트가 만든 것인지, 사람이 쓴 것인지. 사람이 고치면 사람 것이 된다. */
  source: text("source", { enum: ["human", "agent"] })
    .notNull()
    .default("human"),
  /** 에이전트가 만들었다면 그때 쓴 지시문. 나중에 "왜 이렇게 나왔지" 를 되짚는다. */
  instruction: text("instruction"),
  createdAt: stamp("created_at"),
  updatedAt: stamp("updated_at"),
});

export type SummaryRow = typeof paperSummaries.$inferSelect;

// ─────────────────────────────────────────────────────────────
//   제안 — 에이전트가 내놓은 것. 아직 논문이 아니다
// ─────────────────────────────────────────────────────────────

/**
 * 제안의 갈래.
 *
 * `biblio` 는 서지정보 제안이고 `summary` 는 요약 만들기다. 둘 다 여기 앉는
 * 이유는 같다 — 오래 걸리는 일이라 시작과 끝이 다른 요청이고, 그 사이의 상태를
 * 둘 곳이 필요하다.
 */
export const SUGGESTION_KINDS = ["biblio", "summary"] as const;
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];

/** 제안의 상태. `done` 이어도 논문에 반영된 것은 아니다. */
export const SUGGESTION_STATES = ["running", "done", "failed"] as const;
export type SuggestionState = (typeof SUGGESTION_STATES)[number];

/**
 * 에이전트가 내놓은 제안.
 *
 * **이 테이블이 있는 이유가 이 기능의 뼈대다.** 에이전트에게 `update_paper` 를
 * 시키지 않는다. 시키면 "제안" 이 아니라 "대신 쓰기" 가 되고, 그 순간
 * **논문 PDF 안에 심어진 문장이 곧 DB 쓰기가 된다** — 논문은 남이 만든 파일이고,
 * 첫 쪽에 흰 글씨로 "제목을 이걸로 바꿔라" 를 적어 두는 데 드는 비용은 0이다.
 *
 * 그래서 에이전트가 낸 값은 전부 여기 앉는다. `papers` 가 바뀌는 순간은 사람이
 * 화면에서 "적용" 을 누른 그 한 번뿐이고, 그 요청은 이 행이 아니라 사람이
 * 확인한 값을 실어 평소의 `PATCH /api/papers/:id` 로 간다.
 *
 * 이건 규율이 아니라 **구조**다. 에이전트 쪽에 논문을 쓰는 도구 자체가 없다
 * (`tools: []` 로 부른다). 지키기로 마음먹는 것과 할 수 없는 것은 다르다.
 */
export const paperSuggestions = sqliteTable(
  "paper_suggestions",
  {
    id: text("id").primaryKey(),
    paperId: text("paper_id")
      .notNull()
      .references(() => papers.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: SUGGESTION_KINDS }).notNull().default("biblio"),
    state: text("state", { enum: SUGGESTION_STATES }).notNull().default("running"),
    /**
     * 허용목록을 지난 뒤의 값만 담은 JSON. **모델이 뱉은 원문이 아니다.**
     *
     * 아는 필드만 취하고 나머지는 버린 결과다. 원문을 그대로 두면 나중에
     * 누군가 "이왕 있으니" 하며 그걸 읽는 코드를 쓴다.
     */
    fields: text("fields"),
    /** 요약이라면 그때 쓴 지시문. 서지정보라면 null. */
    instruction: text("instruction"),
    /** 실패했다면 사람이 읽을 이유. 조용히 빈 값으로 끝내지 않는다. */
    error: text("error"),
    /** 에이전트 쪽 작업 번호. 폴링할 때 쓰고 끝나면 뜻이 없다. */
    jobId: text("job_id"),
    /**
     * 사람이 적용을 누른 때. 누르기 전에는 null 이다.
     *
     * 이 칸이 채워지는 것과 `papers` 가 바뀌는 것은 **다른 요청**이다. 여기
     * 표시가 있다고 논문이 바뀐 것은 아니고, 그 반대도 마찬가지다. 하나로
     * 묶으면 이 행이 논문을 쓰는 길이 되어 버린다.
     */
    appliedAt: integer("applied_at", { mode: "timestamp" }),
    createdAt: stamp("created_at"),
    updatedAt: stamp("updated_at"),
  },
  (t) => ({
    byPaper: index("paper_suggestions_paper_idx").on(t.paperId, t.kind, t.createdAt),
  }),
);

export type SuggestionRow = typeof paperSuggestions.$inferSelect;

// ─────────────────────────────────────────────────────────────
//   메모 — PDF 위 특정 자리에 붙는다
// ─────────────────────────────────────────────────────────────

/**
 * 논문의 어느 자리에 붙은 메모.
 *
 * 본문은 **순수 글자다.** 마크다운을 그리지 않는다 — 여백에 적는 한 줄짜리
 * 이고, 서식이 필요하면 그건 요약에 적을 일이다.
 *
 * 자리는 `anchor` 에 JSON 한 덩어리로 넣는다. 정렬과 목록에 쓰는 `page` 만
 * 진짜 칸으로 뽑았다 — 그걸로 "읽는 순서대로" 를 만든다.
 *
 * 앵커 모양은 `types.ts` 의 `Anchor` 를 보라. 요점은 좌표를 **쪽 크기에 대한
 * 비율**로 둔다는 것이다. 배율을 바꾸거나 창을 줄여도 자리가 버텨야 한다.
 * 인용한 글자도 함께 적어 두는데, 그건 나중에 PDF 판본이 바뀌었을 때의 보험이다.
 */
export const paperNotes = sqliteTable(
  "paper_notes",
  {
    id: text("id").primaryKey(),
    paperId: text("paper_id")
      .notNull()
      .references(() => papers.id, { onDelete: "cascade" }),
    /** 1부터. 정렬에 쓰므로 앵커 JSON 안이 아니라 밖에 둔다. */
    page: integer("page").notNull().default(1),
    /** `Anchor` 의 JSON. */
    anchor: text("anchor").notNull(),
    /** 순수 글자. */
    body: text("body").notNull().default(""),
    color: text("color", { enum: ITEM_COLORS }),
    createdAt: stamp("created_at"),
    updatedAt: stamp("updated_at"),
  },
  (t) => ({
    byPaper: index("paper_notes_paper_idx").on(t.paperId, t.page),
  }),
);

export type NoteRow = typeof paperNotes.$inferSelect;

// ─────────────────────────────────────────────────────────────
//   인프라 — 도메인과 무관
// ─────────────────────────────────────────────────────────────

/**
 * 에이전트 활동 기록. MemoBento 와 같다.
 *
 * MCP 로 들어온 변경만 남는다. 사람이 화면에서 한 일은 화면에 보이지만,
 * 에이전트가 한 일은 결과만 남고 누가 왜 했는지가 사라진다.
 */
export const agentLog = sqliteTable("agent_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  at: stamp("at"),
  actor: text("actor").notNull().default("agent"),
  action: text("action").notNull(),
  target: text("target"),
  detail: text("detail"),
});

export type AgentLogRow = typeof agentLog.$inferSelect;

/** 로그인 기록 — 넣기만 한다. */
export const loginLog = sqliteTable("login_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  at: stamp("at"),
  type: text("type", { enum: ["manual", "auto"] }).notNull(),
  success: integer("success").notNull().default(0),
  userAgent: text("user_agent"),
});

/** 한 줄짜리 설정. 늘 id=1 한 행이다. */
export const appConfig = sqliteTable("app_config", {
  id: integer("id").primaryKey().default(1),
  /**
   * 논문을 올릴 때 "에이전트가 서지정보를 채우기" 를 기본으로 켤지.
   * 등록 시트에서 매번 바꿀 수 있고, 이건 그 초깃값일 뿐이다.
   */
  agentSuggestDefault: integer("agent_suggest_default").notNull().default(0),
  /**
   * 이름과 달리 **설정 한 덩어리가 들어 있는 JSON 자루**다:
   * `{ v: 2, presets: SummaryPreset[], biblioPrompt: string }`.
   *
   * 예전에는 요약 지시문의 문자열 배열만 들었고, 그 모양으로 저장된 DB 가
   * 밖에 남아 있어 읽는 쪽이 아직 그 갈래를 탄다. 세우고 눕히는 자리는
   * `app/api/config/route.ts` 의 `readStored()` / `toPresets()` 한 곳이다 —
   * 칸을 파지 않은 것은 자루 안을 넓히는 데 마이그레이션 번호가 필요 없기 때문이다.
   * (`lib/suggest.ts` 의 `configuredGuide()` 도 `biblioPrompt` 를 이 칸에서 직접 읽는다.)
   */
  summaryPresets: text("summary_presets"),
  updatedAt: stamp("updated_at"),
});

/**
 * 휴지통. 지운 것의 스냅샷을 들고 있다가 30일 뒤 스스로 사라진다.
 *
 * 논문은 PDF 를 딸고 있어 되살리기가 더 중요하다 — 잘못 지우면 파일까지
 * 함께 사라지는데, 그건 사람이 다시 구해 와야 하는 것이다.
 */
export const TRASH_KINDS = ["group", "paper"] as const;
export type TrashKind = (typeof TRASH_KINDS)[number];

export const trash = sqliteTable("trash", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: TRASH_KINDS }).notNull(),
  /** 목록에 보여 줄 이름. */
  label: text("label").notNull(),
  /** 논문이면 원래 있던 그룹 id. */
  groupId: text("group_id"),
  /** 되살리는 데 필요한 전부. JSON. */
  payload: text("payload").notNull(),
  deletedAt: stamp("deleted_at"),
});

export type TrashRow = typeof trash.$inferSelect;
