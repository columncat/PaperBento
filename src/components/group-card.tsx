"use client";

import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  ChevronDown,
  ChevronRight,
  FolderPlus,
  LayoutGrid,
  Library as LibraryIcon,
  List,
  Lock,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { ITEM_COLORS, type ItemColor } from "@/lib/db/schema";
import {
  citationLine,
  countPapers,
  coverUrl,
  paperUrl,
  type GroupDTO,
  type PaperDTO,
  type SubGroupDTO,
  type ViewMode,
} from "@/lib/types";
import { cn } from "@/lib/utils";

import { ExportSection } from "./export-menu";
import type { PaperRowActions } from "./paper-row";
import { SortablePaperRow } from "./sortable-paper-row";
import { UploadButton, UploadDrop } from "./upload-drop";

/**
 * 서가 하나.
 *
 * **재귀가 아니다.** 서가 안의 칸(`SubGroupDTO`)은 여기서 한 단만 그리고,
 * 그 칸을 그리는 것은 이 파일 안의 `SubGroupSection` 이지 `GroupCard` 가
 * 아니다. 타입에도 그 자리가 없다 — `SubGroupDTO` 에는 `children` 이 없으니
 * 3단을 그리려야 그릴 수 없다. 깊이 두 단은 DB·서버·DTO 세 곳에서 지키는
 * 규칙이고, 화면이 그 셋째 겹이다.
 *
 * 카드 순서 손잡이는 `<header>` 에만 붙는다 (MailBento 관례). 카드 전체에
 * 붙이면 본문 글자를 고를 수도, 목록을 손가락으로 굴릴 수도 없다.
 */

export interface GroupHandlers {
  rename: (id: string, name: string) => void;
  setColor: (id: string, color: ItemColor | null) => void;
  setViewMode: (id: string, mode: ViewMode) => void;
  setCollapsed: (id: string, collapsed: boolean) => void;
  remove: (id: string) => void;
  /** 서가 안에 칸 하나 더. 칸 안에서는 부를 수 없다. */
  addSubGroup: (parentId: string) => void;
  /** 칸을 서가로 꺼내기. 3단을 못 만드니 반대 방향은 늘 안전하다. */
  promote: (id: string) => void;
  /** PDF 없이 서지정보만 먼저 적어 두기. */
  addPaper: (groupId: string) => void;
  uploadTo: (groupId: string, files: File[]) => void;
  reorderPapers: (groupId: string, orderedIds: string[]) => void;
  notify: (message: string) => void;
}

const COLOR_VAR: Record<ItemColor, string> = {
  red: "var(--color-tag-red)",
  orange: "var(--color-tag-orange)",
  amber: "var(--color-tag-amber)",
  green: "var(--color-tag-green)",
  teal: "var(--color-tag-teal)",
  blue: "var(--color-tag-blue)",
  violet: "var(--color-tag-violet)",
  pink: "var(--color-tag-pink)",
};

// ─────────────────────────────────────────────────────────────
//   조각들
// ─────────────────────────────────────────────────────────────

function ViewToggle({
  mode,
  onChange,
}: {
  mode: ViewMode;
  onChange: (m: ViewMode) => void;
}) {
  const opts = [
    { m: "list" as const, Icon: List, label: "목록 보기" },
    { m: "grid" as const, Icon: LayoutGrid, label: "표지 보기" },
  ];
  return (
    <div
      role="group"
      aria-label="보기 방식"
      onPointerDown={(e) => e.stopPropagation()}
      className="flex items-center rounded-md bg-(--color-bg-2) p-0.5 ring-1 ring-(--color-border-soft)"
    >
      {opts.map(({ m, Icon, label }) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          aria-pressed={mode === m}
          aria-label={label}
          title={label}
          className={cn(
            "grid h-5 w-6 place-items-center rounded transition",
            mode === m
              ? "bg-(--color-surface-hi) text-(--color-fg)"
              : "text-(--color-fg-4) hover:text-(--color-fg-2)",
          )}
        >
          <Icon className="h-3 w-3" />
        </button>
      ))}
    </div>
  );
}

/** 접기·펴기와 메뉴가 함께 쓰는 작은 팝오버. */
function Menu({
  label,
  children,
}: {
  label: string;
  children: (close: () => void) => React.ReactNode;
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
    <div ref={box} className="relative" onPointerDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        className="grid h-7 w-7 place-items-center rounded-md text-(--color-fg-4) transition hover:bg-(--color-surface-hi) hover:text-(--color-fg-2)"
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute top-8 right-0 z-50 w-52 overflow-hidden rounded-xl bg-(--color-surface) py-1 shadow-xl ring-1 ring-(--color-border)"
        >
          {children(() => setOpen(false))}
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
  disabled,
  hint,
}: {
  Icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      title={hint}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition",
        disabled
          ? "cursor-not-allowed text-(--color-fg-4) opacity-60"
          : danger
            ? "text-(--color-danger) hover:bg-(--color-danger)/12"
            : "text-(--color-fg-2) hover:bg-(--color-surface-hi)",
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      {label}
    </button>
  );
}

function ColorRow({
  current,
  onPick,
}: {
  current: ItemColor | null;
  onPick: (c: ItemColor | null) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1 px-3 py-2">
      <button
        type="button"
        onClick={() => onPick(null)}
        title="색 없음"
        aria-label="색 없음"
        className={cn(
          "h-4 w-4 rounded-full ring-1 ring-(--color-border)",
          current === null && "ring-2 ring-(--color-accent)",
        )}
      />
      {ITEM_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onPick(c)}
          title={c}
          aria-label={c}
          style={{ background: COLOR_VAR[c] }}
          className={cn(
            "h-4 w-4 rounded-full ring-1 ring-black/10",
            current === c && "ring-2 ring-(--color-accent)",
          )}
        />
      ))}
    </div>
  );
}

/** 이름을 그 자리에서 고친다. Esc 로 되돌리고 Enter 로 확정. */
function EditableName({
  name,
  editing,
  onDone,
  onCancel,
  className,
}: {
  name: string;
  editing: boolean;
  onDone: (next: string) => void;
  onCancel: () => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(name);
  useEffect(() => setDraft(name), [name, editing]);

  if (!editing) {
    return (
      <span className={cn("truncate", className)} title={name}>
        {name}
      </span>
    );
  }

  return (
    <input
      value={draft}
      autoFocus
      onPointerDown={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onDone(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onDone(draft);
        }
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      className={cn(
        "min-w-0 flex-1 rounded bg-(--color-bg-2) px-1.5 py-0.5 text-(--color-fg) ring-1 ring-(--color-accent)/50 outline-none",
        className,
      )}
    />
  );
}

// ─────────────────────────────────────────────────────────────
//   논문 목록
// ─────────────────────────────────────────────────────────────

/** 표지 보기의 한 칸. 조작 단추는 두지 않는다 — 좁아서 다 넣으면 표지가 안 보인다. */
function PaperTile({ paper }: { paper: PaperDTO }) {
  const src = paper.file ? coverUrl(paper.file) : null;
  const cite = citationLine(paper);
  return (
    <Link
      href={paperUrl(paper.id)}
      title={paper.title}
      className="group/tile flex flex-col gap-1.5 rounded-lg p-1.5 transition hover:bg-(--color-surface-hi)"
    >
      <div className="thumb-checker grid aspect-[1/1.414] w-full place-items-center overflow-hidden rounded-md bg-(--color-bg-2) ring-1 ring-(--color-border-soft)">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <LibraryIcon className="h-5 w-5 text-(--color-fg-4)" />
        )}
      </div>
      <span
        className={cn(
          "line-clamp-2 text-[11.5px] leading-tight break-keep",
          paper.readState === "unread" ? "text-(--color-fg)" : "text-(--color-fg-3)",
        )}
      >
        {paper.title}
      </span>
      {cite && <span className="truncate text-[10px] text-(--color-fg-4)">{cite}</span>}
    </Link>
  );
}

/**
 * 한 무리의 논문.
 *
 * 순서 바꾸기는 **목록 보기에서만** 된다. 표지 보기에서 끌면 표지 그림 자체가
 * 먼저 끌려 손잡이와 부딪히고, 좁은 칸에서 목표를 맞추기도 어렵다. 순서는
 * 목록에서 잡고 표지는 훑어보는 용도로 나눈다.
 */
function PaperList({
  papers,
  viewMode,
  actions,
}: {
  papers: PaperDTO[];
  viewMode: ViewMode;
  actions: PaperRowActions;
}) {
  if (viewMode === "grid") {
    return (
      <div className="grid grid-cols-3 gap-1 px-2.5 py-2 sm:grid-cols-4">
        {papers.map((p) => (
          <PaperTile key={p.id} paper={p} />
        ))}
      </div>
    );
  }

  return (
    <SortableContext items={papers.map((p) => p.id)} strategy={verticalListSortingStrategy}>
      <div className="divide-y divide-(--color-border-soft)">
        {papers.map((p) => (
          <SortablePaperRow key={p.id} paper={p} actions={actions} />
        ))}
      </div>
    </SortableContext>
  );
}

// ─────────────────────────────────────────────────────────────
//   서가 안의 칸 — 여기서 더 깊어지지 않는다
// ─────────────────────────────────────────────────────────────

function SubGroupSection({
  sub,
  handlers,
  paperActions,
}: {
  sub: SubGroupDTO;
  handlers: GroupHandlers;
  paperActions: PaperRowActions;
}) {
  const [renaming, setRenaming] = useState(false);

  return (
    <section className="border-t border-(--color-border-soft)">
      <header className="flex items-center gap-1.5 bg-(--color-bg-2)/60 px-3 py-1.5">
        <button
          type="button"
          onClick={() => handlers.setCollapsed(sub.id, !sub.collapsed)}
          aria-expanded={!sub.collapsed}
          aria-label={sub.collapsed ? "펴기" : "접기"}
          className="grid h-5 w-5 shrink-0 place-items-center rounded text-(--color-fg-4) hover:text-(--color-fg-2)"
        >
          {sub.collapsed ? (
            <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </button>

        {sub.color && (
          <span
            aria-hidden
            style={{ background: COLOR_VAR[sub.color] }}
            className="h-2 w-2 shrink-0 rounded-full"
          />
        )}

        <EditableName
          name={sub.name}
          editing={renaming}
          onDone={(next) => {
            setRenaming(false);
            if (next.trim() && next.trim() !== sub.name) handlers.rename(sub.id, next.trim());
          }}
          onCancel={() => setRenaming(false)}
          className="text-[12px] font-medium text-(--color-fg-2)"
        />

        <span className="shrink-0 font-mono text-[10px] text-(--color-fg-4)">
          {sub.papers.length}
        </span>

        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <UploadButton
            onFiles={(files) => handlers.uploadTo(sub.id, files)}
            onReject={handlers.notify}
            label={`"${sub.name}" 에 PDF 올리기`}
            className="h-6 w-6"
          />
          <Menu label={`"${sub.name}" 메뉴`}>
            {(close) => (
              <>
                <MenuItem
                  Icon={Pencil}
                  label="이름 바꾸기"
                  onClick={() => {
                    close();
                    setRenaming(true);
                  }}
                />
                <MenuItem
                  Icon={Plus}
                  label="논문 직접 등록"
                  onClick={() => {
                    close();
                    handlers.addPaper(sub.id);
                  }}
                />
                <ColorRow
                  current={sub.color}
                  onPick={(c) => {
                    close();
                    handlers.setColor(sub.id, c);
                  }}
                />
                <MenuItem
                  Icon={FolderPlus}
                  label="서가로 꺼내기"
                  hint="이 칸을 맨 위 단으로 올립니다"
                  onClick={() => {
                    close();
                    handlers.promote(sub.id);
                  }}
                />
                <ExportSection
                  target={{ groupId: sub.id }}
                  title="서지정보 내보내기"
                  onPick={close}
                />
                <div className="mt-1 border-t border-(--color-border-soft) pt-1">
                  <MenuItem
                    Icon={Trash2}
                    label="휴지통으로"
                    danger
                    onClick={() => {
                      close();
                      handlers.remove(sub.id);
                    }}
                  />
                </div>
              </>
            )}
          </Menu>
        </div>
      </header>

      {!sub.collapsed &&
        (sub.papers.length === 0 ? (
          <p className="px-4 py-3 text-[11px] text-(--color-fg-4)">비어 있습니다</p>
        ) : (
          <PaperList papers={sub.papers} viewMode={sub.viewMode} actions={paperActions} />
        ))}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
//   서가
// ─────────────────────────────────────────────────────────────

export function GroupCard({
  group,
  handlers,
  paperActions,
  headerDragProps,
}: {
  group: GroupDTO;
  handlers: GroupHandlers;
  paperActions: PaperRowActions;
  /**
   * 카드 순서 손잡이 props. 머리말에 붙는다 — 카드 전체에 두면 본문 글자를
   * 고를 수도, 목록을 터치로 굴릴 수도 없다 (MailBento 관례).
   */
  headerDragProps?: React.HTMLAttributes<HTMLElement>;
}) {
  const [renaming, setRenaming] = useState(false);
  const locked = group.systemKey !== null;
  const total = countPapers(group);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  /**
   * 논문 순서 바꾸기.
   *
   * 서가 카드끼리의 순서는 바깥 `DndContext` 가 맡고, 여기는 카드 **안**의
   * 줄만 맡는다. 안팎을 한 컨텍스트로 묶으면 카드를 끌 때 줄이 함께 반응해
   * 어느 쪽을 옮기는지 알 수 없어진다.
   *
   * 다른 서가로 **옮기는** 것은 여기서 하지 않는다. 카드 안 목록끼리 끌어
   * 넘기려면 목록마다 놓을 자리를 만들어야 하는데, 서가가 접혀 있거나 화면
   * 밖에 있으면 그 자리가 없다. 옮기기는 편집 시트의 서가 고르기로 한다 —
   * 접힌 서가에도, 화면 밖 서가에도 똑같이 닿는다.
   */
  const onPaperDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;

    const lists: { id: string; papers: PaperDTO[] }[] = [
      { id: group.id, papers: group.papers },
      ...group.children.map((c) => ({ id: c.id, papers: c.papers })),
    ];
    const list = lists.find((l) => l.papers.some((p) => p.id === active.id));
    if (!list) return;
    const from = list.papers.findIndex((p) => p.id === active.id);
    const to = list.papers.findIndex((p) => p.id === over.id);
    // 다른 목록 위에 떨어뜨린 것 — 그건 옮기기고, 위에 적은 이유로 안 받는다.
    if (from < 0 || to < 0) return;
    handlers.reorderPapers(
      list.id,
      arrayMove(list.papers, from, to).map((p) => p.id),
    );
  };

  return (
    <article className="flex h-[560px] flex-col overflow-hidden rounded-[var(--radius-card)] bg-(--color-surface) ring-1 ring-(--color-border-soft) transition">
      {/* 머리말 — 여기를 잡아 서가 순서를 바꾼다 */}
      <header
        {...(headerDragProps ?? {})}
        title={headerDragProps ? "머리말을 끌어 서가 순서 변경" : undefined}
        className={cn(
          "flex shrink-0 items-center gap-2 border-b border-(--color-border-soft) px-4 py-3",
          headerDragProps && "cursor-grab touch-none active:cursor-grabbing",
        )}
      >
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => handlers.setCollapsed(group.id, !group.collapsed)}
          aria-expanded={!group.collapsed}
          aria-label={group.collapsed ? "펴기" : "접기"}
          className="grid h-6 w-6 shrink-0 place-items-center rounded text-(--color-fg-4) hover:text-(--color-fg-2)"
        >
          {group.collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </button>

        <span
          aria-hidden
          style={group.color ? { background: COLOR_VAR[group.color] } : undefined}
          className={cn(
            "h-2.5 w-2.5 shrink-0 rounded-full",
            group.color ? "" : "bg-(--color-border)",
          )}
        />

        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <EditableName
            name={group.name}
            editing={renaming}
            onDone={(next) => {
              setRenaming(false);
              if (next.trim() && next.trim() !== group.name) handlers.rename(group.id, next.trim());
            }}
            onCancel={() => setRenaming(false)}
            className="text-[15px] text-(--color-fg)"
          />
          {locked && (
            <Lock
              className="h-3 w-3 shrink-0 text-(--color-fg-4)"
              aria-label="시스템 서가"
            />
          )}
          <span className="shrink-0 font-mono text-[11px] text-(--color-fg-4)">
            {total}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <ViewToggle mode={group.viewMode} onChange={(m) => handlers.setViewMode(group.id, m)} />
          <UploadButton
            onFiles={(files) => handlers.uploadTo(group.id, files)}
            onReject={handlers.notify}
            label={`"${group.name}" 에 PDF 올리기`}
          />
          <Menu label={`"${group.name}" 메뉴`}>
            {(close) => (
              <>
                <MenuItem
                  Icon={Pencil}
                  label="이름 바꾸기"
                  disabled={locked}
                  hint={locked ? "시스템 서가는 이름을 바꿀 수 없습니다" : undefined}
                  onClick={() => {
                    close();
                    setRenaming(true);
                  }}
                />
                <MenuItem
                  Icon={Plus}
                  label="논문 직접 등록"
                  onClick={() => {
                    close();
                    handlers.addPaper(group.id);
                  }}
                />
                <MenuItem
                  Icon={FolderPlus}
                  label="하위 칸 만들기"
                  onClick={() => {
                    close();
                    handlers.addSubGroup(group.id);
                  }}
                />
                <ColorRow
                  current={group.color}
                  onPick={(c) => {
                    close();
                    handlers.setColor(group.id, c);
                  }}
                />
                {/*
                  이 서가에 든 논문 전부. 라우트의 `?group=` 은 서가에 바로 놓인
                  것과 안의 칸에 든 것을 함께 담으므로, 카드에서 보이는 수(`total`)와
                  나가는 편수가 어긋나지 않는다.

                  비어 있어도 막지 않는다 — 빈 .bib 한 장이 떨어질 뿐이고, 접힌
                  칸까지 세어 가며 단추를 흐리게 하는 쪽이 더 헷갈린다.
                */}
                <ExportSection
                  target={{ groupId: group.id }}
                  title="서지정보 내보내기"
                  hint={
                    group.children.length > 0 ? "안의 칸에 든 논문까지 함께" : undefined
                  }
                  onPick={close}
                />
                <div className="mt-1 border-t border-(--color-border-soft) pt-1">
                  <MenuItem
                    Icon={Trash2}
                    label="휴지통으로"
                    danger
                    disabled={locked}
                    hint={locked ? "시스템 서가는 지울 수 없습니다" : undefined}
                    onClick={() => {
                      close();
                      handlers.remove(group.id);
                    }}
                  />
                </div>
              </>
            )}
          </Menu>
        </div>
      </header>

      {group.collapsed ? (
        <button
          type="button"
          onClick={() => handlers.setCollapsed(group.id, false)}
          className="flex flex-1 items-center justify-center gap-2 text-xs text-(--color-fg-4) transition hover:text-(--color-fg-2)"
        >
          <LibraryIcon className="h-4 w-4" />
          접힘 · 논문 {total}편 · 눌러서 펴기
        </button>
      ) : (
        /*
          받는 자리는 카드 본문 전체이고, 굴러가는 것은 그 안이다.
          둘을 한 요소로 합치면 오버레이(`absolute inset-0`)가 스크롤 내용에
          붙어 함께 굴러가 버린다 — 목록이 길면 "여기에 놓기" 가 화면 밖으로
          사라진다.
        */
        <UploadDrop
          bare
          onFiles={(files) => handlers.uploadTo(group.id, files)}
          onReject={handlers.notify}
          className="flex-1 overflow-hidden"
        >
         <div className="scrollbar-thin h-full overflow-y-auto">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onPaperDragEnd}
          >
            {group.papers.length > 0 && (
              <PaperList
                papers={group.papers}
                viewMode={group.viewMode}
                actions={paperActions}
              />
            )}

            {group.papers.length === 0 && group.children.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center gap-1.5 px-6 text-center text-(--color-fg-4)">
                <LibraryIcon className="h-6 w-6" />
                <span className="text-[11.5px] break-keep">
                  PDF 를 끌어다 놓으면 여기에 꽂힙니다
                </span>
              </div>
            )}

            {group.children.map((sub) => (
              <SubGroupSection
                key={sub.id}
                sub={sub}
                handlers={handlers}
                paperActions={paperActions}
              />
            ))}
          </DndContext>
         </div>
        </UploadDrop>
      )}
    </article>
  );
}

/** 격자 끝의 "서가 추가" 자리. 카드와 같은 크기라 줄이 흐트러지지 않는다. */
export function AddGroupCard({ onCreate }: { onCreate: (name: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  if (!adding) {
    return (
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="flex h-[560px] flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] text-(--color-fg-4) ring-1 ring-(--color-border-soft) ring-dashed transition hover:bg-(--color-surface)/60 hover:text-(--color-fg-2)"
      >
        <Plus className="h-6 w-6" />
        <span className="text-sm">서가 추가</span>
      </button>
    );
  }

  const submit = () => {
    const name = draft.trim();
    setDraft("");
    setAdding(false);
    if (name) onCreate(name);
  };

  return (
    <div className="flex h-[560px] flex-col items-center justify-center gap-3 rounded-[var(--radius-card)] bg-(--color-surface) p-6 ring-1 ring-(--color-accent)/40">
      <input
        autoFocus
        value={draft}
        placeholder="서가 이름"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={submit}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") {
            setDraft("");
            setAdding(false);
          }
        }}
        className="w-full rounded-lg bg-(--color-bg-2) px-3 py-2 text-sm text-(--color-fg) ring-1 ring-(--color-border-soft) outline-none focus:ring-(--color-accent)/60"
      />
      <p className="text-[11px] text-(--color-fg-4)">Enter 로 만들고 Esc 로 취소</p>
    </div>
  );
}
