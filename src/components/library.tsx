"use client";

import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy } from "@dnd-kit/sortable";
import { AlertCircle, ArrowUpFromLine, Library as LibraryIcon, Settings as SettingsIcon, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "@/lib/client-api";
import { COLUMN_CLASS, DEFAULT_COLUMNS, STORAGE_KEYS, confirmMemoDelete, type ColumnsPref } from "@/lib/preferences";
import { countPapers, type GroupDTO, type PaperDTO } from "@/lib/types";
import { cn } from "@/lib/utils";

import { AgentChat } from "./agent-chat";
import {
  BiblioBatchPanel,
  fillOne,
  type BatchRowStatus,
  type BatchState,
  type BiblioPrefill,
} from "./biblio-batch";
import { MailBentoLink, MemoBentoLink } from "./cross-app-link";
import { AddGroupCard, type GroupHandlers } from "./group-card";
import type { PaperRowActions } from "./paper-row";
import { PaperSheet, type SheetTarget } from "./paper-sheet";
import { SearchBar, SearchResults, useLibrarySearch } from "./search-panel";
import { SortableGroupCard } from "./sortable-group-card";
import { UploadPanel, useUploadSummary } from "./upload-panel";
import { enqueueUploads, setUploadSink, type UploadedPaper } from "./upload-queue";

/**
 * 서재 전체. **상태는 전부 여기 있다.**
 *
 * 아래의 카드와 줄은 표현만 한다 — 서버 페이지 → 상태를 쥔 Library → 표현
 * 전용 카드, MailBento 의 3단 분리를 그대로 따른다. 카드가 제 상태를 들면
 * 같은 논문이 두 곳에 그려질 때(서가 목록과 등록 시트) 둘이 갈라진다.
 */
export function Library({
  initial,
  mailbentoUrl,
  memobentoUrl,
}: {
  initial: GroupDTO[];
  /** 환경변수 override. null 이면 지금 접속한 호스트에서 유추한다. */
  mailbentoUrl: string | null;
  memobentoUrl: string | null;
}) {
  const [groups, setGroups] = useState<GroupDTO[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [columns, setColumns] = useState<ColumnsPref>(DEFAULT_COLUMNS);
  const [queueOpen, setQueueOpen] = useState(false);
  const [sheet, setSheet] = useState<SheetTarget | null>(null);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─ 오류 토스트 ─
  const fail = useCallback((e: unknown) => {
    setError(e instanceof Error ? e.message : "요청에 실패했습니다");
    if (errorTimer.current) clearTimeout(errorTimer.current);
    errorTimer.current = setTimeout(() => setError(null), 6000);
  }, []);

  /** 모든 변경 API 는 갱신된 서재를 돌려준다 — 그대로 상태에 넣는다. */
  const run = useCallback(
    async (fn: () => Promise<GroupDTO[]>) => {
      try {
        setGroups(await fn());
      } catch (e) {
        fail(e);
        throw e;
      }
    },
    [fail],
  );

  /*
   * 에이전트가 바꾼 것을 화면에 들여온다.
   *
   * 에이전트는 이 화면을 거치지 않고 서버를 고친다 — Discord 로 시키든 채팅창으로
   * 시키든 마찬가지다. 그동안 화면의 서재는 페이지를 연 시점의 것 그대로였다.
   * 방금 만들어 준 요약이 목록에 "요약 없음" 으로 남고, 더 나쁘게는 고쳐진
   * 서지정보가 옛 내용으로 남는다 — 그건 틀린 줄도 모른다.
   *
   * 에이전트에게 "바꿨다고 말해라" 고 시키지 않는다. 말하는 것을 잊거나 틀리게
   * 말할 수 있고, 애초에 그건 모델이 지킬 약속이 아니다. 대신 **바뀐 사실 자체**를
   * 본다 — MCP 로 들어온 변경은 이미 전부 활동 기록에 한 줄씩 남으므로, 그
   * 마지막 번호가 달라졌는지만 물어보면 된다.
   *
   * 탭이 보일 때만 돈다. 안 보이는 창이 4초마다 서버를 두드릴 이유가 없고,
   * 다시 보이는 순간 한 번 물어보므로 놓치지도 않는다.
   */
  const agentRev = useRef<number | null>(null);
  useEffect(() => {
    let alive = true;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const rev = await api.agentRev();
        if (!alive) return;
        const seen = agentRev.current;
        agentRev.current = rev;
        // 처음 본 값은 기준점일 뿐이다. 커졌는지가 아니라 달라졌는지를 본다 —
        // 활동 기록을 비우면 번호가 0 으로 떨어진다.
        if (seen !== null && seen !== rev) setGroups(await api.list());
      } catch {
        /* 새로고침 실패가 화면을 망가뜨릴 이유는 없다. 다음 차례에 다시 본다. */
      }
    };
    void check();
    const timer = setInterval(() => void check(), 4000);
    document.addEventListener("visibilitychange", check);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  // ─ 표시 prefs ─
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.columns) as ColumnsPref | null;
      if (saved) setColumns(saved);
    } catch {
      /* */
    }
  }, []);

  /*
   * 올린 PDF → 등록 시트.
   *
   * 논문 행은 **서버가 이미 만들었다** (`/api/upload/finish`). 그래서 여는
   * 시트는 만드는 시트가 아니라 고치는 시트다 — 다시 만들면 같은 PDF 를
   * 가리키는 논문이 둘이 된다. 사람에게는 "등록" 으로 보이도록 `fresh` 만
   * 얹어 문구를 바꾼다.
   *
   * 여러 개를 한꺼번에 올리면 시트가 겹쳐 뜨면 안 된다. 다 올라간 것을 줄
   * 세워 두고 한 번에 하나씩 묻는다.
   */
  const [waiting, setWaiting] = useState<UploadedPaper[]>([]);
  const uploads = useUploadSummary();

  useEffect(() => {
    setUploadSink((uploaded) => {
      // 확정 응답에 갱신된 서재가 함께 온다 — 다시 조회하지 않는다.
      if (uploaded.groups.length > 0) setGroups(uploaded.groups);
      setWaiting((prev) => [...prev, uploaded]);
    });
    return () => setUploadSink(null);
  }, []);

  useEffect(() => {
    if (uploads.active > 0) setQueueOpen(true);
  }, [uploads.active]);

  /*
   * ── 여러 편을 올렸을 때: **한 번만 묻고 모두 채운다** ───────────────
   *
   * 열 편을 올린 사람에게 시트를 열 번 열어 편마다 1분씩 기다리게 할 수는 없다.
   * 에이전트는 어차피 한 줄로 서서 하나씩 도니까, 화면 앞에 붙들려 있으나
   * 아니나 걸리는 시간은 같다. 그래서 **기다리는 일은 배치가 한 번에 하고,
   * 확인하는 일만 편마다 한다.** 다 돈 뒤에 시트가 하나씩 열리는데, 그때는 값이
   * 이미 칸에 앉아 있어서 사람이 할 일은 훑어보고 Ctrl+Enter 를 누르는 것뿐이다.
   *
   * **끝까지 자동으로 저장하지는 않는다.** 논문 본문은 남이 만든 파일이다.
   * 배치가 저장까지 하면 PDF 에 심어 둔 문장이 사람 없이 서재를 고친다. 배치는
   * 제안이 `paper_suggestions` 에 앉는 데서 끝나고, `papers` 를 쓰는 요청은
   * 사람이 시트에서 저장을 누를 때 딱 한 번 나간다.
   *
   * 한 편만 올렸을 때는 **묻지 않는다.** 시트가 곧바로 열리고 그 제일 위에
   * 같은 단추가 있다 — 확인 하나가 늘 때마다 올리는 일이 그만큼 성가셔진다.
   */
  const [batch, setBatch] = useState<BatchState | null>(null);
  /*
   * 배치가 미리 돌아 둔 값. 시트가 열릴 때 건네준다.
   *
   * 상태가 아니라 ref 인 것은 이 값이 화면을 다시 그릴 이유가 없기 때문이다 —
   * 읽는 곳은 시트를 여는 그 한 줄뿐이고, 판을 닫아도 남아 있어야 한다.
   */
  const prefills = useRef<Map<string, BiblioPrefill>>(new Map());

  const startUpload = useCallback((groupId: string, files: File[]) => {
    if (files.length > 1) setBatch({ phase: "probing", total: files.length, rows: [] });
    enqueueUploads(groupId, files);
  }, []);

  /*
   * 물어보기 전에 **부를 수 있는지부터 본다.** 못 부르면 묻지도 않는다.
   *
   * 첫 편이 다 올라온 뒤에 묻는 것은, 그때가 되어야 물어볼 `paperId` 가 생기기
   * 때문이다. 시트가 쓰는 것과 **같은 판정**(`/suggest` 의 `agent`)을 쓴다 —
   * 여기만 따로 재면 시트에서는 되는데 배치에서는 안 되는 날이 온다.
   *
   * 나머지 파일은 그동안에도 계속 올라간다. 묻는 것이 올리기를 막지 않는다.
   */
  const firstUploaded = waiting[0]?.paperId ?? null;
  useEffect(() => {
    if (batch?.phase !== "probing") return;
    if (!firstUploaded) {
      /*
       * 다 올라갈 때까지 기다렸는데 하나도 안 왔다 = 전부 실패했다.
       *
       * 여기서 판을 접지 않으면 `batch` 가 "probing" 인 채로 남고, 그 뒤로는
       * 배수구가 막혀 **한 편을 올려도 시트가 안 열린다.** 물어볼 것이 없어진
       * 상태를 붙들고 있을 이유가 없다.
       */
      if (uploads.active === 0) setBatch(null);
      return;
    }
    let alive = true;
    void (async () => {
      const [state, config] = await Promise.all([
        api.biblio.status(firstUploaded).catch(() => null),
        api.getConfig().catch(() => null),
      ]);
      if (!alive) return;
      if (!state?.agent.ready) {
        // 배치를 접는다. 예전처럼 한 편씩 시트가 열린다.
        setBatch(null);
        return;
      }
      setBatch((b) =>
        b && b.phase === "probing"
          ? // 설정에서 "기본으로 맡긴다" 를 켜 둔 사람에게는 이미 답을 들은
            // 셈이다. 같은 질문을 올릴 때마다 다시 하지 않는다.
            { ...b, phase: config?.agentSuggestDefault ? "running" : "asking" }
          : b,
      );
    })();
    return () => {
      alive = false;
    };
  }, [batch?.phase, firstUploaded, uploads.active]);

  /*
   * 도는 몸통.
   *
   * 줄 서 있는 것을 하나씩 집어 `fillOne` 에 넘긴다. 업로드가 직렬이라 뒤 파일은
   * 아직 올라오는 중일 수 있으므로, 다 올라올 때까지 기다렸다 이어 간다.
   *
   * **하나가 실패해도 나머지는 돈다.** 열 편 중 셋이 스캔본이라고 나머지 일곱을
   * 버릴 이유가 없다. 실패한 것은 판에 이유가 남고, 그 편의 시트에서는 사람이
   * 단추를 다시 누를 수 있다.
   *
   * 값을 ref 로 읽는 것은 이 반복이 몇 분을 도는 동안 상태가 계속 바뀌기
   * 때문이다. 효과에 담아 두면 시작할 때의 옛 목록만 보게 된다.
   */
  const waitingRef = useRef<UploadedPaper[]>([]);
  const activeRef = useRef(0);
  const groupsRef = useRef<GroupDTO[]>(groups);
  const runningRef = useRef(false);
  const stopRef = useRef(false);
  useEffect(() => {
    waitingRef.current = waiting;
  }, [waiting]);
  useEffect(() => {
    activeRef.current = uploads.active;
  }, [uploads.active]);
  useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);

  useEffect(() => {
    if (batch?.phase !== "running" || runningRef.current) return;
    runningRef.current = true;
    stopRef.current = false;

    const mark = (paperId: string, status: BatchRowStatus, note?: string) =>
      setBatch((b) =>
        b
          ? { ...b, rows: b.rows.map((r) => (r.paperId === paperId ? { ...r, status, note } : r)) }
          : b,
      );

    void (async () => {
      const seen = new Set<string>();
      try {
        for (;;) {
          if (stopRef.current) break;
          const next = waitingRef.current.find((w) => !seen.has(w.paperId));
          if (!next) {
            // 아직 올라오는 중인 것이 있으면 기다린다.
            await new Promise((r) => setTimeout(r, 600));
            if (activeRef.current > 0) continue;
            // 다 올라갔다. 다만 마지막 한 편이 방금 도착해 아직 상태에 안 앉았을
            // 수 있으니 한 박자 뒤에 한 번 더 보고 접는다.
            if (waitingRef.current.some((w) => !seen.has(w.paperId))) continue;
            break;
          }
          seen.add(next.paperId);

          const paper = findPaper(groupsRef.current, next.paperId);
          const name = paper?.title ?? next.file.name;
          setBatch((b) =>
            b ? { ...b, rows: [...b.rows, { paperId: next.paperId, name, status: "lookup" }] } : b,
          );

          let report = null;
          try {
            const out = await fillOne(
              next.paperId,
              {
                title: paper?.title ?? next.file.name,
                doi: paper?.doi ?? null,
                arxivId: paper?.arxivId ?? null,
              },
              {
                alive: () => !stopRef.current,
                onReport: (r) => (report = r),
                onAgent: () => mark(next.paperId, "agent"),
              },
            );
            if (out.kind === "aborted") break;
            if (out.kind === "picking") {
              // 후보를 고르는 일은 우리 것이 아니다. 시트가 목록을 띄운다.
              prefills.current.set(next.paperId, {
                report: out.report,
                picked: null,
                guess: null,
                guessId: null,
                pendingPick: true,
              });
              mark(next.paperId, "picking", `후보 ${out.report.candidates.length}개 — 시트에서 고르세요`);
              continue;
            }
            if (out.kind === "failed") {
              // 찾아온 것이 있으면 그것만이라도 넘긴다. 에이전트가 넘어진 것이
              // 등록기관 값까지 버릴 이유는 아니다.
              prefills.current.set(next.paperId, {
                report,
                picked: out.picked,
                guess: null,
                guessId: null,
                error: out.error,
              });
              mark(next.paperId, "failed", out.error);
              continue;
            }
            prefills.current.set(next.paperId, {
              report,
              picked: out.picked,
              guess: out.guess,
              guessId: out.guessId,
            });
            mark(next.paperId, "done");
          } catch (e) {
            mark(next.paperId, "failed", e instanceof Error ? e.message : "채우지 못했습니다");
          }
        }
      } finally {
        runningRef.current = false;
        setBatch((b) => (b && b.phase === "running" ? { ...b, phase: "review" } : b));
      }
    })();
  }, [batch?.phase]);

  useEffect(() => {
    // 배치가 도는 동안에는 시트를 열지 않는다. 시트가 떠 있으면 그 논문의
    // 칸이 배치와 따로 놀고, 무엇보다 사람이 열 번 기다리게 된다.
    if (batch && batch.phase !== "review") return;
    if (sheet) return;
    if (waiting.length === 0) {
      // 다 확인했으면 판을 치운다.
      if (batch) setBatch(null);
      return;
    }
    const [next, ...rest] = waiting;
    setWaiting(rest);
    const paper = findPaper(groups, next.paperId);
    // 못 찾으면 줄에서 빼고 넘어간다. 그대로 두면 같은 것을 다시 집어
    // 무한히 도는데, 시트가 안 뜨는 것보다 그쪽이 훨씬 나쁘다.
    if (paper) {
      setSheet({
        mode: "edit",
        groupId: paper.groupId,
        paper,
        fresh: true,
        prefill: prefills.current.get(next.paperId),
      });
    }
    prefills.current.delete(next.paperId);
  }, [sheet, waiting, groups, batch]);

  // ─ 서가 조작 ─
  const handlers: GroupHandlers = useMemo(
    () => ({
      rename: (id, name) => void run(() => api.updateGroup(id, { name })).catch(() => undefined),
      setColor: (id, color) => void run(() => api.updateGroup(id, { color })).catch(() => undefined),
      setViewMode: (id, viewMode) => {
        // 낙관적 반영 — 토글은 즉시 반응해야 한다.
        setGroups((prev) =>
          prev.map((g) => ({
            ...g,
            viewMode: g.id === id ? viewMode : g.viewMode,
            children: g.children.map((c) =>
              c.id === id ? { ...c, viewMode } : c,
            ),
          })),
        );
        void run(() => api.updateGroup(id, { viewMode })).catch(() => undefined);
      },
      setCollapsed: (id, collapsed) => {
        setGroups((prev) =>
          prev.map((g) => ({
            ...g,
            collapsed: g.id === id ? collapsed : g.collapsed,
            children: g.children.map((c) => (c.id === id ? { ...c, collapsed } : c)),
          })),
        );
        void run(() => api.updateGroup(id, { collapsed })).catch(() => undefined);
      },
      remove: (id) => {
        const found = findGroup(groups, id);
        if (!found) return;
        const n = found.kind === "root" ? countPapers(found.group) : found.group.papers.length;
        const subs = found.kind === "root" ? found.group.children.length : 0;
        const what = [
          n > 0 ? `논문 ${n}편` : null,
          subs > 0 ? `하위 칸 ${subs}개` : null,
        ]
          .filter(Boolean)
          .join(" · ");
        const msg = what
          ? `"${found.group.name}" 과(와) 그 안의 ${what}을(를) 휴지통으로 옮깁니다. 30일 안에는 되살릴 수 있습니다. 진행할까요?`
          : `"${found.group.name}" 을(를) 휴지통으로 옮길까요?`;
        if (!confirm(msg)) return;
        void run(() => api.deleteGroup(id)).catch(() => undefined);
      },
      addSubGroup: (parentId) => {
        // 칸 이름은 만들 때 정해야 뜻이 산다. 나중에 고치기로 하고 "새 칸"
        // 으로 만들어 두면 그 이름이 그대로 남는다.
        const name = prompt("하위 칸 이름")?.trim();
        if (!name) return;
        void run(() => api.createGroup(name, parentId)).catch(() => undefined);
      },
      promote: (id) => void run(() => api.updateGroup(id, { parentId: null })).catch(() => undefined),
      addPaper: (groupId) => setSheet({ mode: "create", groupId }),
      uploadTo: startUpload,
      reorderPapers: (groupId, orderedIds) => {
        // 낙관적 반영 — 놓는 순간 자리가 잡혀야 한다.
        setGroups((prev) => reorderIn(prev, groupId, orderedIds));
        void run(() => api.reorderPapers(groupId, orderedIds)).catch(() => undefined);
      },
      notify: (message) => fail(new Error(message)),
    }),
    [run, fail, groups, startUpload],
  );

  // ─ 논문 조작 ─
  const paperActions: PaperRowActions = useMemo(
    () => ({
      onReadState: (paper, readState) => {
        patchPaper(setGroups, paper.id, { readState });
        void run(() => api.updatePaper(paper.id, { readState })).catch(() => undefined);
      },
      onMark: (paper, mark) => {
        patchPaper(setGroups, paper.id, { mark });
        void run(() => api.updatePaper(paper.id, { mark })).catch(() => undefined);
      },
      onEdit: (paper) => setSheet({ mode: "edit", groupId: paper.groupId, paper }),
      onDelete: (paper) => {
        if (!confirmMemoDelete(`"${paper.title}" 을(를) 휴지통으로 옮길까요? (30일 안에 되살릴 수 있습니다)`)) {
          return;
        }
        void run(() => api.deletePaper(paper.id)).catch(() => undefined);
      },
    }),
    [run],
  );

  // ─ 서가 순서 ─
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setGroups((prev) => {
      const from = prev.findIndex((g) => g.id === active.id);
      const to = prev.findIndex((g) => g.id === over.id);
      if (from < 0 || to < 0) return prev;
      /*
       * Inbox 자리는 건드리지 않는다.
       *
       * 서버(`reorderGroups`)가 시스템 그룹을 건너뛰고 `position: -1` 에
       * 남겨 둔다. 여기서 옮긴 척하면 화면만 잠깐 바뀌었다가 다음 폴링에
       * 제자리로 튕긴다 — 아예 받지 않는 편이 낫다.
       */
      if (prev[from].systemKey !== null || prev[to].systemKey !== null) return prev;
      const next = arrayMove(prev, from, to);
      // 뿌리 서가끼리의 순서라 parentId 는 null 이다.
      void api.reorderGroups(null, next.map((g) => g.id)).catch(() => undefined);
      return next;
    });
  };

  /*
   * 찾기.
   *
   * 질의·칩·짚은 자리는 `search-panel.tsx` 가 든다. 이 파일 머리말의
   * "상태는 전부 여기 있다" 는 **논문 데이터**를 두고 한 말이다 — 같은 논문이
   * 두 곳에 그려질 때 갈라지는 것을 막으려는 규칙이고, 질의는 서버로도 안
   * 나가고 한 곳에만 그려진다. 대신 결과는 `groups` 를 넘겨 **거기서
   * 파생시킨다**: 스냅샷을 따로 들면 위의 4초 폴링이 서재를 갈아 끼운 뒤에도
   * 지워진 논문이 결과에 남는다.
   */
  const search = useLibrarySearch(groups);

  const totalPapers = groups.reduce((s, g) => s + countPapers(g), 0);

  return (
    // 넓은 화면에서는 가로를 더 쓴다 — 2560px 모니터에서 1920 으로 잘리지 않도록
    <main className="relative mx-auto flex min-h-screen w-full max-w-[2560px] flex-col gap-6 px-6 py-10 lg:px-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-(--color-surface) ring-1 ring-(--color-border-soft)">
            <LibraryIcon className="h-5 w-5 text-(--color-accent)" />
          </div>
          <div>
            <h1 className="text-2xl leading-tight" style={{ fontFamily: "var(--font-serif)" }}>
              PaperBento
            </h1>
            <p className="text-xs text-(--color-fg-4)">
              서가 {groups.length} · 논문 {totalPapers}
            </p>
          </div>
        </div>

        {/*
          찾기 상자는 머리말의 **세 번째** 자식이다. `flex-wrap` +
          `justify-between` 이라 넓은 화면에서는 가운데에 앉아 남는 폭을 먹고,
          좁아지면 `order-3` 덕에 제 줄로 통째로 내려간다 — 아이콘 단추들과
          한 줄에서 폭을 다투지 않는다.
        */}
        <SearchBar
          search={search}
          className="order-3 w-full md:order-none md:w-auto md:max-w-xl md:flex-1"
        />

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setQueueOpen((v) => !v)}
            aria-pressed={queueOpen}
            title="업로드 큐"
            className={cn(
              "relative flex items-center gap-2 rounded-full px-4 py-2 text-sm ring-1 transition",
              uploads.active > 0
                ? "bg-(--color-accent-soft) text-(--color-accent-strong) ring-(--color-accent)/40"
                : "bg-(--color-surface) text-(--color-fg-2) ring-(--color-border-soft) hover:bg-(--color-surface-2)",
            )}
          >
            <ArrowUpFromLine className={cn("h-4 w-4", uploads.active > 0 && "animate-pulse")} />
            <span className="hidden sm:inline">업로드</span>
            {uploads.total > 0 && (
              <span className="rounded-full bg-(--color-bg-2) px-1.5 py-0.5 font-mono text-[10px] text-(--color-fg-3)">
                {uploads.active > 0 ? uploads.active : uploads.total}
              </span>
            )}
          </button>

          {/* renderMemoRef 는 넘기지 않는다 — 이 앱은 메모를 모른다.
              답변 안의 `[[memo:…]]` 는 회색 글자로 남을 뿐이다. */}
          <AgentChat />

          <MailBentoLink href={mailbentoUrl} />
          <MemoBentoLink href={memobentoUrl} />
          <Link
            href="/settings"
            className="flex items-center gap-2 rounded-full bg-(--color-accent-soft) px-4 py-2 text-sm text-(--color-accent-strong) ring-1 ring-(--color-accent)/40 transition hover:bg-(--color-accent)/25"
          >
            <SettingsIcon className="h-4 w-4" />
            <span className="hidden sm:inline">설정</span>
          </Link>
        </div>
      </header>

      {/*
        찾는 동안에는 격자를 **떼어 낸다** — `hidden` 으로 감추지 않는다.
        결과 목록은 서가를 가로지르는 납작한 한 줄이라 순서라는 것이 없는데,
        `SortableContext` 를 띄워 둔 채 결과만 얹으면 화면 밖 카드가 여전히
        dnd 에 등록되어 있다. 순서를 바꿀 수 없는 화면에서 끌기가 걸리는 것보다
        떼어 내는 편이 안전하다.
        값은 치른다: 카드마다의 스크롤 자리(각 카드가 제 `overflow-y-auto` 를
        갖는다)와 이름 고치는 중이던 상태가 사라져, 질의를 지우면 서가들이 맨
        위로 되감긴다. 끌기가 잘못 걸리는 것보다 이쪽이 덜 나쁘다고 봤다.

        질의가 주소(`?q=`)에 실리게 된 뒤에도 이 값은 늘지 않는다. 주소를
        고쳐 쓰는 것은 `history.replaceState` 라 길 이동이 아니고, 그래서 이
        갈래가 다시 그려지지도 격자가 다시 마운트되지도 않는다 (`router.replace`
        였다면 글자를 칠 때마다 서버 컴포넌트를 다시 받아 왔을 것이다 —
        `search-panel.tsx` 의 주소 쓰기 자리에 적어 뒀다).
        오히려 되감기는 **줄었다**: 결과에서 논문을 열었다 뒤로 오면 질의가
        되살아나 이 갈래로 바로 들어오므로, 예전처럼 빈 격자를 그렸다가 다시
        치는 일이 없다.
      */}
      {search.active ? (
        <SearchResults search={search} actions={paperActions} />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={groups.map((g) => g.id)} strategy={rectSortingStrategy}>
            <section className={cn("grid gap-4", COLUMN_CLASS[columns])}>
              {groups.map((g) => (
                <SortableGroupCard
                  key={g.id}
                  group={g}
                  handlers={handlers}
                  paperActions={paperActions}
                />
              ))}
              <AddGroupCard onCreate={(name) => void run(() => api.createGroup(name)).catch(() => undefined)} />
            </section>
          </SortableContext>
        </DndContext>
      )}

      <footer className="mt-2 text-center text-xs break-keep text-(--color-fg-4)">
        {search.active ? (
          <>
            <b>↑↓</b> 로 옮기고 <b>Enter</b> 로 엽니다 · <b>Esc</b> 로 지웁니다 ·
            찾는 동안에는 순서를 바꿀 수 없습니다
          </>
        ) : (
          <>
            PDF 를 서가에 <b>끌어다 놓으면</b> 올린 뒤 등록 시트가 열립니다 · 카드
            머리말을 끌면 서가 순서, 표지를 끌면 논문 순서가 바뀝니다 · <b>/</b> 로
            찾기
          </>
        )}
      </footer>

      <PaperSheet
        target={sheet}
        groups={groups}
        onClose={() => setSheet(null)}
        onSubmit={async (groupId, fields) => {
          const editing = sheet?.paper;
          if (editing) {
            await run(() => api.updatePaper(editing.id, { ...fields, groupId }));
          } else {
            // 만들기는 응답 모양이 다르다 (`paperId` 가 함께 온다).
            // 여기서는 쓸 데가 없으므로 서가만 꺼내 쓴다.
            await run(async () => (await api.createPaper(groupId, fields)).groups);
          }
        }}
      />

      <UploadPanel open={queueOpen} onClose={() => setQueueOpen(false)} />

      {batch && (
        <BiblioBatchPanel
          state={batch}
          onStart={() => setBatch((b) => (b ? { ...b, phase: "running" } : b))}
          // "하나씩 확인" — 배치를 접으면 위의 배수구가 곧바로 시트를 연다.
          onSkip={() => setBatch(null)}
          onStop={() => {
            stopRef.current = true;
          }}
          onClose={() => setBatch(null)}
        />
      )}

      {/* 오류 토스트 */}
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

// ─────────────────────────────────────────────────────────────
//   서재를 뒤지는 작은 것들
// ─────────────────────────────────────────────────────────────

type Found =
  | { kind: "root"; group: GroupDTO }
  | { kind: "sub"; group: GroupDTO["children"][number] };

/** 서가와 칸을 통틀어 논문 하나를 찾는다. */
function findPaper(groups: GroupDTO[], id: string): PaperDTO | null {
  for (const g of groups) {
    const hit = g.papers.find((p) => p.id === id);
    if (hit) return hit;
    for (const c of g.children) {
      const sub = c.papers.find((p) => p.id === id);
      if (sub) return sub;
    }
  }
  return null;
}

function findGroup(groups: GroupDTO[], id: string): Found | null {
  for (const g of groups) {
    if (g.id === id) return { kind: "root", group: g };
    const sub = g.children.find((c) => c.id === id);
    if (sub) return { kind: "sub", group: sub };
  }
  return null;
}

/**
 * 논문 하나를 그 자리에서 갈아 끼운다 (서버 응답 전 즉시 반영용).
 *
 * 읽기 상태와 표식은 누르는 즉시 반응해야 한다. 서버를 기다렸다 그리면
 * 느린 회선에서 두 번 눌리고, 그러면 세 갈래 상태가 한 칸 더 돌아 버린다.
 */
function patchPaper(
  set: React.Dispatch<React.SetStateAction<GroupDTO[]>>,
  paperId: string,
  patch: Partial<PaperDTO>,
): void {
  const fix = (list: PaperDTO[]) =>
    list.map((p) => (p.id === paperId ? { ...p, ...patch } : p));
  set((prev) =>
    prev.map((g) => ({
      ...g,
      papers: fix(g.papers),
      children: g.children.map((c) => ({ ...c, papers: fix(c.papers) })),
    })),
  );
}

/** 한 무리 안의 논문 순서를 주어진 차례대로 다시 세운다. */
function reorderIn(groups: GroupDTO[], groupId: string, orderedIds: string[]): GroupDTO[] {
  const sort = (list: PaperDTO[]) => {
    const byId = new Map(list.map((p) => [p.id, p]));
    const next = orderedIds.map((id) => byId.get(id)).filter((p): p is PaperDTO => !!p);
    // 목록에 없던 것이 있으면 뒤에 붙인다 — 사이에 에이전트가 하나 끼워
    // 넣었을 수 있고, 그걸 여기서 떨어뜨리면 화면에서 사라진다.
    const seen = new Set(orderedIds);
    return [...next, ...list.filter((p) => !seen.has(p.id))];
  };
  return groups.map((g) => ({
    ...g,
    papers: g.id === groupId ? sort(g.papers) : g.papers,
    children: g.children.map((c) => ({
      ...c,
      papers: c.id === groupId ? sort(c.papers) : c.papers,
    })),
  }));
}
