"use client";

import { Loader2, Quote } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { ITEM_COLORS } from "@/lib/db/schema";
import type { Anchor, ItemColor, NoteDTO } from "@/lib/types";
import { cn } from "@/lib/utils";

import { NOTE_COLOR_LABEL, NOTE_COLOR_VAR, noteTint } from "./note-layer";

/**
 * 메모를 적는 작은 상자. 글자를 고르면 그 자리 옆에 뜬다.
 *
 * 본문은 **순수 글자다.** `RichText` 를 쓰지 않는다 — 메모는 여백에 적는 한
 * 줄이지 문서가 아니다. 마크다운으로 그리기 시작하면 `*` 하나 때문에 적은
 * 그대로 안 보이는 일이 생기고, 그건 여백 메모에서 가장 짜증나는 사고다.
 * 서식이 필요한 글은 요약에 적을 일이다.
 *
 * 자리는 `position: fixed` 로 화면 좌표에 둔다. 고른 글자를 따라다녀야 하는데,
 * PDF 쪽 안에 넣으면 굴릴 때 상자가 함께 사라지고 배율이 바뀌면 글씨까지
 * 커진다. 상자는 화면의 물건이지 종이의 물건이 아니다.
 *
 * 저장은 부모가 한다. 여기는 무엇을 적었는지만 돌려준다 — 목록·오버레이가
 * 같은 응답으로 함께 갱신되어야 해서 서버를 부르는 자리를 한 곳에 모았다.
 */

export interface NoteEditorTarget {
  /** 고칠 메모. 없으면 새로 적는 것이다. */
  note?: NoteDTO;
  /** 붙을 자리. 새로 적을 때는 방금 고른 글자에서 온다. */
  anchor: Anchor;
  /** 상자가 뜰 화면 좌표(client). 고른 글자의 아래 끝 언저리면 된다. */
  at: { x: number; y: number };
}

const WIDTH = 320;
const GAP = 10;

export function NoteEditor({
  target,
  saving,
  onSave,
  onCancel,
}: {
  /** null 이면 안 뜬다. */
  target: NoteEditorTarget | null;
  saving?: boolean;
  onSave: (body: string, color: ItemColor | null) => void;
  onCancel: () => void;
}) {
  if (!target) return null;
  /*
   * 같은 상자를 자리만 옮겨 재사용하면 앞 메모에 적던 글이 남는다. key 로
   * 갈아 끼워 매번 새 상자로 만든다 — 지운 줄 알았던 글이 남는 것보다
   * 다시 마운트하는 값이 싸다.
   */
  return (
    <EditorBox
      key={target.note?.id ?? `new:${target.anchor.page}:${target.anchor.box.join(",")}`}
      target={target}
      saving={saving}
      onSave={onSave}
      onCancel={onCancel}
    />
  );
}

function EditorBox({
  target,
  saving,
  onSave,
  onCancel,
}: {
  target: NoteEditorTarget;
  saving?: boolean;
  onSave: (body: string, color: ItemColor | null) => void;
  onCancel: () => void;
}) {
  const [body, setBody] = useState(target.note?.body ?? "");
  const [color, setColor] = useState<ItemColor | null>(target.note?.color ?? null);
  const [pos, setPos] = useState({ left: target.at.x, top: target.at.y + GAP });
  const boxRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  // 그리기 전에 자리를 잡는다. 화면 밖으로 삐져나가면 위쪽으로 뒤집는다.
  useLayoutEffect(() => {
    const h = boxRef.current?.offsetHeight ?? 200;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.min(Math.max(8, target.at.x - WIDTH / 2), Math.max(8, vw - WIDTH - 8));
    const below = target.at.y + GAP;
    const top = below + h > vh - 8 ? Math.max(8, target.at.y - GAP - h) : below;
    setPos({ left, top });
  }, [target.at.x, target.at.y]);

  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    area.focus();
    // 고치는 중이면 커서를 글 끝에. 앞에 두면 이어 적으려다 앞머리에 끼워 넣는다.
    area.setSelectionRange(area.value.length, area.value.length);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  /*
   * 바깥을 눌러도 **적은 글이 있으면 안 닫는다.**
   *
   * 상자가 PDF 위에 떠 있어서 종이를 짚으려다 스치는 일이 잦다. 그때마다 닫히면
   * 적던 메모가 사라지고, 그건 되돌릴 방법이 없다. 아무것도 안 적었을 때만
   * 조용히 물러난다 — 잘못 드래그해 뜬 상자를 지우려면 그 길이 있어야 한다.
   */
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (boxRef.current?.contains(e.target as Node)) return;
      if (body.trim()) return;
      onCancel();
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [body, onCancel]);

  const quote = target.anchor.quote?.trim();
  const editing = Boolean(target.note);

  return (
    <div
      ref={boxRef}
      style={{ left: pos.left, top: pos.top, width: WIDTH }}
      className="fixed z-[70] flex flex-col gap-2 rounded-[var(--radius-card)] bg-(--color-surface) p-3 shadow-xl ring-1 ring-(--color-border-soft)"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-(--color-fg-4)">
          {target.anchor.page}쪽 · {editing ? "메모 고치기" : "메모 적기"}
        </span>
      </div>

      {quote && (
        <p className="flex gap-1.5 rounded-lg bg-(--color-bg-2) px-2 py-1.5 text-[11px] leading-relaxed break-keep text-(--color-fg-3)">
          <Quote className="mt-0.5 h-2.5 w-2.5 shrink-0 text-(--color-fg-4)" />
          <span className="line-clamp-3 min-w-0 flex-1">{quote}</span>
        </p>
      )}

      <textarea
        ref={areaRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") onSave(body, color);
        }}
        rows={3}
        placeholder="여기 적습니다. 순수 글자로 그대로 남습니다."
        className="scrollbar-thin max-h-56 min-h-[68px] resize-y rounded-lg bg-(--color-bg-2) p-2 text-[12.5px] leading-relaxed text-(--color-fg) ring-1 ring-(--color-border-soft) outline-none placeholder:text-(--color-fg-4) focus:ring-(--color-accent)/60"
      />

      {/* 색 고르기. 칠할 색이자 목록에서 묶어 보는 표식이다. */}
      <div className="flex items-center gap-1">
        <ColorDot
          swatch={noteTint(null, 55)}
          ring="var(--color-accent)"
          label="색 없음"
          picked={color === null}
          onPick={() => setColor(null)}
        />
        <span className="mx-0.5 h-3.5 w-px bg-(--color-border-soft)" />
        {ITEM_COLORS.map((c) => (
          <ColorDot
            key={c}
            swatch={NOTE_COLOR_VAR[c]}
            ring={NOTE_COLOR_VAR[c]}
            label={NOTE_COLOR_LABEL[c]}
            picked={color === c}
            onPick={() => setColor(c)}
          />
        ))}
      </div>

      <div className="flex items-center justify-end gap-2">
        <span className="mr-auto text-[10.5px] text-(--color-fg-4)">Ctrl+Enter 로 저장</span>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full bg-(--color-bg-2) px-3 py-1 text-[11px] text-(--color-fg-3) ring-1 ring-(--color-border-soft) hover:bg-(--color-surface-hi)"
        >
          취소
        </button>
        <button
          type="button"
          onClick={() => onSave(body, color)}
          disabled={saving}
          className="flex items-center gap-1.5 rounded-full bg-(--color-accent) px-3 py-1 text-[11px] font-medium text-(--color-bg) hover:bg-(--color-accent-strong) disabled:opacity-50"
        >
          {saving && <Loader2 className="h-3 w-3 animate-spin" />}
          저장
        </button>
      </div>
    </div>
  );
}

function ColorDot({
  swatch,
  ring,
  label,
  picked,
  onPick,
}: {
  swatch: string;
  ring: string;
  label: string;
  picked: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      title={label}
      aria-label={label}
      aria-pressed={picked}
      style={{ background: swatch, boxShadow: picked ? `0 0 0 2px ${ring}` : undefined }}
      className={cn(
        "h-4 w-4 rounded-full ring-1 ring-black/10 transition-transform hover:scale-110",
        picked && "scale-110",
      )}
    />
  );
}
