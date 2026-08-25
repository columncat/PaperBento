"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import type { PaperDTO } from "@/lib/types";

import { PaperRow, type PaperRowActions } from "./paper-row";

/**
 * 순서를 바꿀 수 있는 논문 줄.
 *
 * 손잡이는 표지에만 붙는다. 줄 전체에 붙이면 제목 링크를 누를 수도, 목록을
 * 손가락으로 굴릴 수도 없다 — MailBento 의 카드 머리말과 같은 이유다.
 */
export function SortablePaperRow({
  paper,
  actions,
}: {
  paper: PaperDTO;
  actions: PaperRowActions;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: paper.id });

  // role / tabIndex 는 넘기지 않는다. 손잡이가 표지라, 링크와 단추를 품은
  // 줄 안에서 그림 하나가 버튼 행세를 하면 보조기술에서 순서가 뒤엉킨다.
  const { role: _role, tabIndex: _tabIndex, ...dragAria } = attributes;

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        zIndex: isDragging ? 40 : undefined,
      }}
    >
      <PaperRow
        paper={paper}
        actions={actions}
        dragHandleProps={
          { ...dragAria, ...listeners } as unknown as React.HTMLAttributes<HTMLElement>
        }
      />
    </div>
  );
}
