"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import type { GroupDTO } from "@/lib/types";

import { GroupCard, type GroupHandlers } from "./group-card";
import type { PaperRowActions } from "./paper-row";

/** 순서를 바꿀 수 있는 서가 카드. 손잡이는 머리말이다. */
export function SortableGroupCard({
  group,
  handlers,
  paperActions,
}: {
  group: GroupDTO;
  handlers: GroupHandlers;
  paperActions: PaperRowActions;
}) {
  // Inbox 같은 시스템 서가는 늘 맨 앞이라 집어 올릴 수 없다 (서버도 거절한다).
  const locked = group.systemKey !== null;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: group.id, disabled: locked });

  // role / tabIndex 는 넘기지 않는다. 손잡이가 머리말이라, 단추와 링크를 품은
  // <header> 에 role="button" 을 씌우면 그 안의 것들이 보조기술에서 묻힌다.
  const { role: _role, tabIndex: _tabIndex, ...dragAria } = attributes;

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        zIndex: isDragging ? 50 : undefined,
      }}
    >
      <GroupCard
        group={group}
        handlers={handlers}
        paperActions={paperActions}
        headerDragProps={
          locked
            ? undefined
            : ({ ...dragAria, ...listeners } as unknown as React.HTMLAttributes<HTMLElement>)
        }
      />
    </div>
  );
}
