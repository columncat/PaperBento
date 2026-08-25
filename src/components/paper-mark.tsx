"use client";

import {
  AlertCircle,
  BookOpen,
  BookOpenCheck,
  Check,
  Circle,
  Star,
  Tag,
  Triangle,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type ComponentType } from "react";

import { PAPER_MARKS, READ_STATES, type PaperMark, type ReadState } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

/**
 * 표식과 읽기 상태.
 *
 * 표식은 MailBento 의 메일 표식과 **같은 그림·같은 색**이다. 두 앱을 함께
 * 쓰는 사람에게 별표가 다른 뜻이거나 다른 색이면 그것만으로 헷갈린다.
 * 색은 테마 변수를 쓰지 않고 고정값이다 — 표식끼리 서로 구분되는 것이
 * 배경과 어울리는 것보다 중요하고, 테마를 바꿨다고 별표가 초록이 되면 안 된다.
 *
 * 팝오버는 손으로 만든다. 자매 앱은 radix 를 쓰지만, 고르는 것이 여섯 개뿐인
 * 이 자리에 의존성을 하나 더 들이지 않는다.
 */

interface MarkMeta {
  label: string;
  Icon: ComponentType<{ className?: string; style?: CSSProperties }>;
  color: string;
  /** 채워서 그릴지 (별처럼 면이 있는 표식). */
  filled: boolean;
}

export const MARK_META: Record<PaperMark, MarkMeta> = {
  star: { label: "별표", Icon: Star, color: "oklch(0.82 0.16 85)", filled: true },
  circle: { label: "동그라미", Icon: Circle, color: "oklch(0.75 0.15 145)", filled: false },
  triangle: { label: "세모", Icon: Triangle, color: "oklch(0.78 0.16 55)", filled: false },
  cross: { label: "가위표", Icon: X, color: "oklch(0.68 0.20 25)", filled: false },
  exclaim: { label: "느낌표", Icon: AlertCircle, color: "oklch(0.70 0.20 15)", filled: false },
  check: { label: "체크", Icon: Check, color: "oklch(0.75 0.14 235)", filled: false },
};

export function MarkIcon({ mark, className }: { mark: PaperMark; className?: string }) {
  const meta = MARK_META[mark];
  const { Icon } = meta;
  return (
    <Icon
      className={cn("shrink-0", className)}
      style={{ color: meta.color, ...(meta.filled ? { fill: meta.color } : {}) }}
    />
  );
}

/** 표식 고르기. 같은 표식을 다시 누르면 해제된다. */
export function MarkPicker({
  current,
  onPick,
  className,
}: {
  current: PaperMark | null | undefined;
  onPick: (mark: PaperMark | null) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);

  // 바깥을 누르거나 Esc 로 닫는다. 열어 둔 채로 다른 줄을 누르면 팝오버가
  // 남아 어느 논문의 것인지 알 수 없게 된다.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={box} className={cn("relative", className)}>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={current ? `표식: ${MARK_META[current].label}` : "표식 달기"}
        title={current ? MARK_META[current].label : "표식 달기"}
        className={cn(
          "grid h-6 w-6 shrink-0 place-items-center rounded-md transition hover:bg-(--color-surface-hi)",
          current ? "text-(--color-fg-2)" : "text-(--color-fg-4)",
        )}
      >
        {current ? <MarkIcon mark={current} className="h-3.5 w-3.5" /> : <Tag className="h-3.5 w-3.5" />}
      </button>

      {open && (
        <div
          role="menu"
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute top-7 right-0 z-50 flex gap-0.5 rounded-xl bg-(--color-surface) p-1.5 shadow-xl ring-1 ring-(--color-border)"
        >
          {PAPER_MARKS.map((m) => (
            <button
              key={m}
              type="button"
              role="menuitem"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onPick(current === m ? null : m);
                setOpen(false);
              }}
              title={MARK_META[m].label}
              aria-label={MARK_META[m].label}
              className={cn(
                "grid h-7 w-7 place-items-center rounded-lg transition hover:bg-(--color-surface-hi)",
                current === m && "bg-(--color-surface-hi) ring-1 ring-(--color-accent)/50",
              )}
            >
              <MarkIcon mark={m} className="h-4 w-4" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 읽기 상태.
 *
 * 논문은 "읽음/안읽음" 둘로 모자란다 — 서재의 대부분은 읽다 만 것이다.
 * 그래서 셋이고, 눌러서 돌린다. 셋뿐이라 고르는 창을 띄우는 것보다 한 번씩
 * 누르는 편이 빠르다.
 */
export const READ_META: Record<
  ReadState,
  { label: string; Icon: ComponentType<{ className?: string }>; tone: string }
> = {
  unread: { label: "안 읽음", Icon: BookOpen, tone: "text-(--color-fg-4)" },
  reading: { label: "읽는 중", Icon: BookOpen, tone: "text-(--color-warn)" },
  read: { label: "읽음", Icon: BookOpenCheck, tone: "text-(--color-accent-strong)" },
};

export function nextReadState(s: ReadState): ReadState {
  const i = READ_STATES.indexOf(s);
  return READ_STATES[(i + 1) % READ_STATES.length];
}

export function ReadStateButton({
  state,
  onChange,
  className,
}: {
  state: ReadState;
  onChange: (next: ReadState) => void;
  className?: string;
}) {
  const meta = READ_META[state];
  const { Icon } = meta;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onChange(nextReadState(state));
      }}
      title={`읽기 상태: ${meta.label} (눌러서 바꾸기)`}
      aria-label={`읽기 상태: ${meta.label}`}
      className={cn(
        "grid h-6 w-6 shrink-0 place-items-center rounded-md transition hover:bg-(--color-surface-hi)",
        meta.tone,
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}
