"use client";

import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  Loader2,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/lib/client-api";
import {
  DEFAULT_BIBLIO_PROMPT,
  DEFAULT_SUMMARY_PRESETS,
  newPresetId,
  type AppConfigDTO,
  type SummaryPreset,
} from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * 에이전트에게 무엇을 시킬지 — 설정 화면의 지시문 판.
 *
 * ## 카드를 둘로 가른다
 *
 * **요약 프리셋**은 여러 개 중에 고르는 것이고, **서지정보 지시문**은 하나뿐인
 * 것이다. 같은 목록에 섞으면 "그럼 서지정보도 여러 개 두고 고르는 건가" 로
 * 읽힌다. 저장 단추도 각자 하나씩 둔다 — 한쪽을 고치는 중에 다른 쪽을 저장하는
 * 일이 흔한데, 단추가 하나면 아직 적다 만 글까지 함께 서버로 간다.
 *
 * ## 저장은 사람이 누른다
 *
 * 타이핑마다 서버를 부르지 않는다. 지시문은 한 글자씩 고쳐 가며 다듬는 글이라
 * 자동 저장을 걸면 "잠깐 지워 봤다가 되돌리는" 중간 상태가 전부 저장된다.
 * 그 대신 고친 것이 남아 있으면 창을 닫을 때 한 번 묻는다.
 *
 * ## 마지막 하나는 못 지운다
 *
 * 전부 지우면 요약 상자에 고를 것이 없다. 서버도 같은 것을 본다 — 빈 배열이
 * 오면 기본값으로 되돌린다. 여기서 앞문을 막는 것은 "지웠는데 기본값 다섯이
 * 도로 나타나는" 장면을 안 보여 주기 위해서다.
 *
 * ## 되돌리기는 저장 전까지 아무 일도 아니다
 *
 * "기본값으로 되돌리기" 는 화면의 초안만 바꾼다. 서버로는 저장을 눌러야 간다.
 * 그래서 확인 창을 세우지 않았다 — 잘못 눌러도 "고친 것 버리기" 한 번이면
 * 원래대로다.
 */
export function PresetsPanel() {
  /** 서버가 아는 마지막 모습. 고친 것이 있는지는 이것과 견줘서 안다. */
  const [saved, setSaved] = useState<AppConfigDTO | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [presets, setPresets] = useState<SummaryPreset[]>([]);
  const [biblio, setBiblio] = useState("");

  /** 펼쳐 둔 줄. 한 번에 하나만 편다 — 전부 펴면 목록이 아니라 문서가 된다. */
  const [expanded, setExpanded] = useState<string | null>(null);

  const [busy, setBusy] = useState<null | "presets" | "biblio">(null);
  const [flash, setFlash] = useState<null | "presets" | "biblio">(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  /** 화면이 사라진 뒤 늦게 온 답이 상태를 건드리지 않게. */
  const alive = useRef(true);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, []);

  const adopt = useCallback((config: AppConfigDTO, which: "all" | "presets" | "biblio") => {
    setSaved(config);
    // 저장한 쪽만 서버 값으로 갈아 끼운다. 다른 쪽은 아직 적는 중일 수 있다.
    if (which === "all" || which === "presets") setPresets(config.summaryPresets);
    if (which === "all" || which === "biblio") setBiblio(config.biblioPrompt);
  }, []);

  useEffect(() => {
    api
      .getConfig()
      .then((c) => {
        if (alive.current) adopt(c, "all");
      })
      .catch((e: unknown) => {
        if (alive.current) {
          setLoadError(e instanceof Error ? e.message : "설정을 받아 오지 못했습니다");
        }
      });
  }, [adopt]);

  const dirtyPresets =
    saved !== null && JSON.stringify(presets) !== JSON.stringify(saved.summaryPresets);
  const dirtyBiblio = saved !== null && biblio.trim() !== saved.biblioPrompt.trim();

  /*
   * 고친 것을 두고 나가려 할 때 한 번 묻는다.
   *
   * 저장을 사람 손에 맡긴 대가다. 자동 저장이 없으니 탭을 닫는 것만으로 한참
   * 다듬은 지시문이 사라질 수 있고, 그건 되돌릴 방법이 없다.
   */
  useEffect(() => {
    if (!dirtyPresets && !dirtyBiblio) return;
    const onLeave = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirtyPresets, dirtyBiblio]);

  const save = async (which: "presets" | "biblio") => {
    setSaveError(null);
    setBusy(which);
    try {
      /*
       * 고치는 쪽만 실어 보낸다. 서버는 안 실린 칸을 손대지 않는다.
       * 전부 실어 보내면 다른 카드에서 적고 있던 글이 화면의 옛 값으로 덮인다.
       */
      const patch =
        which === "presets"
          ? { summaryPresets: presets }
          : { biblioPrompt: biblio.trim() || DEFAULT_BIBLIO_PROMPT };
      const config = await api.saveConfig(patch);
      if (!alive.current) return;
      // 서버가 세운 것으로 갈아 끼운다 — 새로 붙은 id 가 여기서 들어온다.
      adopt(config, which);
      setFlash(which);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => {
        if (alive.current) setFlash(null);
      }, 2200);
    } catch (e) {
      if (alive.current) {
        setSaveError(e instanceof Error ? e.message : "저장하지 못했습니다");
      }
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  // ── 목록 손질 ────────────────────────────────────────────
  const patchPreset = (id: string, patch: Partial<SummaryPreset>) =>
    setPresets((list) => list.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const addPreset = () => {
    const one: SummaryPreset = { id: newPresetId(), name: "새 지시문", prompt: "" };
    setPresets((list) => [...list, one]);
    // 더하자마자 펼친다. 접힌 채로 두면 빈 줄 하나가 생겼을 뿐이다.
    setExpanded(one.id);
  };

  const removePreset = (id: string) =>
    setPresets((list) => (list.length <= 1 ? list : list.filter((p) => p.id !== id)));

  const movePreset = (id: string, delta: -1 | 1) =>
    setPresets((list) => {
      const i = list.findIndex((p) => p.id === id);
      const j = i + delta;
      if (i === -1 || j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const lonely = presets.length <= 1;

  if (loadError) {
    return (
      <Card title="에이전트 지시문">
        <ErrorLine text={loadError} />
      </Card>
    );
  }

  if (saved === null) {
    return (
      <Card title="에이전트 지시문">
        <p className="flex items-center gap-2 py-2 text-[11px] text-(--color-fg-4)">
          <Loader2 className="h-3 w-3 animate-spin" />
          지시문을 불러오는 중
        </p>
      </Card>
    );
  }

  return (
    <>
      {/* ── 요약 지시문 프리셋 ─────────────────────────── */}
      <Card
        title="요약 지시문"
        icon={<Sparkles className="h-4 w-4 text-(--color-fg-3)" />}
        desc="논문 화면의 “에이전트에게 맡기기” 에서 고르는 목록입니다. 이름은 목록에 보이는 한 줄이고, 지시문이 실제로 에이전트에게 갑니다."
      >
        <ul className="flex flex-col gap-1.5">
          {presets.map((p, i) => {
            const open = expanded === p.id;
            return (
              <li
                key={p.id}
                className="rounded-lg bg-(--color-bg-2) ring-1 ring-(--color-border-soft)"
              >
                <div className="flex items-center gap-1 px-1.5 py-1.5">
                  <button
                    type="button"
                    onClick={() => setExpanded(open ? null : p.id)}
                    aria-expanded={open}
                    aria-label={`${p.name || "이름 없는 지시문"} 지시문 ${open ? "접기" : "펼치기"}`}
                    className="shrink-0 rounded p-1 text-(--color-fg-4) transition hover:text-(--color-fg-2)"
                  >
                    <ChevronRight
                      className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-90")}
                    />
                  </button>

                  <input
                    value={p.name}
                    onChange={(e) => patchPreset(p.id, { name: e.target.value })}
                    maxLength={120}
                    placeholder="이름 없는 지시문"
                    aria-label="지시문 이름"
                    className="min-w-0 flex-1 rounded bg-transparent px-1 py-1 text-[13px] text-(--color-fg) outline-none focus:bg-(--color-surface) focus:ring-1 focus:ring-(--color-accent)/50"
                  />

                  <div className="flex shrink-0 items-center gap-0.5">
                    <IconButton label="위로" disabled={i === 0} onClick={() => movePreset(p.id, -1)}>
                      <ArrowUp className="h-3.5 w-3.5" />
                    </IconButton>
                    <IconButton
                      label="아래로"
                      disabled={i === presets.length - 1}
                      onClick={() => movePreset(p.id, 1)}
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </IconButton>
                    <IconButton
                      label="지우기"
                      danger
                      disabled={lonely}
                      title={lonely ? "마지막 하나는 지울 수 없습니다" : undefined}
                      onClick={() => removePreset(p.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconButton>
                  </div>
                </div>

                {open ? (
                  <div className="px-2.5 pb-2.5">
                    <textarea
                      value={p.prompt}
                      onChange={(e) => patchPreset(p.id, { prompt: e.target.value })}
                      rows={7}
                      maxLength={4000}
                      aria-label="지시문 전문"
                      className="scrollbar-thin w-full resize-y rounded-md bg-(--color-surface) p-2.5 text-[11.5px] leading-relaxed text-(--color-fg) ring-1 ring-(--color-border-soft) outline-none focus:ring-(--color-accent)/60"
                    />
                    {p.prompt.trim().length === 0 && (
                      <p className="mt-1 text-[10.5px] break-keep text-(--color-fg-4)">
                        지시문이 비어 있으면 요약 상자에서 <b>실행</b>이 눌리지 않습니다.
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="truncate px-2.5 pb-2 pl-8 text-[11px] text-(--color-fg-4)">
                    {p.prompt.replace(/\s+/g, " ").trim() || "지시문이 비어 있습니다"}
                  </p>
                )}
              </li>
            );
          })}
        </ul>

        {lonely && (
          <p className="mt-2 text-[11px] break-keep text-(--color-fg-4)">
            <b>하나는 남겨야 합니다.</b> 전부 지우면 요약 상자에 고를 것이 없어 매번
            지시문을 손으로 적어야 합니다. 마음에 안 드는 것은 지우지 말고 고쳐 쓰세요.
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={addPreset}
            disabled={presets.length >= 50}
            className="flex items-center gap-1.5 rounded-full bg-(--color-bg-2) px-3 py-1.5 text-[11px] text-(--color-fg-2) ring-1 ring-(--color-border-soft) transition hover:bg-(--color-surface-hi) disabled:opacity-40"
          >
            <Plus className="h-3 w-3" />
            지시문 더하기
          </button>
          <button
            type="button"
            onClick={() => {
              setPresets(DEFAULT_SUMMARY_PRESETS.map((p) => ({ ...p })));
              setExpanded(null);
            }}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] text-(--color-fg-4) transition hover:text-(--color-fg-2)"
          >
            <RotateCcw className="h-3 w-3" />
            기본값으로 되돌리기
          </button>

          <SaveBar
            dirty={dirtyPresets}
            busy={busy === "presets"}
            flash={flash === "presets"}
            onDiscard={() => {
              setPresets(saved.summaryPresets);
              setExpanded(null);
            }}
            onSave={() => void save("presets")}
          />
        </div>

        {saveError && busy === null && <ErrorLine text={saveError} className="mt-3" />}
      </Card>

      {/* ── 서지정보 제안 지시문 ───────────────────────── */}
      <Card
        title="서지정보 지시문"
        desc="등록 시트에서 “에이전트가 서지정보를 채우기” 를 켰을 때 쓰는 글입니다. 요약과 달리 하나뿐입니다 — 찾아올 칸이 정해져 있어 매번 다르게 시킬 일이 없습니다."
      >
        <textarea
          value={biblio}
          onChange={(e) => setBiblio(e.target.value)}
          rows={6}
          maxLength={4000}
          aria-label="서지정보 지시문"
          className="scrollbar-thin w-full resize-y rounded-md bg-(--color-bg-2) p-3 text-[11.5px] leading-relaxed text-(--color-fg) ring-1 ring-(--color-border-soft) outline-none focus:ring-(--color-accent)/60"
        />

        <p className="mt-2 text-[11px] break-keep text-(--color-fg-4)">
          여기 적는 것은 <b>무엇을 찾아 달라고 할지</b>뿐입니다. 답의 형식과 울타리
          규칙(도구 없이, 아는 칸만 받아 적기)은 코드에 박혀 있어 이 칸으로 바뀌지
          않습니다. 받아 온 값은 언제나 <b>제안</b>으로 앉고, 논문이 바뀌는 것은
          “적용” 을 누른 그 한 번뿐입니다.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setBiblio(DEFAULT_BIBLIO_PROMPT)}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] text-(--color-fg-4) transition hover:text-(--color-fg-2)"
          >
            <RotateCcw className="h-3 w-3" />
            기본값으로 되돌리기
          </button>

          <SaveBar
            dirty={dirtyBiblio}
            busy={busy === "biblio"}
            flash={flash === "biblio"}
            onDiscard={() => setBiblio(saved.biblioPrompt)}
            onSave={() => void save("biblio")}
          />
        </div>
      </Card>
    </>
  );
}

/** 설정 화면의 다른 카드와 같은 테두리. 이 파일에서만 쓴다. */
function Card({
  title,
  icon,
  desc,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[var(--radius-card)] bg-(--color-surface) p-6 ring-1 ring-(--color-border-soft)">
      <div className="mb-1 flex items-center gap-2 text-base font-medium text-(--color-fg)">
        {icon}
        {title}
      </div>
      {desc && <p className="mb-4 text-xs break-keep text-(--color-fg-4)">{desc}</p>}
      {children}
    </section>
  );
}

function ErrorLine({ text, className }: { text: string; className?: string }) {
  return (
    <p
      className={cn(
        "flex items-start gap-1.5 rounded-md bg-(--color-danger)/10 px-3 py-2 text-[11px] break-keep text-(--color-danger) ring-1 ring-(--color-danger)/30",
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
      <span className="min-w-0">{text}</span>
    </p>
  );
}

function IconButton({
  label,
  title,
  danger,
  disabled,
  onClick,
  children,
}: {
  label: string;
  title?: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title ?? label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded p-1.5 text-(--color-fg-4) transition disabled:opacity-30",
        danger
          ? "hover:bg-(--color-danger)/15 hover:text-(--color-danger) disabled:hover:bg-transparent disabled:hover:text-(--color-fg-4)"
          : "hover:bg-(--color-surface-hi) hover:text-(--color-fg-2)",
      )}
    >
      {children}
    </button>
  );
}

/**
 * 저장 줄.
 *
 * 고친 것이 없으면 단추가 꺼져 있다 — 눌러도 아무 일이 없는 단추가 켜져 있으면
 * "저장했는데 왜 그대로지" 를 만든다. 저장 직후 잠깐 뜨는 확인 글은 그 반대쪽
 * 사고를 막는다: 꺼진 단추만 보면 눌린 건지 아닌지 알 수 없다.
 */
function SaveBar({
  dirty,
  busy,
  flash,
  onDiscard,
  onSave,
}: {
  dirty: boolean;
  busy: boolean;
  flash: boolean;
  onDiscard: () => void;
  onSave: () => void;
}) {
  return (
    <div className="ml-auto flex items-center gap-2">
      {flash && !dirty && (
        <span className="flex items-center gap-1 text-[11px] text-(--color-fg-4)">
          <Check className="h-3 w-3" />
          저장했습니다
        </span>
      )}
      {dirty && (
        <button
          type="button"
          onClick={onDiscard}
          disabled={busy}
          className="text-[11px] text-(--color-fg-4) transition hover:text-(--color-fg-2) disabled:opacity-40"
        >
          고친 것 버리기
        </button>
      )}
      <button
        type="button"
        onClick={onSave}
        disabled={!dirty || busy}
        className="flex items-center gap-1.5 rounded-full bg-(--color-accent) px-4 py-1.5 text-xs font-medium text-(--color-bg) transition hover:bg-(--color-accent-strong) disabled:opacity-40"
      >
        {busy && <Loader2 className="h-3 w-3 animate-spin" />}
        {busy ? "저장 중" : "저장"}
      </button>
    </div>
  );
}
