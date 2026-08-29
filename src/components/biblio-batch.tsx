"use client";

import { AlertTriangle, Check, Loader2, Sparkles, X } from "lucide-react";

import { api, type BiblioClue, type BiblioGuess } from "@/lib/client-api";
import type { LookupReport, LookupResult } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * 서지정보 채우기의 **엔진**과, 여러 편을 한꺼번에 올렸을 때 한 번만 묻는 자리.
 *
 * ## 왜 시트 밖에 있는가
 *
 * 채우는 순서(찾아오기 → 에이전트)는 `paper-sheet.tsx` 에만 적혀 있었다. 그런데
 * 열 편을 올린 사람은 시트를 열 번 열어 열 번 기다릴 수 없다 — 한 편에 1분이
 * 넘고, BentoAgent 는 어차피 한 줄로 서서 하나씩 돈다. 그래서 시트를 열지 않고도
 * 같은 일을 도는 길이 필요해졌다.
 *
 * 그때 순서를 두 벌로 적으면 한쪽만 고치는 날이 온다. 그래서 **차례 자체를
 * 여기로 옮기고**(`fillOne`) 시트도 배치도 이것을 부른다. 시트는 그 결과를
 * 칸에 앉히는 일만 한다.
 *
 * ## 여기서 논문은 바뀌지 않는다
 *
 * `fillOne` 이 부르는 것은 `/api/lookup` 과 `/api/papers/:id/suggest` 뿐이다.
 * 앞은 바깥에서 읽어 오는 것이고 뒤는 `paper_suggestions` 에만 앉는다 —
 * `papers` 를 쓰는 요청은 한 줄도 없다. 배치가 열 편을 돌아도 서재는 그대로다.
 * 논문이 바뀌는 것은 사람이 시트에서 값을 보고 **저장**을 누른 그 한 번이다.
 *
 * PDF 는 남이 만든 파일이고 그 안의 글이 곧 제안이 된다. 사람 없이 저장까지
 * 가는 길을 여기에 내면, 심어 둔 문장 하나가 서재를 고치게 된다.
 */

// ─────────────────────────────────────────────────────────────
//   엔진 — 한 편을 채우는 차례
// ─────────────────────────────────────────────────────────────

/** 폴링 간격. 더 짧게 물어봐도 답이 빨리 나오지는 않는다. */
export const POLL_MS = 2500;
/** 이만큼 물어보고도 안 끝나면 접는다. 서버도 6분에서 실패로 접는다. */
export const MAX_POLLS = 160;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 찾아오기가 쓸 재료. 논문 한 편에서 이 셋만 있으면 된다. */
export interface FillBase {
  title?: string | null;
  doi?: string | null;
  arxivId?: string | null;
}

/** 찾아오기가 쓸 재료가 있는가. 없으면 부를 것도 없다. */
export function lookupable(f: FillBase): boolean {
  return (
    Boolean(f.doi?.trim()) ||
    Boolean(f.arxivId?.trim()) ||
    (f.title?.trim().length ?? 0) >= 4
  );
}

/** 찾아온 후보를 에이전트에게 넘길 단서로 눕힌다. */
export function clueOf(r: LookupResult): BiblioClue {
  return { source: r.source, ...r.fields };
}

type AskOutcome =
  | { kind: "aborted" }
  | { kind: "done"; guess: BiblioGuess | null; guessId: string }
  | { kind: "failed"; error: string };

/**
 * 에이전트에게 맡기고 답이 올 때까지 몇 초마다 물어본다.
 *
 * 시작만 시키고 폴링하는 것은 답까지 1분이 넘는 일이 흔한데 요청을 붙들면 앞의
 * 터널이 100초에서 끊기 때문이다.
 *
 * `alive` 가 거짓이 되면 그 자리에서 접는다 — 시트가 닫혔거나 배치를 멈춘
 * 것이라, 몇 분을 더 도는 폴링은 값만 쓴다.
 */
export async function askAgent(
  paperId: string,
  clue: BiblioClue | null,
  alive: () => boolean,
): Promise<AskOutcome> {
  try {
    let row = await api.biblio.start(paperId, clue);
    for (let i = 0; row && row.state === "running" && i < MAX_POLLS; i++) {
      await sleep(POLL_MS);
      if (!alive()) return { kind: "aborted" };
      row = (await api.biblio.status(paperId, row.id)).suggestion;
    }
    if (!alive()) return { kind: "aborted" };
    if (!row || row.state === "running") {
      return { kind: "failed", error: "에이전트가 제 시간에 끝내지 못했습니다" };
    }
    if (row.state === "failed") {
      return { kind: "failed", error: row.error ?? "에이전트가 서지정보를 뽑지 못했습니다" };
    }
    return { kind: "done", guess: row.fields, guessId: row.id };
  } catch (e) {
    if (!alive()) return { kind: "aborted" };
    return {
      kind: "failed",
      error: e instanceof Error ? e.message : "에이전트를 부르지 못했습니다",
    };
  }
}

export interface FillHooks {
  /** 아직 이 결과를 받을 곳이 있는가. 거짓이 되면 즉시 접는다. */
  alive: () => boolean;
  /** 찾아오기 보고서 — 거쳐 온 길까지 담겨 있다. 실패해도 온다. */
  onReport?: (r: LookupReport) => void;
  /** 찾아오기 자체가 넘어졌을 때 한 문장. */
  onLookupError?: (message: string) => void;
  /** 후보가 하나로 정해졌다. 이 값은 **정확한 것**이다. */
  onPicked?: (c: LookupResult) => void;
  /** 이제 PDF 를 읽는 단계로 넘어간다. 여기서부터 오래 걸린다. */
  onAgent?: () => void;
}

export type FillOutcome =
  | { kind: "aborted" }
  /** 후보가 여럿이라 멈췄다. 무엇을 단서로 줄지는 사람이 고른 뒤여야 한다. */
  | { kind: "picking"; report: LookupReport }
  | { kind: "done"; picked: LookupResult | null; guess: BiblioGuess | null; guessId: string }
  | { kind: "failed"; picked: LookupResult | null; error: string };

/**
 * **찾아오기가 먼저, 에이전트가 나중.** 이 순서가 이 기능의 전부다.
 *
 * 등록기관에서 받은 서지정보는 정확한 것이고, 모델이 PDF 를 읽어 짐작한 것은
 * 추측이다. 정확한 것이 있는데 추측부터 시키면 같은 칸에 두 값이 서로 다르게
 * 앉고, 그때부터는 어느 쪽이 맞는지 **사람이 가려야 한다.** 그건 넘기지
 * 않아도 될 일을 넘기는 것이다. 그래서 찾아온 것을 단서로 함께 넘긴다.
 *
 * 후보가 여럿이면 **여기서 멈춘다.** 제목 검색은 1등이 맞다는 보장이 없는데,
 * 우리가 골라 단서로 주면 틀린 논문의 서지정보를 "확정된 값" 이라고 모델에게
 * 알려 주는 셈이 된다.
 *
 * 찾아오기가 실패한 것은 멈출 이유가 아니다. 그때는 추측밖에 없으니 추측이라도
 * 있는 편이 낫다 — PDF 글자만으로 간다.
 */
export async function fillOne(
  paperId: string,
  base: FillBase,
  hooks: FillHooks,
): Promise<FillOutcome> {
  let picked: LookupResult | null = null;

  if (lookupable(base)) {
    try {
      const r = await api.lookup({ doi: base.doi, arxiv: base.arxivId, title: base.title });
      if (!hooks.alive()) return { kind: "aborted" };
      hooks.onReport?.(r);
      if (r.candidates.length > 1) return { kind: "picking", report: r };
      if (r.candidates.length === 1) {
        picked = r.candidates[0];
        hooks.onPicked?.(picked);
      }
    } catch (e) {
      if (!hooks.alive()) return { kind: "aborted" };
      hooks.onLookupError?.(e instanceof Error ? e.message : "찾아오기에 실패했습니다");
    }
  }

  hooks.onAgent?.();
  const out = await askAgent(paperId, picked ? clueOf(picked) : null, hooks.alive);
  if (out.kind === "aborted") return { kind: "aborted" };
  if (out.kind === "failed") return { kind: "failed", picked, error: out.error };
  return { kind: "done", picked, guess: out.guess, guessId: out.guessId };
}

// ─────────────────────────────────────────────────────────────
//   배치가 시트에게 건네는 것
// ─────────────────────────────────────────────────────────────

/**
 * 배치가 미리 돌아 둔 결과. 시트가 열릴 때 그대로 칸에 앉는다.
 *
 * **값을 담아 건네는 것은 일부러다.** 시트가 다시 부르게 하면 사람은 편마다
 * 또 1분씩 기다린다 — 배치를 만든 이유가 없어진다. 그렇다고 배치가 저장까지
 * 하면 논문이 사람 없이 바뀐다. 그 사이가 여기다: 값은 미리 받아 두고,
 * 칸에 앉히는 것도 미리 하되, **저장은 사람이 시트에서 누른다.**
 */
export interface BiblioPrefill {
  /** 거쳐 온 길. 시트가 그대로 보여 준다. */
  report: LookupReport | null;
  /** 정해진 후보. 이 값과 `csl` 원본이 칸에 앉는다. */
  picked: LookupResult | null;
  guess: BiblioGuess | null;
  guessId: string | null;
  /** 후보가 여럿이라 멈춰 있다. 시트가 목록을 띄우고 고르면 이어 돈다. */
  pendingPick?: boolean;
  /** 넘어진 자리 한 문장. 값이 없어도 왜 없는지는 보여야 한다. */
  error?: string | null;
}

// ─────────────────────────────────────────────────────────────
//   배치 상태와 그것을 그리는 판
// ─────────────────────────────────────────────────────────────

export type BatchPhase =
  /** 에이전트를 부를 수 있는지 알아보는 중. 못 부르면 묻지도 않는다. */
  | "probing"
  /** 사람에게 한 번 묻는 중. */
  | "asking"
  /** 도는 중. */
  | "running"
  /** 다 돌았다. 이제 한 편씩 시트를 연다. */
  | "review";

export type BatchRowStatus = "queued" | "lookup" | "agent" | "done" | "picking" | "failed";

export interface BatchRow {
  paperId: string;
  name: string;
  status: BatchRowStatus;
  /** 실패했거나 확인이 필요한 이유 한 문장. */
  note?: string;
}

export interface BatchState {
  phase: BatchPhase;
  /** 올리기 시작한 편수. 아직 올라오는 중인 것까지 센다. */
  total: number;
  rows: BatchRow[];
}

const STATUS_LABEL: Record<BatchRowStatus, string> = {
  queued: "대기",
  lookup: "바깥에서 찾는 중",
  agent: "PDF 를 읽는 중",
  done: "채웠습니다",
  picking: "후보가 여럿 — 고르세요",
  failed: "실패",
};

/**
 * 여러 편을 올렸을 때 뜨는 판.
 *
 * **왼쪽 아래에 둔다.** 오른쪽 아래는 업로드 줄의 자리이고, 둘은 같은 때에
 * 돈다 — 뒤 파일이 올라가는 동안 앞 파일은 이미 채워지고 있다. 겹쳐 두면
 * 둘 중 하나는 안 보인다.
 */
export function BiblioBatchPanel({
  state,
  onStart,
  onSkip,
  onStop,
  onClose,
}: {
  state: BatchState;
  /** "모두 맡기기". */
  onStart: () => void;
  /** "하나씩 확인" — 배치를 접고 예전처럼 시트를 하나씩 연다. */
  onSkip: () => void;
  /** 도는 중에 멈추기. 이미 채운 것은 남는다. */
  onStop: () => void;
  onClose: () => void;
}) {
  // 물어보기 전(부를 수 있는지 알아보는 중)에는 아무것도 안 띄운다.
  // 몇백 밀리초짜리 상태 때문에 판이 깜빡이면 그게 더 시끄럽다.
  if (state.phase === "probing") return null;

  const done = state.rows.filter((r) => r.status === "done").length;
  const failed = state.rows.filter((r) => r.status === "failed").length;
  const picking = state.rows.filter((r) => r.status === "picking").length;
  const total = Math.max(state.total, state.rows.length);
  const pct = total > 0 ? Math.min(100, Math.round((state.rows.filter((r) => r.status !== "queued" && r.status !== "lookup" && r.status !== "agent").length / total) * 100)) : 0;

  return (
    <div className="fixed bottom-6 left-6 z-50 w-[min(380px,90vw)] rounded-[var(--radius-app)] bg-(--color-surface) shadow-2xl ring-1 ring-(--color-border)">
      <header className="flex items-center justify-between gap-2 border-b border-(--color-border-soft) px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-(--color-accent)" />
          <span className="truncate text-xs font-medium text-(--color-fg-2)">
            {state.phase === "asking"
              ? `PDF ${state.total}편을 올렸습니다`
              : state.phase === "running"
                ? `서지정보 채우는 중 — ${done + failed + picking} / ${total}`
                : `${done}편을 채웠습니다`}
          </span>
        </div>
        {state.phase !== "running" && (
          <button
            type="button"
            onClick={onClose}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-(--color-fg-4) hover:bg-(--color-surface-hi) hover:text-(--color-fg-2)"
            aria-label="닫기"
            title="닫기"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </header>

      {state.phase === "asking" && (
        <div className="flex flex-col gap-3 px-4 py-3.5">
          <p className="text-[11.5px] leading-relaxed break-keep text-(--color-fg-3)">
            {state.total}편 모두 <b className="text-(--color-fg-2)">에이전트가 서지정보를 채우게</b>{" "}
            할까요? 먼저 바깥(doi.org · arXiv · Crossref)에서 찾고, 거기서 못 채운 칸만
            PDF 앞부분을 읽어 짐작합니다.
          </p>
          {/* 무엇이 바뀌고 무엇이 안 바뀌는지 누르기 전에 말한다. */}
          <p className="text-[10.5px] leading-snug break-keep text-(--color-fg-4)">
            도는 동안 서재는 그대로입니다. 다 돌면 한 편씩 시트가 열리고, 채운 값은
            거기서 확인하고 <b className="text-(--color-fg-3)">저장</b>을 눌러야 논문에
            들어갑니다. 한 편에 1분이 넘을 수 있습니다.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onStart}
              className="flex items-center gap-1.5 rounded-full bg-(--color-accent) px-3.5 py-1.5 text-xs font-medium text-(--color-bg) transition hover:bg-(--color-accent-strong)"
            >
              <Sparkles className="h-3.5 w-3.5" />
              모두 맡기기
            </button>
            <button
              type="button"
              onClick={onSkip}
              className="rounded-full bg-(--color-bg-2) px-3.5 py-1.5 text-xs text-(--color-fg-3) ring-1 ring-(--color-border-soft) transition hover:bg-(--color-surface-hi)"
            >
              하나씩 확인
            </button>
          </div>
        </div>
      )}

      {state.phase !== "asking" && (
        <>
          {state.phase === "running" && (
            <div className="px-4 pt-3">
              <div className="h-1 w-full overflow-hidden rounded-full bg-(--color-bg-2)">
                <div
                  className="h-full rounded-full bg-(--color-accent) transition-[width]"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )}

          {state.rows.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs break-keep text-(--color-fg-4)">
              올라온 논문을 기다리는 중입니다
            </p>
          ) : (
            <ul className="scrollbar-thin max-h-[280px] divide-y divide-(--color-border-soft) overflow-y-auto">
              {state.rows.map((r) => (
                <li key={r.paperId} className="flex items-start gap-2.5 px-4 py-2.5">
                  <span className="mt-0.5 shrink-0">
                    {r.status === "done" ? (
                      <Check className="h-3.5 w-3.5 text-(--color-accent-strong)" />
                    ) : r.status === "failed" ? (
                      <AlertTriangle className="h-3.5 w-3.5 text-(--color-danger)" />
                    ) : r.status === "picking" ? (
                      <AlertTriangle className="h-3.5 w-3.5 text-(--color-warn)" />
                    ) : (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-(--color-fg-3)" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11.5px] text-(--color-fg-2)" title={r.name}>
                      {r.name}
                    </div>
                    <div
                      className={cn(
                        "mt-0.5 truncate text-[10px]",
                        r.status === "failed"
                          ? "text-(--color-danger)"
                          : r.status === "picking"
                            ? "text-(--color-warn)"
                            : "text-(--color-fg-4)",
                      )}
                      title={r.note}
                    >
                      {r.note ?? STATUS_LABEL[r.status]}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <footer className="flex items-center justify-between gap-2 border-t border-(--color-border-soft) px-4 py-2.5">
            <span className="min-w-0 flex-1 text-[10.5px] leading-snug break-keep text-(--color-fg-4)">
              {state.phase === "running"
                ? "하나가 실패해도 나머지는 계속 돕니다"
                : "이제 한 편씩 시트가 열립니다 — 확인하고 저장하세요"}
            </span>
            {state.phase === "running" && (
              <button
                type="button"
                onClick={onStop}
                className="shrink-0 rounded-full bg-(--color-bg-2) px-3 py-1 text-[11px] text-(--color-fg-3) ring-1 ring-(--color-border-soft) transition hover:bg-(--color-surface-hi)"
              >
                멈추기
              </button>
            )}
          </footer>
        </>
      )}
    </div>
  );
}
