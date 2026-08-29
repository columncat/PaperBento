"use client";

import {
  AlertCircle,
  ArrowLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Eye,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Sparkles,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { api } from "@/lib/client-api";
import { startDownload } from "@/lib/download";
import {
  citationLine,
  fileUrl,
  formatBytes,
  type Anchor,
  type GroupDTO,
  type ItemColor,
  type NoteDTO,
  type PaperDTO,
  type PaperMark,
  type ReadState,
  type SummaryDTO,
} from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";

import { ExportMenu } from "./export-menu";
import { NoteEditor, type NoteEditorTarget } from "./note-editor";
import { NoteList } from "./note-list";
import { PaperChat } from "./paper-chat";
import { MarkPicker, ReadStateButton } from "./paper-mark";
import { PaperSheet, type SheetTarget } from "./paper-sheet";
import { PdfFrame } from "./pdf-frame";
import type { PdfViewHandle } from "./pdf-view";
import { RichText } from "./rich-text";
import { SplitPane } from "./split-pane";
import { SummaryRun } from "./summary-run";

/**
 * 논문 상세. 원문과 글을 나란히 놓고, 원문 위에 메모를 단다.
 *
 * 왼쪽이 원문, 오른쪽이 글(서지정보 · 요약 · 메모)이다. 그 사이는 끌 수 있는
 * 칸막이라 사람마다 원하는 비율로 둘 수 있다 — `split-pane.tsx`.
 *
 * 요약은 마크다운이다. 그리는 것은 `rich-text.tsx` 로, 채팅창이 에이전트
 * 답변을 그리는 것과 **같은 렌더러**다. 요약은 사람이 쓸 수도 에이전트가 쓸
 * 수도 있는데 둘이 다르게 보이면 안 된다. HTML 문자열을 만들지 않는 렌더러라
 * 남의 글이 섞여 들어와도 태그가 끼어들 자리가 없다.
 *
 * 메모 목록은 요약 **바로 아래**에 이어 둔다. 탭으로 가르지 않았다 — 요약을
 * 다듬는 동안 방금 단 메모를 다시 보는 일이 잦은데, 탭이면 그때마다 둘 중
 * 하나가 화면에서 사라진다. 둘 다 자주 보는 것이면 그냥 이어 놓는 편이 낫다.
 *
 * ## 서버를 부르는 자리는 여기 하나다
 *
 * 뷰어와 메모를 잇는 배선은 여기서 한다. 메모 목록도 적기 상자도 뷰어도 자기
 * 것만 알고, "목록에서 누른 메모가 원문의 어디로 굴러가는지" 같은 것은 셋 다
 * 알 수 없다. 둘을 함께 쥐고 있는 자리는 이 화면뿐이다.
 *
 * 메모를 고치는 요청도 그래서 여기서만 나간다. 메모 하나를 고치면 목록과 원문
 * 위에 칠한 자리가 **같은 응답으로** 함께 바뀌어야 하는데, 부르는 자리가 둘로
 * 갈리면 한쪽만 갱신된 화면이 생긴다.
 */

/*
 * 칸막이 비율을 기억할 칸.
 *
 * `paperbento.` 접두어는 `preferences.ts` 의 `STORAGE_KEYS` 와 같은 이유다 —
 * 한 도메인에 `/paper` 와 `/memo` 를 나란히 얹으면 오리진이 같아지고,
 * localStorage 는 경로를 구분하지 않아 두 앱이 같은 칸을 쓰게 된다. 앱 이름으로
 * 갈라 두지 않으면 여기서 끈 폭이 옆 앱의 칸막이를 움직인다.
 */
const SPLIT_KEY = "paperbento.paperSplit";

/*
 * 글 쪽(대화·요약·메모)을 접어 두었는가.
 *
 * `preferences.ts` 의 `STORAGE_KEYS` 에 넣지 않았다. 그 표는 앱 전체에 뜻이
 * 있는 값(테마·모드·열 개수)의 자리이고, 이 값은 **이 화면 밖에서는 아무
 * 뜻이 없다.** 바로 위 `SPLIT_KEY` 와 `cite-copy.tsx` 의 스타일 키가 같은
 * 이유로 제 화면 옆에 산다. 지키는 결은 그 표와 똑같다 — `paperbento.`
 * 접두어(한 오리진에 `/paper` 와 `/memo` 가 함께 얹힌다), 마운트 **뒤에**
 * 읽기(서버에는 localStorage 가 없어 그릴 때 읽으면 하이드레이션이 어긋난다),
 * 읽고 쓰는 자리마다 try/catch(사생활 보호 모드에서 던진다).
 */
const COLLAPSE_KEY = "paperbento.paperTextCollapsed";

/**
 * 뷰어는 이 화면에 들어올 때 비로소 받아 온다.
 *
 * pdf.js 는 워커까지 하면 1MB 급이다. 정적으로 물리면 서재 첫 화면까지 그
 * 무게를 지고 뜨는데, 서재에서는 한 번도 쓰지 않는다. `ssr: false` 인 것은
 * 골라잡을 여지가 없어서다 — pdf.js 는 `document` 와 `canvas` 가 있어야 산다.
 *
 * 받아 오는 동안 자리를 비워 두면 글 쪽이 잠깐 화면 전체로 벌어졌다가 되돌아온다.
 * 뼈대를 세워 두는 것은 그 한 번의 출렁임을 없애기 위해서다.
 */
const PdfView = dynamic(() => import("./pdf-view").then((m) => m.PdfView), {
  ssr: false,
  loading: () => <PdfSkeleton />,
});

/**
 * 인용문 상자도 뷰어와 같은 이유로 따로 받아 온다.
 *
 * 상자 자체는 작지만 그 뒤에 citeproc-js 가 있고 그것만 967KB 다 (`cite.ts`).
 * 서지정보를 펴야 비로소 화면에 들어오므로, 안 펴는 사람은 그 무게를 지지
 * 않는다. `ssr: false` 인 것은 고른 스타일을 localStorage 에서 읽기 때문이다 —
 * 서버는 그 값을 알 수 없어 미리 그려 봐야 어긋난 것만 그린다.
 */
const CiteCopy = dynamic(() => import("./cite-copy").then((m) => m.CiteCopy), {
  ssr: false,
  loading: () => (
    <div className="mt-3 h-24 animate-pulse rounded-lg bg-(--color-bg-2) ring-1 ring-(--color-border-soft)" />
  ),
});

export function PaperDetail({
  paper: initialPaper,
  groupName,
  groups,
  summary: initialSummary,
}: {
  paper: PaperDTO;
  groupName: string;
  groups: GroupDTO[];
  summary: SummaryDTO | null;
}) {
  const router = useRouter();
  const [paper, setPaper] = useState(initialPaper);
  const [summary, setSummary] = useState<SummaryDTO | null>(initialSummary);
  const [editing, setEditing] = useState(false);
  /** 서지정보를 폈는가. 기본은 접힘 — 자주 보는 것은 요약이다. */
  const [bibOpen, setBibOpen] = useState(false);
  const [draft, setDraft] = useState(initialSummary?.body ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetTarget | null>(null);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /*
   * 메모.
   *
   * 서재 목록에는 실려 오지 않는다 — 한 화면에 수백 편이 오는데 거기에 메모
   * 본문까지 실으면 첫 화면이 무거워진다. 상세에 들어와서 따로 받는다.
   *
   * 고치는 함수들이 **갱신된 목록 전체**를 돌려주므로 여기서 손으로 끼워 넣거나
   * 빼지 않는다. 서버가 정한 순서(쪽 순 → 쪽 안에서 위에서 아래)가 그대로 이긴다.
   */
  const [notes, setNotes] = useState<NoteDTO[]>([]);
  /** 지금 짚고 있는 메모. 목록에서도 원문 위에서도 함께 도드라진다. */
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  /** 서버를 부르는 중인 메모. 그 줄만 잠근다. */
  const [busyNoteId, setBusyNoteId] = useState<string | null>(null);
  /** 적기 상자. null 이면 안 뜬다. */
  const [editorTarget, setEditorTarget] = useState<NoteEditorTarget | null>(null);
  const [savingNote, setSavingNote] = useState(false);
  /** 뷰어가 못 떴다. 브라우저 기본 보기로 물러난다. */
  const [viewerFailed, setViewerFailed] = useState(false);

  /*
   * 글 쪽을 접었는가. 접으면 원문이 화면을 다 쓴다.
   *
   * 첫 그림은 늘 "펴짐" 이고 기억해 둔 값은 붙은 뒤에 읽는다 — 서버가 그린
   * 것과 달라지면 하이드레이션이 어긋난다(`split-pane.tsx` 가 비율을 그렇게
   * 읽는다).
   */
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(COLLAPSE_KEY) === "1") setCollapsed(true);
    } catch {
      /* 사생활 보호 모드 등 — 펴진 채로 산다 */
    }
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* 못 적어도 이번 화면에서는 잘 돌아간다 */
      }
      return next;
    });
  }, []);

  const pdfRef = useRef<PdfViewHandle>(null);
  /** 원문 칸의 상자. 적기 상자를 띄울 자리를 못 구했을 때 여기 한복판에 띄운다. */
  const paneRef = useRef<HTMLDivElement>(null);

  // 서버가 다시 그려 주면(편집 후 refresh) 그 값이 이긴다.
  useEffect(() => setPaper(initialPaper), [initialPaper]);

  const fail = useCallback((e: unknown) => {
    setError(e instanceof Error ? e.message : "요청에 실패했습니다");
    if (errorTimer.current) clearTimeout(errorTimer.current);
    errorTimer.current = setTimeout(() => setError(null), 6000);
  }, []);

  const paperId = paper.id;
  useEffect(() => {
    /*
     * 다 받기 전에 다른 논문으로 넘어갈 수 있다. 늦게 온 답이 새 화면의 목록을
     * 덮어쓰면 남의 논문 메모가 원문 위에 칠해진다.
     */
    let alive = true;
    api
      .listNotes(paperId)
      .then((rows) => {
        if (alive) setNotes(rows);
      })
      .catch(fail);
    return () => {
      alive = false;
    };
  }, [paperId, fail]);

  /**
   * 읽기 상태·표식은 즉시 반영하고 서버는 뒤따라간다.
   *
   * 여기서 `api.updatePaper` 가 돌려주는 것은 서재 전체다. 상세 화면은 그걸
   * 쓸 데가 없으므로 버린다 — 봉투를 화면마다 다르게 만들지 않기로 한 값이다.
   */
  const patch = (next: Partial<PaperDTO>) => {
    setPaper((p) => ({ ...p, ...next }));
    void api.updatePaper(paper.id, next as { readState?: ReadState; mark?: PaperMark | null }).catch(fail);
  };

  const saveSummary = async () => {
    setSaving(true);
    try {
      // 응답에 서가도 함께 온다 (`hasSummary` 가 달라지므로). 상세 화면은
      // 그걸 쓸 데가 없어 버리지만, 봉투를 화면마다 다르게 만들지 않기로 한
      // 값이라 그대로 둔다.
      const { summary: saved } = await api.saveSummary(paper.id, draft);
      setSummary(saved);
      setEditing(false);
      // 이 화면 안의 표시도 따라오게. 서재로 돌아가면 서버 값이 다시 이긴다.
      setPaper((p) => ({ ...p, hasSummary: draft.trim().length > 0 }));
    } catch (e) {
      fail(e);
    } finally {
      setSaving(false);
    }
  };

  // ── 뷰어와 메모를 잇는 배선 ──────────────────────────────

  /**
   * 적기 상자를 띄울 화면 좌표.
   *
   * 뷰어에게 "그 자리가 지금 화면 어디냐" 를 묻는다. 아직 안 그려진 쪽이거나
   * 기본 보기로 물러난 상태면 답이 없는데, 그때 상자를 안 띄우면 고칠 길이
   * 아예 없어진다. 원문 칸 한복판이라도 띄우는 편이 낫다.
   */
  const pointFor = useCallback((anchor: Anchor) => {
    const found = pdfRef.current?.anchorPoint(anchor);
    if (found) return found;
    const box = paneRef.current?.getBoundingClientRect();
    if (box) return { x: box.left + box.width / 2, y: box.top + box.height / 3 };
    return { x: window.innerWidth / 2, y: window.innerHeight / 3 };
  }, []);

  /** 목록에서 메모를 누르면 원문이 그 자리로 굴러간다. */
  const focusNote = useCallback((note: NoteDTO) => {
    setActiveNoteId(note.id);
    // 뷰어가 못 떠서 기본 보기로 물러났으면 굴릴 자리가 없다. 짚은 표시만
    // 남기고 조용히 지나간다 — 할 수 없는 일에 오류를 띄울 것은 아니다.
    pdfRef.current?.scrollToAnchor(note.anchor);
  }, []);

  /** 원문에서 글자를 골랐다. 그 옆에 빈 상자를 띄운다. */
  const beginNote = useCallback((anchor: Anchor, at: { x: number; y: number }) => {
    setActiveNoteId(null);
    setEditorTarget({ anchor, at });
  }, []);

  /** 목록에서 "고치기". 그 자리로 굴리고 상자를 띄운다. */
  const editNote = useCallback(
    (note: NoteDTO) => {
      setActiveNoteId(note.id);
      pdfRef.current?.scrollToAnchor(note.anchor);
      /*
       * 자리는 굴리기 **전** 좌표다. 다 굴러갈 때까지 기다렸다 재는 길도 있지만,
       * 상자는 화면의 물건이라 몇십 픽셀 어긋나도 읽고 적는 데 지장이 없다.
       * 그걸 맞추자고 기다리면 상자가 한 박자 늦게 뜬다.
       */
      setEditorTarget({ note, anchor: note.anchor, at: pointFor(note.anchor) });
    },
    [pointFor],
  );

  const saveNote = async (body: string, color: ItemColor | null) => {
    const target = editorTarget;
    if (!target) return;
    setSavingNote(true);
    try {
      if (target.note) {
        setNotes(await api.updateNote(paper.id, target.note.id, { body, color }));
        setActiveNoteId(target.note.id);
      } else {
        const { notes: rows, noteId } = await api.createNote(paper.id, target.anchor, body, color);
        setNotes(rows);
        // 방금 적은 것을 짚어 둔다. 목록 어디에 꽂혔는지 눈으로 찾게 하지 않는다.
        setActiveNoteId(noteId);
      }
      setEditorTarget(null);
    } catch (e) {
      fail(e);
    } finally {
      setSavingNote(false);
    }
  };

  const removeNote = async (note: NoteDTO) => {
    setBusyNoteId(note.id);
    try {
      const { notes: rows } = await api.deleteNote(paper.id, note.id);
      setNotes(rows);
      setActiveNoteId((id) => (id === note.id ? null : id));
      // 지운 메모를 고치던 중이었다면 상자도 함께 닫는다. 남아 있으면 저장이
      // 이미 없는 메모를 향해 날아간다.
      setEditorTarget((t) => (t?.note?.id === note.id ? null : t));
    } catch (e) {
      fail(e);
    } finally {
      setBusyNoteId(null);
    }
  };

  const cite = citationLine(paper);
  const tags = (paper.tags ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  return (
    <main className="relative mx-auto flex min-h-screen w-full max-w-[1600px] flex-col gap-5 px-6 py-8 lg:px-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/"
          className="flex items-center gap-2 text-sm text-(--color-fg-3) hover:text-(--color-fg)"
        >
          <ArrowLeft className="h-4 w-4" />
          서재로
        </Link>

        <div className="flex shrink-0 items-center gap-1.5">
          <ReadStateButton
            state={paper.readState}
            onChange={(readState) => patch({ readState })}
            className="h-8 w-8"
          />
          <MarkPicker current={paper.mark} onPick={(mark) => patch({ mark })} />

          {paper.url && (
            <a
              href={paper.url}
              target="_blank"
              rel="noreferrer noopener"
              title={paper.url}
              className="flex items-center gap-1.5 rounded-full bg-(--color-surface) px-3 py-1.5 text-xs text-(--color-fg-2) ring-1 ring-(--color-border-soft) transition hover:bg-(--color-surface-2)"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              원문
            </a>
          )}

          {paper.file && (
            <button
              type="button"
              onClick={() => startDownload(paper.file!)}
              className="flex items-center gap-1.5 rounded-full bg-(--color-surface) px-3 py-1.5 text-xs text-(--color-fg-2) ring-1 ring-(--color-border-soft) transition hover:bg-(--color-surface-2)"
            >
              <Download className="h-3.5 w-3.5" />
              내려받기
            </button>
          )}

          {/*
            서지정보 내보내기.

            바로 옆 "내려받기" 는 PDF 원본이다. 둘 다 파일이 떨어지는 단추라
            같은 이름을 붙이면 .bib 을 기다리는 사람이 PDF 를 받는다. 이름을
            "서지정보" 로 가르고 아이콘도 인용부호로 달리 준다.

            `hasCsl` 로 막지 않는다 — 원본이 없어도 라우트가 우리 칸으로
            최소한을 만들어 준다. 인용 목록에서 한 편이 소리 없이 빠지는 것이
            가장 나쁘다. 그래서 여기서는 "원본이 있느냐" 를 알려만 준다.
          */}
          <ExportMenu
            target={{ paperId: paper.id }}
            label="서지정보"
            hint={
              paper.hasCsl
                ? "받아 온 원본 서지정보가 있어 저자·권·쪽까지 온전히 나갑니다."
                : "원본 서지정보가 없어 적어 둔 칸으로 만듭니다. 서지정보 찾기를 한 번 돌리면 더 온전해집니다."
            }
          />

          {/*
            글 쪽 접기.

            머리말에 둔다 — **접힌 상태에서도 보여야 하기 때문이다.** 요약
            카드 머리말에 얹으면 접는 순간 그 단추가 함께 사라져 다시 펼 길이
            없어진다. 오른쪽 끝에 두어 자리와 뜻을 맞췄다: 이 단추 아래에
            있는 칸이 접히는 칸이다.

            켜짐/꺼짐을 색으로만 가르지 않는다. 글자("접기"/"펴기")와 아이콘
            방향이 함께 바뀌고, 낭독기에는 `aria-pressed` 로 간다.
          */}
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-pressed={collapsed}
            title={
              collapsed
                ? "요약·메모 칸을 다시 펼칩니다"
                : "요약·메모 칸을 접고 원문만 크게 봅니다"
            }
            className={cn(
              "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs ring-1 transition",
              collapsed
                ? "bg-(--color-accent-soft) text-(--color-accent-strong) ring-(--color-accent)/40 hover:bg-(--color-accent)/25"
                : "bg-(--color-surface) text-(--color-fg-2) ring-(--color-border-soft) hover:bg-(--color-surface-2)",
            )}
          >
            {collapsed ? (
              <PanelRightOpen className="h-3.5 w-3.5" />
            ) : (
              <PanelRightClose className="h-3.5 w-3.5" />
            )}
            {collapsed ? "글 펴기" : "글 접기"}
          </button>
        </div>
      </header>

      {/*
        **왼쪽이 원문, 오른쪽이 글.** 논문을 읽으며 요약과 메모를 적는 자리라
        둘이 한 화면에 있어야 한다. 폭은 고정하지 않고 끌게 둔다 — 그림이 많은
        논문은 원문을 넓게, 요약을 길게 적는 사람은 글 쪽을 넓게 본다.

        좁아지면(xl 미만) 칸막이가 사라지고 위아래로 쌓이는데, 그때는 **글이
        먼저**다 — 원문은 세로로 길어서 위에 놓으면 요약을 보려고 한참 굴려야 한다.

        접으면 글 쪽이 통째로 감춰지고 원문이 남은 자리를 다 쓴다. **좁은
        화면에서도 같은 뜻이다** — 거기서는 폭이 아니라 위에 얹힌 글 더미가
        사라지고, 원문 칸의 높이는 `h-[calc(100vh-8rem)]` 라 그대로 화면을
        채운다. 넓은 화면에서만 되는 기능으로 두지 않은 것은, 화면이 좁을수록
        "원문만 보고 싶다" 가 더 자주 생기기 때문이다.

        바깥 `max-w-[1600px]` 은 접어도 그대로다. 상한을 풀면 첫 배율
        (`page-width`)이 화면 폭을 따라가서 넓은 모니터에서는 한 쪽이 읽기
        어려울 만큼 커지고, 그리는 캔버스도 pdf.js 의 넓이 상한에 다가간다.
        58% → 100% 만으로 이미 원문이 두 배 가까이 넓어진다.
      */}
      <SplitPane
        className="flex-1"
        collapsed={collapsed}
        storageKey={SPLIT_KEY}
        defaultRatio={0.58}
        minRatio={0.3}
        maxRatio={0.78}
        stackFirst="right"
        label="원문과 글 사이 폭 조절"
        /*
          원문은 글을 굴려도 제자리에 있어야 하므로 sticky 다. `self-start` 가
          함께 있어야 한다 — flex 칸은 기본이 늘어나기(stretch)라 이미 줄 높이만큼
          커져 있고, 그러면 붙을 여지가 없어 sticky 가 아무것도 안 한다.

          높이는 화면에 맞춘다. 논문은 한 쪽이 세로로 길어서, 창 높이를 다 쓰지
          않으면 한 번에 몇 줄밖에 안 보인다.
        */
        leftClassName="h-[calc(100vh-8rem)] xl:sticky xl:top-6 xl:self-start"
        rightClassName="gap-4"
        left={
          <div ref={paneRef} className="flex h-full min-h-0 flex-col gap-2">
            {viewerFailed && (
              /*
                물러났다는 사실을 숨기지 않는다. 기본 보기로도 읽기는 되지만
                메모를 달 수 없는데, 그걸 안 알려 주면 "글자를 골라도 아무 일이
                안 일어난다" 가 고장으로 보인다.
              */
              <p className="flex shrink-0 items-start gap-1.5 rounded-lg bg-(--color-surface) px-3 py-2 text-[11px] leading-relaxed break-keep text-(--color-fg-3) ring-1 ring-(--color-border-soft)">
                <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-(--color-danger)" />
                <span>
                  원문 뷰어를 띄우지 못해 브라우저 기본 보기로 넘어갔습니다. 읽는 데는
                  지장이 없지만 이 상태에서는 쪽 위에 메모를 달 수 없습니다.
                </span>
              </p>
            )}

            {paper.file && !viewerFailed ? (
              <ViewerBoundary onFail={() => setViewerFailed(true)}>
                <PdfView
                  ref={pdfRef}
                  fileId={paper.file.id}
                  title={paper.title}
                  notes={notes}
                  activeNoteId={activeNoteId}
                  onSelect={beginNote}
                  onPickNote={setActiveNoteId}
                  onFail={() => setViewerFailed(true)}
                  className="min-h-0 flex-1"
                />
              </ViewerBoundary>
            ) : (
              <PdfFrame
                fileId={paper.file?.id ?? null}
                title={paper.title}
                className="min-h-0 flex-1"
              />
            )}
          </div>
        }
        right={
          <>
          {/*
            대화. **요약 위에 둔다.**

            묻는 것이 먼저이고 요약은 그 결과를 적어 두는 자리다. 아래에 두면
            요약이 긴 논문에서 화면 밖으로 밀려 나가 있는 줄도 모르게 된다 —
            인용문 상자를 초록 앞에 둔 것과 같은 이유다.

            요약 카드 머리말에 얹지 않았다. 저 줄에는 이미 단추가 다섯이라
            여섯째를 얹으면 무엇이 무엇인지 알 수 없다. 대화는 자기 카드를
            가질 만큼 큰 일이다.
          */}
          <PaperChat paperId={paper.id} paperTitle={paper.title} />

          {/* 요약 */}
          <section className="flex min-h-[260px] flex-col rounded-[var(--radius-card)] bg-(--color-surface) p-6 ring-1 ring-(--color-border-soft)">
            <header className="mb-3 flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <h2 className="shrink-0 text-base font-medium text-(--color-fg)">요약</h2>
                {summary?.source === "agent" && (
                  <span
                    className="inline-flex shrink-0 items-center gap-1 rounded-full bg-(--color-accent-soft) px-1.5 py-0.5 text-[10px] text-(--color-accent-strong)"
                    title={summary.instruction ?? "에이전트가 만든 요약"}
                  >
                    <Sparkles className="h-2.5 w-2.5" />
                    에이전트
                  </span>
                )}
                {/*
                  서지정보를 펴는 손잡이. 제 카드를 따로 쓰지 않고 여기 붙는다.
                  카드로 두면 늘 한 줄을 차지하는데, 정작 자주 보는 것은 요약이다.
                */}
                <button
                  type="button"
                  onClick={() => setBibOpen((v) => !v)}
                  aria-expanded={bibOpen}
                  className="flex min-w-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] text-(--color-fg-4) transition hover:bg-(--color-bg-2) hover:text-(--color-fg-2)"
                >
                  <ChevronRight
                    className={cn("h-3 w-3 shrink-0 transition-transform", bibOpen && "rotate-90")}
                  />
                  <span className="truncate">{bibOpen ? "서지 정보 접기" : "서지 정보 펼치기"}</span>
                </button>
                {/* 펼쳤을 때만. 접혀 있으면 무엇을 고치는지가 화면에 없다. */}
                {bibOpen && (
                  <button
                    type="button"
                    onClick={() => setSheet({ mode: "edit", groupId: paper.groupId, paper })}
                    className="flex shrink-0 items-center gap-1 rounded-full bg-(--color-accent-soft) px-2 py-0.5 text-[11px] text-(--color-accent-strong) ring-1 ring-(--color-accent)/40 transition hover:bg-(--color-accent)/25"
                  >
                    <Pencil className="h-3 w-3" />
                    고치기
                  </button>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                {/*
                  에이전트에게 요약을 맡기는 자리.

                  "고치기" 옆에 둔다 — 둘 다 요약 본문을 바꾸는 일이고, 사람이
                  고를 것은 "내가 쓴다" 와 "맡긴다" 둘 중 하나다. 완성되면
                  `onDone` 이 그 자리에 끼워 넣는다. 목록의 표식(`hasSummary`)도
                  함께 고쳐야 서재로 돌아갔을 때 "저장이 안 됐나" 가 안 생긴다.
                */}
                <SummaryRun
                  paperId={paper.id}
                  summary={summary}
                  onDone={(s) => {
                    setSummary(s);
                    setPaper((p) => ({ ...p, hasSummary: !!s?.body.trim() }));
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    setDraft(summary?.body ?? "");
                    setEditing((v) => !v);
                  }}
                  className="flex items-center gap-1.5 rounded-full bg-(--color-bg-2) px-3 py-1.5 text-[11px] text-(--color-fg-2) ring-1 ring-(--color-border-soft) transition hover:bg-(--color-surface-hi)"
                >
                  {editing ? <Eye className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
                  {editing ? "보기" : "고치기"}
                </button>
              </div>
            </header>

            {/*
              펼친 서지정보.
              제목도 여기 있다 — 논문을 가리키는 것들은 한자리에 모아 둔다.
              고치는 단추도 여기 둔다. 위쪽 머리말에 따로 두면 "서지정보" 라는
              한 가지가 화면 두 곳에 흩어진다.
            */}
            {bibOpen && (
              <div className="mb-4 border-b border-(--color-border-soft) pb-4">
                <p className="mb-1 text-[11px] text-(--color-fg-4)">{groupName}</p>
                {/*
                  제목이 한 줄을 통째로 쓴다.
                  예전에는 "고치기" 단추와 한 줄을 나눠 썼는데, 이 칸이 440px
                  남짓이라 제목이 조금만 길어도 둘이 겹쳐 보였다. 단추는 위
                  머리말로 올렸다 — 거기서는 다툴 것이 없다.

                  `[overflow-wrap:anywhere]` 를 함께 준다. `break-keep` 은 한국어를
                  아무 데서나 자르지 말라는 뜻이라, 띄어쓰기 없는 긴 영문 제목
                  (DOI 나 화학식이 든 것)은 그대로 칸을 넘어간다.
                */}
                <h1
                  className="text-lg leading-snug break-keep text-(--color-fg) [overflow-wrap:anywhere]"
                  style={{ fontFamily: "var(--font-serif)" }}
                >
                  {paper.title}
                </h1>
                {cite && <p className="mt-1 text-xs text-(--color-fg-3)">{cite}</p>}

                <dl className="mt-3 flex flex-col gap-2 text-xs">
                  {paper.doi && (
                    <Meta label="DOI" value={paper.doi} href={`https://doi.org/${paper.doi}`} />
                  )}
                  {paper.arxivId && (
                    <Meta
                      label="arXiv"
                      value={paper.arxivId}
                      href={`https://arxiv.org/abs/${paper.arxivId}`}
                    />
                  )}
                  {paper.file && (
                    <Meta
                      label="파일"
                      value={`${paper.file.name} · ${formatBytes(paper.file.size)}`}
                      href={fileUrl(paper.file.id)}
                    />
                  )}
                </dl>

                {/*
                  인용문. DOI·arXiv 바로 아래에 둔다 — 셋 다 "이 논문을 남에게
                  가리키는 법" 이라 한자리에 모인다. 초록 뒤에 두면 초록이 긴
                  논문에서 화면 밖으로 밀려 나가 있는 줄도 모르게 된다.
                */}
                <CiteCopy paperId={paper.id} hasCsl={paper.hasCsl} />

                {tags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {tags.map((t) => (
                      <span
                        key={t}
                        className="rounded-full bg-(--color-bg-2) px-2 py-0.5 text-[11px] text-(--color-fg-3) ring-1 ring-(--color-border-soft)"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}

                {paper.abstract && (
                  <div className="mt-3">
                    <p className="text-[11px] tracking-wider text-(--color-fg-4) uppercase">초록</p>
                    <p className="mt-1.5 text-[12.5px] leading-relaxed break-keep whitespace-pre-wrap text-(--color-fg-2)">
                      {paper.abstract}
                    </p>
                  </div>
                )}
              </div>
            )}

            {editing ? (
              <>
                <textarea
                  value={draft}
                  autoFocus
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") void saveSummary();
                  }}
                  placeholder="마크다운으로 적습니다. 제목(#), 목록(-), 굵게(**), 코드(`) 를 알아봅니다."
                  className="scrollbar-thin min-h-[220px] flex-1 resize-y rounded-lg bg-(--color-bg-2) p-3 font-mono text-[12.5px] leading-relaxed text-(--color-fg) ring-1 ring-(--color-border-soft) outline-none placeholder:text-(--color-fg-4) focus:ring-(--color-accent)/60"
                />
                <div className="mt-3 flex items-center justify-end gap-2">
                  <span className="mr-auto text-[10.5px] text-(--color-fg-4)">
                    Ctrl+Enter 로 저장
                    {summary?.source === "agent" && " · 고치면 사람이 쓴 글이 됩니다"}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(summary?.body ?? "");
                      setEditing(false);
                    }}
                    className="rounded-full bg-(--color-bg-2) px-4 py-1.5 text-xs text-(--color-fg-3) ring-1 ring-(--color-border-soft) hover:bg-(--color-surface-hi)"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveSummary()}
                    disabled={saving}
                    className="flex items-center gap-1.5 rounded-full bg-(--color-accent) px-4 py-1.5 text-xs font-medium text-(--color-bg) hover:bg-(--color-accent-strong) disabled:opacity-50"
                  >
                    {saving && <Loader2 className="h-3 w-3 animate-spin" />}
                    저장
                  </button>
                </div>
              </>
            ) : summary?.body?.trim() ? (
              <>
                <RichText
                  text={summary.body}
                  className="text-[13px] leading-relaxed text-(--color-fg-2)"
                />
                <p className="mt-4 border-t border-(--color-border-soft) pt-2 text-[10.5px] text-(--color-fg-4)">
                  {formatDateTime(summary.updatedAt)} 고침
                </p>
              </>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setDraft("");
                  setEditing(true);
                }}
                className="flex flex-1 flex-col items-center justify-center gap-2 text-(--color-fg-4) transition hover:text-(--color-fg-2)"
              >
                <Pencil className="h-5 w-5" />
                <span className="text-xs">아직 요약이 없습니다 — 눌러서 적기</span>
              </button>
            )}
          </section>

          {/*
            메모. 요약 바로 아래에 이어 둔다 — 탭으로 가르지 않은 이유는 파일
            맨 위에 적었다.
          */}
          <section className="flex flex-col rounded-[var(--radius-card)] bg-(--color-surface) pb-2 ring-1 ring-(--color-border-soft)">
            <header className="flex items-center justify-between gap-2 px-6 py-4">
              <h2 className="text-base font-medium text-(--color-fg)">메모</h2>
              {notes.length > 0 && (
                <span className="text-[11px] text-(--color-fg-4)">{notes.length}개</span>
              )}
            </header>
            <NoteList
              notes={notes}
              activeId={activeNoteId}
              busyId={busyNoteId}
              onSelect={focusNote}
              onEdit={editNote}
              onDelete={(note) => void removeNote(note)}
            />
          </section>
          </>
        }
      />

      {/*
        적기 상자는 칸 안이 아니라 화면 위에 뜬다(`position: fixed`). 고른 글자를
        따라다녀야 하는데, 굴러가는 칸 안에 넣으면 함께 사라진다.
      */}
      <NoteEditor
        target={editorTarget}
        saving={savingNote}
        onSave={(body, color) => void saveNote(body, color)}
        onCancel={() => setEditorTarget(null)}
      />

      <PaperSheet
        target={sheet}
        groups={groups}
        onClose={() => setSheet(null)}
        onSubmit={async (groupId, fields) => {
          await api.updatePaper(paper.id, { ...fields, groupId });
          // 서버가 다시 그려 준 값으로 화면을 맞춘다. 여기서 손으로 합치면
          // 서버가 다듬은 것(빈 제목 → "제목 없음")과 어긋난다.
          router.refresh();
        }}
      />

      {error && (
        <div className="fixed bottom-6 left-1/2 z-[60] flex max-w-[92vw] -translate-x-1/2 items-start gap-2 rounded-xl bg-(--color-surface) px-4 py-3 text-sm text-(--color-danger) shadow-xl ring-1 ring-(--color-danger)/40">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="grid h-5 w-5 shrink-0 place-items-center rounded text-(--color-fg-4) hover:text-(--color-fg-2)"
            aria-label="닫기"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </main>
  );
}

/**
 * 뷰어가 터졌을 때 화면 전체를 데려가지 않게 막는 울타리.
 *
 * pdf.js 는 워커와 청크를 따로 받아 온다. 그게 막히거나(사내 프록시, 오프라인,
 * 배포 중 갈린 청크) 워커가 안 서면 뷰어는 그리는 도중 예외를 던지고, 울타리가
 * 없으면 이 화면이 통째로 하얘진다 — 요약도 서지정보도 함께 사라진다. **원문을
 * 못 보는 것과 화면을 통째로 잃는 것은 다른 일이다.**
 *
 * 잡으면 부모가 `pdf-frame.tsx` 로 물러난다. 브라우저 내장 뷰어는 워커도 청크도
 * 필요 없어서, 우리 뷰어가 못 서는 자리에서도 읽기는 된다.
 *
 * React 의 오류 경계는 아직 클래스로만 만들 수 있다.
 */
class ViewerBoundary extends Component<
  { onFail: () => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(err: unknown) {
    // 무엇이 터졌는지는 콘솔에 남긴다. 화면에는 사람 말로 한 줄만 뜬다.
    console.error("[pdf-view] 원문 뷰어를 띄우지 못했습니다", err);
    this.props.onFail();
  }

  render() {
    // 부모가 곧 우리를 걷어내고 기본 보기를 세운다. 그 한 프레임을 비워 둔다.
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * 뷰어를 받아 오는 동안 세워 두는 뼈대.
 *
 * 크기를 밖에서 못 받는다 — `next/dynamic` 의 `loading` 은 props 를 못 받기
 * 때문이다. 그래서 부르는 쪽의 칸에 맞는 값을 여기 박아 둔다. 뷰어에 준
 * `min-h-0 flex-1` 과 같아야 자리를 정확히 지킨다.
 */
function PdfSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center rounded-[var(--radius-app)] bg-(--color-bg-2) ring-1 ring-(--color-border-soft)">
      <div className="flex flex-col items-center gap-2 text-(--color-fg-4)">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-xs">원문을 여는 중…</span>
      </div>
    </div>
  );
}

function Meta({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href?: string;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="w-12 shrink-0 text-[10.5px] tracking-wider text-(--color-fg-4) uppercase">
        {label}
      </dt>
      <dd className="min-w-0 flex-1 truncate text-(--color-fg-2)" title={value}>
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="underline decoration-dotted underline-offset-2 hover:text-(--color-fg)"
          >
            {value}
          </a>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}
