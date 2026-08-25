"use client";

import { FileText, MessageSquare, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { citationLine, coverUrl, paperUrl, type PaperDTO, type PaperMark, type ReadState } from "@/lib/types";
import { cn } from "@/lib/utils";

import { MarkPicker, ReadStateButton } from "./paper-mark";

/**
 * 논문 한 줄. **표현만 한다** — 상태는 Library 가 들고 있다.
 *
 * MailBento 의 메일 줄과 같은 짜임이다. 오른쪽 끝의 조작 단추들은 흐름에서
 * 빼 두는데, 그대로 두면 아이콘 키가 글자보다 커서 줄 높이를 끌어올리고
 * 목록이 통째로 성겨진다. 대신 오른쪽에 그만큼(=아이콘 세 개 폭) 여백을
 * 비워 글자가 단추 밑으로 들어가지 않게 한다.
 */

export interface PaperRowActions {
  onMark: (paper: PaperDTO, mark: PaperMark | null) => void;
  onReadState: (paper: PaperDTO, state: ReadState) => void;
  onEdit: (paper: PaperDTO) => void;
  onDelete: (paper: PaperDTO) => void;
}

/**
 * 표지.
 *
 * PDF 원본은 `<img>` 에 물리지 못한다. 그래서 표지는 브라우저가 첫 쪽을 그려
 * 올려 둔 것이 있을 때만 뜬다(`coverUrl` 이 그 판단을 안다). 없으면 아이콘.
 *
 * 손잡이 props 를 주면 이 표지가 곧 순서 손잡이가 된다 — MemoBento 와 같은
 * 생각이다. 끌기 전용 손잡이를 따로 두면 좁은 카드에서 본문 폭을 먹고,
 * 호버로만 드러나면 있는 줄도 모른다. 표지는 늘 보이고 늘 같은 자리에 있다.
 */
function Cover({
  paper,
  handleProps,
}: {
  paper: PaperDTO;
  handleProps?: React.HTMLAttributes<HTMLElement>;
}) {
  const src = paper.file ? coverUrl(paper.file) : null;
  const grab = handleProps
    ? {
        ...handleProps,
        role: "button" as const,
        "aria-label": "끌어서 순서 바꾸기",
        title: "끌어서 순서 바꾸기",
      }
    : {};

  return (
    <div
      {...grab}
      className={cn(
        // 종이 비율(√2). 논문 표지는 가로가 아니라 세로로 길다.
        //
        // `relative z-10` 이 있어야 한다. 아래 제목 링크가 `after:inset-0` 으로
        // 줄 전체를 덮는데, 그 가짜 요소가 자리를 잡은 요소라 그냥 두면 표지
        // 위에 얹힌다 — 끌리지 않고 논문이 열려 버린다.
        "thumb-checker relative z-10 grid h-[52px] w-[37px] shrink-0 place-items-center overflow-hidden rounded-md bg-(--color-bg-2) ring-1 ring-(--color-border-soft)",
        handleProps && "cursor-grab touch-none active:cursor-grabbing",
      )}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          loading="lazy"
          // 이미지는 기본으로 끌리므로 브라우저의 이미지 드래그가 먼저 걸린다.
          // 끌기는 감싼 상자(=손잡이)만 맡는다.
          draggable={false}
          className="h-full w-full object-cover"
        />
      ) : (
        <FileText className="h-4 w-4 text-(--color-fg-4)" />
      )}
    </div>
  );
}

function RowMenu({
  paper,
  actions,
}: {
  paper: PaperDTO;
  actions: PaperRowActions;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="논문 메뉴"
        title="더 보기"
        className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-(--color-fg-4) transition hover:bg-(--color-surface-hi) hover:text-(--color-fg-2)"
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div
          role="menu"
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute top-7 right-0 z-50 w-36 overflow-hidden rounded-xl bg-(--color-surface) py-1 shadow-xl ring-1 ring-(--color-border)"
        >
          <MenuItem
            Icon={Pencil}
            label="서지정보 편집"
            onClick={() => {
              setOpen(false);
              actions.onEdit(paper);
            }}
          />
          <MenuItem
            Icon={Trash2}
            label="휴지통으로"
            danger
            onClick={() => {
              setOpen(false);
              actions.onDelete(paper);
            }}
          />
        </div>
      )}
    </div>
  );
}

function MenuItem({
  Icon,
  label,
  onClick,
  danger,
}: {
  Icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition",
        danger
          ? "text-(--color-danger) hover:bg-(--color-danger)/12"
          : "text-(--color-fg-2) hover:bg-(--color-surface-hi)",
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      {label}
    </button>
  );
}

export function PaperRow({
  paper,
  actions,
  dragHandleProps,
}: {
  paper: PaperDTO;
  actions: PaperRowActions;
  /** dnd-kit 손잡이 props. 없으면 표지가 그냥 표지다. */
  dragHandleProps?: React.HTMLAttributes<HTMLElement>;
}) {
  const cite = citationLine(paper);
  const tags = (paper.tags ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 3);

  return (
    // <li> 가 아니라 <div> 다. 순서 바꾸기 wrapper 가 한 겹 끼어들면
    // <ul> 의 직계 자식이 <li> 가 아니게 되어 표시가 무너진다.
    <div className="group/row relative">
      <div className="flex items-center gap-3 py-2.5 pr-[92px] pl-4 transition hover:bg-(--color-surface-hi)">
        <Cover paper={paper} handleProps={dragHandleProps} />

        {/*
          제목만 링크다. 줄 전체를 링크로 감싸면 안에 단추를 넣을 수 없고
          (링크 안의 버튼은 HTML 이 금지한다), 줄 전체에 onClick 을 걸면
          가운데 클릭으로 새 탭에 여는 길이 사라진다.
          `after:absolute inset-0` 로 링크의 클릭 판정만 줄 전체로 넓힌다 —
          오른쪽 단추들은 그 위에 얹혀 있어 가려지지 않는다.
        */}
        <div className="min-w-0 flex-1">
          <Link
            href={paperUrl(paper.id)}
            className={cn(
              "block truncate text-[13.5px] after:absolute after:inset-0 after:content-['']",
              paper.readState === "unread"
                ? "font-semibold text-(--color-fg)"
                : "text-(--color-fg-2)",
            )}
            title={paper.title}
          >
            {paper.title}
          </Link>

          {cite && (
            <div className="truncate text-[11.5px] text-(--color-fg-3)" title={cite}>
              {cite}
            </div>
          )}

          <div className="mt-0.5 flex items-center gap-2 text-[10.5px] text-(--color-fg-4)">
            {paper.hasSummary && (
              <span className="inline-flex items-center gap-1 text-(--color-accent-strong)" title="요약이 있습니다">
                <FileText className="h-3 w-3" />
                요약
              </span>
            )}
            {paper.noteCount > 0 && (
              <span className="inline-flex items-center gap-1" title={`메모 ${paper.noteCount}개`}>
                <MessageSquare className="h-3 w-3" />
                {paper.noteCount}
              </span>
            )}
            {tags.map((t) => (
              <span
                key={t}
                className="rounded-full bg-(--color-bg-2) px-1.5 py-px ring-1 ring-(--color-border-soft)"
              >
                {t}
              </span>
            ))}
            {!paper.file && (
              <span className="text-(--color-warn)" title="아직 PDF 가 붙어 있지 않습니다">
                PDF 없음
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 조작 단추. 줄 높이를 늘리지 않도록 흐름에서 빼 둔다. */}
      <div className="absolute top-1/2 right-4 z-10 flex -translate-y-1/2 items-center gap-0.5">
        <ReadStateButton
          state={paper.readState}
          onChange={(s) => actions.onReadState(paper, s)}
        />
        <MarkPicker
          current={paper.mark}
          onPick={(m) => actions.onMark(paper, m)}
          // 값이 있으면 늘 보이고, 없으면 호버 때만. 안 쓰는 사람의 목록이
          // 태그 아이콘으로 뒤덮이지 않게.
          className={cn(
            "transition",
            paper.mark
              ? "opacity-100"
              : "opacity-0 group-hover/row:opacity-100 focus-within:opacity-100",
          )}
        />
        <RowMenu paper={paper} actions={actions} />
      </div>
    </div>
  );
}
