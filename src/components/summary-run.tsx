"use client";

import {
  AlertTriangle,
  ChevronRight,
  Loader2,
  Pencil,
  Sparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { apiPath } from "@/lib/api-path";
import { api } from "@/lib/client-api";
import { readJson } from "@/lib/read-json";
import type { GroupDTO, SummaryDTO } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * 요약을 에이전트에게 맡기는 상자.
 *
 * ## 무엇을 시키는지 보고 누른다
 *
 * 프리셋은 이름만 접힌 채 한 줄로 보이고, 펼치면 **지시문 전문**이 보인다.
 * 요약이 마음에 안 들었을 때 "왜 이렇게 나왔지" 를 되짚을 수 있으려면, 그때
 * 무엇을 시켰는지가 눈에 보이는 자리에 있어야 한다. 이름만 보이고 지시문은
 * 어딘가 설정 화면에 있으면 아무도 안 본다.
 *
 * "이 요청만 고치기" 는 **그 번만** 손본다. 프리셋을 바꾸지 않는다 — 한 번
 * 다르게 시켜 보려다 프리셋이 영영 바뀌어 있는 것은 사고다.
 *
 * ## 실행은 언제나 사람이 누른다
 *
 * 상자를 여는 것도, 프리셋을 고르는 것도, 지시문을 손보는 것도 아직 아무 일도
 * 일으키지 않는다. 서버로 무언가 가는 것은 아래 "실행" 을 누른 그 순간뿐이다.
 * 자동으로 도는 길은 만들지 않는다.
 *
 * ## 사람이 쓴 요약은 확인받고 덮는다
 *
 * 에이전트가 만든 요약을 다시 만드는 것은 잃을 것이 없다. 사람이 손으로 적은
 * 글은 다시 만들 수 없다. 그래서 그때만 확인 단계를 하나 세운다 (서버도 같은
 * 것을 본다 — 화면만 믿지 않는다).
 *
 * ## 도는 동안
 *
 * 요약은 1분을 넘기는 일이 흔하다. 요청을 붙들면 앞의 터널이 100초에서 끊으므로
 * 시작만 시키고 몇 초마다 물어본다. 그동안 진행 표시를 띄운다 — 아무 신호가
 * 없으면 도는 중인지 죽은 건지 알 수 없고, 사람은 한 번 더 누른다.
 */

/** 프리셋의 첫 줄이 이름이다. `app/api/config/route.ts` 를 보라. */
function presetName(preset: string): string {
  const first = preset.split("\n", 1)[0]?.trim();
  return first || "이름 없는 지시문";
}

interface RunRow {
  id: string;
  state: "running" | "done" | "failed";
  error: string | null;
}

interface RunResponse {
  run: RunRow | null;
  summary: SummaryDTO | null;
  groups?: GroupDTO[];
}

/** 물어보는 간격. 더 짧게 해도 답이 빨리 나오지 않는다. */
const POLL_MS = 2500;

export function SummaryRun({
  paperId,
  summary,
  onDone,
  className,
}: {
  paperId: string;
  /** 지금 붙어 있는 요약. 사람이 쓴 것이면 덮기 전에 확인한다. */
  summary: SummaryDTO | null;
  /** 요약이 완성됐을 때. 상세 화면이 그 자리에 끼워 넣는다. */
  onDone: (summary: SummaryDTO | null) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [presets, setPresets] = useState<string[] | null>(null);
  const [picked, setPicked] = useState(0);
  /** 펼쳐 둔 프리셋. 한 번에 하나만 편다 — 전부 펴면 목록이 아니라 문서가 된다. */
  const [expanded, setExpanded] = useState<number | null>(null);
  /** "이 요청만 고치기" 로 손본 지시문. null 이면 프리셋 그대로. */
  const [edited, setEdited] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  /** 화면이 사라진 뒤 늦게 온 답이 상태를 건드리지 않게. */
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      for (const t of timers.current) clearTimeout(t);
      timers.current = [];
    };
  }, []);

  // 프리셋은 상자를 처음 열 때만 받아 온다. 안 열면 부를 이유가 없다.
  useEffect(() => {
    if (!open || presets !== null) return;
    api
      .getConfig()
      .then((c) => {
        if (alive.current) setPresets(c.summaryPresets);
      })
      .catch((e: unknown) => {
        if (alive.current) {
          setPresets([]);
          setError(e instanceof Error ? e.message : "프리셋을 받아 오지 못했습니다");
        }
      });
  }, [open, presets]);

  const finish = useCallback(
    (res: RunResponse) => {
      setRunning(false);
      onDone(res.summary);
      setOpen(false);
      setEdited(null);
      setConfirmed(false);
    },
    [onDone],
  );

  /** 몇 초마다 물어본다. 이 요청이 서버 쪽 진행을 민다. */
  const poll = useCallback(
    (runId: string, startedAt: number) => {
      const tick = async () => {
        if (!alive.current) return;
        try {
          const res = await fetch(
            apiPath(
              `/api/papers/${encodeURIComponent(paperId)}/summarize?id=${encodeURIComponent(runId)}`,
            ),
            { cache: "no-store" },
          );
          const json = await readJson<RunResponse>(res);
          if (!alive.current) return;

          if (!json.run || json.run.state === "running") {
            setElapsed(Math.round((Date.now() - startedAt) / 1000));
            timers.current.push(setTimeout(() => void tick(), POLL_MS));
            return;
          }
          if (json.run.state === "failed") {
            setRunning(false);
            setError(json.run.error ?? "요약을 만들지 못했습니다");
            return;
          }
          finish(json);
        } catch (e) {
          if (!alive.current) return;
          setRunning(false);
          setError(e instanceof Error ? e.message : "요약을 만들지 못했습니다");
        }
      };
      timers.current.push(setTimeout(() => void tick(), POLL_MS));
    },
    [paperId, finish],
  );

  const instruction = edited ?? presets?.[picked] ?? "";
  const needsConfirm = summary?.source === "human" && summary.body.trim().length > 0;
  const canRun = instruction.trim().length > 0 && (!needsConfirm || confirmed) && !running;

  const run = async () => {
    setError(null);
    setRunning(true);
    setElapsed(0);
    const startedAt = Date.now();
    try {
      const res = await fetch(apiPath(`/api/papers/${encodeURIComponent(paperId)}/summarize`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction, overwrite: needsConfirm ? true : undefined }),
      });
      const json = await readJson<RunResponse>(res);
      if (!alive.current) return;

      // 시작하자마자 끝난 경우(캐시된 실패 등)를 위해 상태를 먼저 본다.
      if (json.run?.state === "done") {
        finish(json);
        return;
      }
      if (!json.run || json.run.state === "failed") {
        setRunning(false);
        setError(json.run?.error ?? "요약을 시작하지 못했습니다");
        return;
      }
      poll(json.run.id, startedAt);
    } catch (e) {
      if (!alive.current) return;
      setRunning(false);
      setError(e instanceof Error ? e.message : "요약을 시작하지 못했습니다");
    }
  };

  /*
   * 단추는 늘 제자리에 있고, 상자는 그 위에 **띄워서** 그린다.
   *
   * 예전에는 열 때 단추를 상자로 갈아 끼웠다. 그러면 상자가 요약 칸 안에서
   * 자리를 차지해 **칸이 통째로 커졌다가 닫으면 다시 줄어든다.** 읽던 요약이
   * 아래로 밀려나고, 닫으면 되돌아오는데, 그 사이 눈이 따라가야 한다.
   *
   * `absolute` 라 흐름에서 빠져 있어 뒤의 것이 움직이지 않는다. 오른쪽에
   * 붙이는 것은 이 단추가 칸 오른쪽 끝에 있어서다 — 왼쪽으로 열면 화면 밖으로
   * 나간다.
   */
  return (
    <div className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          setError(null);
        }}
        aria-expanded={open}
        className={cn(
          "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] ring-1 transition",
          open
            ? "bg-(--color-accent-soft) text-(--color-accent-strong) ring-(--color-accent)/40"
            : "bg-(--color-bg-2) text-(--color-fg-2) ring-(--color-border-soft) hover:bg-(--color-surface-hi)",
        )}
      >
        <Sparkles className="h-3 w-3" />
        에이전트에게 맡기기
      </button>

      {open && (
        <>
          {/*
            바깥을 눌러 닫는 자리. 상자보다 뒤에 깔린다.
            적어 둔 지시문이 있어도 실행 전이므로 닫아도 잃을 것이 없다.
          */}
          <div
            className="fixed inset-0 z-20"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="absolute top-full right-0 z-30 mt-2 w-[min(30rem,calc(100vw-3rem))] rounded-lg bg-(--color-surface-2) p-4 shadow-lg ring-1 ring-(--color-border-soft)">
      <header className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs text-(--color-fg-2)">
          <Sparkles className="h-3.5 w-3.5 text-(--color-accent-strong)" />
          무엇을 시킬지 고르세요
        </div>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setEdited(null);
            setConfirmed(false);
          }}
          disabled={running}
          aria-label="닫기"
          className="rounded-full p-1 text-(--color-fg-4) transition hover:bg-(--color-surface-hi) hover:text-(--color-fg-2) disabled:opacity-40"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </header>

      {presets === null ? (
        <p className="flex items-center gap-2 py-4 text-[11px] text-(--color-fg-4)">
          <Loader2 className="h-3 w-3 animate-spin" />
          지시문을 불러오는 중
        </p>
      ) : (
        <>
          {/*
            프리셋 목록. 접혀 있을 때는 첫 줄(이름)만, 펼치면 전문이 보인다.
            고르는 것과 펴는 것은 다른 동작이라 손잡이도 둘로 나눠 둔다 —
            지시문을 읽어 보려고 눌렀는데 선택이 바뀌면 안 된다.
          */}
          <ul className="flex flex-col gap-1">
            {presets.map((preset, i) => (
              <li key={i}>
                <div
                  className={cn(
                    "flex items-center gap-1 rounded-md px-1 transition",
                    i === picked
                      ? "bg-(--color-accent-soft) ring-1 ring-(--color-accent)/40"
                      : "hover:bg-(--color-surface-hi)",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setExpanded((v) => (v === i ? null : i))}
                    aria-expanded={expanded === i}
                    aria-label={`${presetName(preset)} 지시문 ${expanded === i ? "접기" : "펼치기"}`}
                    className="shrink-0 rounded p-1 text-(--color-fg-4) transition hover:text-(--color-fg-2)"
                  >
                    <ChevronRight
                      className={cn(
                        "h-3 w-3 transition-transform",
                        expanded === i && "rotate-90",
                      )}
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPicked(i);
                      // 다른 프리셋을 고르면 손본 것은 버린다. 남겨 두면
                      // 고른 이름과 실제로 갈 지시문이 갈라진다.
                      setEdited(null);
                    }}
                    disabled={running}
                    className={cn(
                      "min-w-0 flex-1 truncate py-1.5 text-left text-[12px] disabled:opacity-60",
                      i === picked ? "text-(--color-accent-strong)" : "text-(--color-fg-2)",
                    )}
                  >
                    {presetName(preset)}
                  </button>
                </div>
                {expanded === i && (
                  <p className="mt-1 mb-1 ml-6 rounded-md bg-(--color-surface) p-2.5 text-[11px] leading-relaxed break-keep whitespace-pre-wrap text-(--color-fg-3) ring-1 ring-(--color-border-soft)">
                    {preset}
                  </p>
                )}
              </li>
            ))}
          </ul>

          {/* 이 번만 손보기. 프리셋 자체는 그대로 남는다. */}
          {edited === null ? (
            <button
              type="button"
              onClick={() => setEdited(presets[picked] ?? "")}
              disabled={running || presets.length === 0}
              className="mt-2 flex items-center gap-1.5 text-[11px] text-(--color-fg-4) transition hover:text-(--color-fg-2) disabled:opacity-40"
            >
              <Pencil className="h-3 w-3" />이 요청만 고치기
            </button>
          ) : (
            <div className="mt-2">
              <textarea
                value={edited}
                autoFocus
                onChange={(e) => setEdited(e.target.value)}
                disabled={running}
                rows={6}
                className="scrollbar-thin w-full resize-y rounded-md bg-(--color-surface) p-2.5 text-[11.5px] leading-relaxed text-(--color-fg) ring-1 ring-(--color-border-soft) outline-none focus:ring-(--color-accent)/60"
              />
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="text-[10.5px] text-(--color-fg-4)">
                  이 번만 바뀝니다. 프리셋은 그대로입니다
                </span>
                <button
                  type="button"
                  onClick={() => setEdited(null)}
                  disabled={running}
                  className="text-[10.5px] text-(--color-fg-4) transition hover:text-(--color-fg-2) disabled:opacity-40"
                >
                  되돌리기
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* 사람이 쓴 요약을 덮는 자리. 서버도 같은 것을 본다. */}
      {needsConfirm && (
        <label className="mt-3 flex items-start gap-2 rounded-md bg-(--color-surface) px-3 py-2.5 text-[11px] ring-1 ring-(--color-border-soft)">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            disabled={running}
            className="mt-0.5 h-3.5 w-3.5 shrink-0"
          />
          <span className="min-w-0 break-keep text-(--color-fg-3)">
            <b className="text-(--color-fg-2)">직접 쓰신 요약이 이미 있습니다.</b> 새로 만들면
            지금 글은 사라지고 되돌릴 수 없습니다. 덮어써도 괜찮습니다.
          </span>
        </label>
      )}

      {error && (
        <p className="mt-3 flex items-start gap-1.5 rounded-md bg-(--color-danger)/10 px-3 py-2 text-[11px] break-keep text-(--color-danger) ring-1 ring-(--color-danger)/30">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span className="min-w-0">{error}</span>
        </p>
      )}

      <div className="mt-3 flex items-center justify-end gap-2">
        <span className="mr-auto text-[10.5px] text-(--color-fg-4)">
          {running
            ? `읽고 쓰는 중… ${elapsed}초`
            : "PDF 앞부분의 글자만 넘어갑니다 (원본은 넘기지 않습니다)"}
        </span>
        <button
          type="button"
          onClick={() => void run()}
          disabled={!canRun}
          className="flex items-center gap-1.5 rounded-full bg-(--color-accent) px-4 py-1.5 text-xs font-medium text-(--color-bg) transition hover:bg-(--color-accent-strong) disabled:opacity-50"
        >
          {running && <Loader2 className="h-3 w-3 animate-spin" />}
          {running ? "만드는 중" : "실행"}
        </button>
      </div>
          </div>
        </>
      )}
    </div>
  );
}
