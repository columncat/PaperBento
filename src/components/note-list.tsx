"use client";

import { Loader2, Pencil, StickyNote, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import type { NoteDTO } from "@/lib/types";
import { cn } from "@/lib/utils";

import { noteInk, noteTint } from "./note-layer";

/**
 * 오른쪽 칸의 메모 목록.
 *
 * 순서는 서버가 준 그대로 쓴다 — 쪽 순, 쪽 안에서는 위에서 아래. 즉 **읽는
 * 순서**다. 적은 시각 순으로 두면 같은 논문을 며칠에 걸쳐 읽었을 때 목록이
 * 종이 위 자리와 어긋나 아무 데도 못 쓴다.
 *
 * 한 줄은 쪽 번호 · 인용한 글 · 메모 글이다. 인용한 글을 함께 두는 것은,
 * 목록만 보고도 무엇에 대한 말인지 알아야 매번 그 자리로 뛰지 않기 때문이다.
 * 다만 회색 작게 둔다 — 읽을 것은 내가 적은 글이지 남의 문장이 아니다.
 *
 * 지우기는 **되돌릴 수 없다.** 메모는 휴지통에 들어가지 않는다(라우트 주석
 * 참고). 그래서 한 번 묻는데, 브라우저의 `confirm` 이 아니라 그 자리에서
 * 두 번 누르게 한다 — 확인창은 PDF 에서 고른 글자와 스크롤 자리를 흔든다.
 */

export function NoteList({
  notes,
  activeId,
  busyId,
  onSelect,
  onEdit,
  onDelete,
  className,
}: {
  notes: NoteDTO[];
  /** 지금 강조된 메모. 오버레이의 손잡이를 눌러도 여기가 따라 켜진다. */
  activeId: string | null;
  /** 서버를 부르는 중인 메모. 그 줄만 잠근다. */
  busyId?: string | null;
  /** 누르면 그 자리로. 부모가 뷰어의 `scrollToAnchor` 를 부른다. */
  onSelect: (note: NoteDTO) => void;
  onEdit: (note: NoteDTO) => void;
  onDelete: (note: NoteDTO) => void;
  className?: string;
}) {
  if (notes.length === 0) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-2 px-6 py-10 text-center text-(--color-fg-4)",
          className,
        )}
      >
        <StickyNote className="h-6 w-6" />
        <p className="text-xs break-keep">
          아직 메모가 없습니다 — 원문에서 글자를 골라 보세요
        </p>
      </div>
    );
  }

  return (
    <ul className={cn("flex flex-col", className)}>
      {notes.map((note, i) => (
        <NoteRow
          key={note.id}
          note={note}
          active={note.id === activeId}
          busy={note.id === busyId}
          /* 쪽이 바뀌는 자리에만 쪽 머리를 세운다. 매 줄에 다 붙이면 숫자만 남는다. */
          showPage={i === 0 || notes[i - 1].page !== note.page}
          onSelect={onSelect}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </ul>
  );
}

function NoteRow({
  note,
  active,
  busy,
  showPage,
  onSelect,
  onEdit,
  onDelete,
}: {
  note: NoteDTO;
  active: boolean;
  busy: boolean;
  showPage: boolean;
  onSelect: (note: NoteDTO) => void;
  onEdit: (note: NoteDTO) => void;
  onDelete: (note: NoteDTO) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const quote = note.anchor.quote?.trim();
  /** 읽어 주는 이름에 붙일 꼬리표. 본문이 비면 인용문으로 대신한다. */
  const spoken = `${note.page}쪽 ${note.body.trim() || quote || "(빈 메모)"}`.slice(0, 60);

  /*
   * 물어본 채로 두지 않는다. 다른 데를 보다 돌아왔을 때 "확인" 버튼이 그대로
   * 떠 있으면, 무엇을 확인하려던 것인지 잊은 채 누르게 된다.
   */
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 5000);
    return () => clearTimeout(t);
  }, [confirming]);

  return (
    <li>
      {showPage && (
        <p className="px-3 pt-3 pb-1 text-[10.5px] tracking-wider text-(--color-fg-4)">
          {note.page}쪽
        </p>
      )}

      <div
        className={cn(
          "group relative flex gap-2 border-l-2 px-3 py-2 transition-colors",
          active ? "bg-(--color-surface-2)" : "hover:bg-(--color-surface-2)/60",
        )}
        style={{
          borderLeftColor: active ? noteInk(note.color) : noteTint(note.color, 45),
        }}
      >
        {/* 줄 전체가 그 자리로 가는 버튼이다. 고치기·지우기는 그 위에 얹는다. */}
        <button
          type="button"
          onClick={() => onSelect(note)}
          className="min-w-0 flex-1 cursor-pointer text-left"
        >
          {quote && (
            <p className="line-clamp-2 text-[11px] leading-relaxed break-keep text-(--color-fg-4)">
              {quote}
            </p>
          )}
          <p
            className={cn(
              "text-[12.5px] leading-relaxed break-keep whitespace-pre-wrap",
              note.body.trim() ? "text-(--color-fg-2)" : "text-(--color-fg-4) italic",
            )}
          >
            {note.body.trim() || "(빈 메모)"}
          </p>
        </button>

        <div className="flex shrink-0 items-start gap-0.5">
          {busy ? (
            <Loader2 className="mt-0.5 h-3.5 w-3.5 animate-spin text-(--color-fg-4)" />
          ) : confirming ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setConfirming(false);
                  onDelete(note);
                }}
                className="rounded-full bg-(--color-danger)/15 px-2 py-0.5 text-[10.5px] text-(--color-danger) hover:bg-(--color-danger)/25"
              >
                지웁니다
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="rounded-full px-1.5 py-0.5 text-[10.5px] text-(--color-fg-4) hover:text-(--color-fg-2)"
              >
                취소
              </button>
            </>
          ) : (
            <>
              {/*
                손끝에 뜨는 이름은 짧게, 읽어 주는 이름은 어느 메모인지까지.
                줄마다 단추가 둘씩이라 이름이 "고치기" 하나뿐이면 화면을 귀로
                듣는 사람에게는 똑같은 단추가 메모 수만큼 늘어선다.
              */}
              <IconButton label="고치기" spoken={`고치기: ${spoken}`} onClick={() => onEdit(note)}>
                <Pencil className="h-3 w-3" />
              </IconButton>
              <IconButton
                label="지우기"
                spoken={`지우기: ${spoken}`}
                danger
                onClick={() => setConfirming(true)}
              >
                <Trash2 className="h-3 w-3" />
              </IconButton>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

function IconButton({
  label,
  spoken,
  danger,
  onClick,
  children,
}: {
  /** 마우스를 올리면 뜨는 짧은 이름. */
  label: string;
  /** 읽어 주는 이름. 없으면 `label` 을 그대로 쓴다. */
  spoken?: string;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={spoken ?? label}
      className={cn(
        // 손가락으로 쓰는 화면에서는 hover 가 없다 — 늘 보이되 옅게 둔다.
        "grid h-6 w-6 place-items-center rounded-md text-(--color-fg-4) opacity-60 transition hover:bg-(--color-surface-hi) hover:opacity-100 group-hover:opacity-100",
        danger ? "hover:text-(--color-danger)" : "hover:text-(--color-fg)",
      )}
    >
      {children}
    </button>
  );
}
