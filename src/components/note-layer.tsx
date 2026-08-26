"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import type { Anchor, ItemColor, NoteDTO } from "@/lib/types";

/**
 * PDF 쪽 위에 메모를 칠하는 층.
 *
 * 칠하는 자리는 pdf.js 가 만든 `.page` div **안**이다. 우리 트리 안에 절대위치
 * 상자를 따로 띄워 쪽을 덮는 길도 있지만, 그러면 배율이 바뀌거나 쪽이 다시
 * 배치될 때마다 그 상자의 좌표를 우리가 따라 계산해야 하고 한 프레임씩 어긋나
 * 메모가 떠다닌다. 쪽 안에 넣으면 쪽이 움직일 때 메모도 함께 움직인다.
 * 우리 트리 밖의 DOM 에 그리는 것이므로 React portal 을 쓴다.
 *
 * **꽂아 둔 것은 오래 살아남지 못한다.** pdf.js 는 쪽을 다시 그릴 때 `.page`
 * 의 자식을 통째로 갈아치운다 — 배율 변경, 창 크기 변경, 화면 밖으로 나갔다
 * 돌아온 쪽에서 모두 일어난다. 그때 우리 오버레이도 함께 지워지므로
 * `pagerendered` 를 받을 때마다 **다시 꽂아야 한다.** 한 번 꽂고 끝냈다가는
 * "메모가 가끔 안 보인다" 가 된다. `useRenderedPages` 가 그 수명주기를 들고
 * 있고, 뷰어는 `onPageRendered` 만 불러 주면 된다.
 *
 * 좌표는 `Anchor` 의 비율(0~1)이고 기준은 `.page` 다 — 캔버스가 아니다.
 * 캔버스는 다시 그리는 동안 CSS 로 늘려 두는 구간이 있어 그때 어긋난다.
 * 비율을 퍼센트로 그대로 바꿔 쓰므로 배율이 바뀌어도 우리가 다시 계산할 것이 없다.
 *
 * 칠한 상자는 **글자 선택을 막지 않는다.** 칠한 위에서 드래그해 새 메모를 다는
 * 것이 흔한 동작이라, 상자는 `pointer-events: none` 으로 두고 누를 수 있는 것은
 * 가장자리의 작은 손잡이 하나뿐이다.
 */

// ─────────────────────────────────────────────────────────────
//   색
// ─────────────────────────────────────────────────────────────

/*
 * 메모 색은 서가·칸과 **같은 `ITEM_COLORS`** 를 쓴다. 앱 안에서 "빨강" 이
 * 자리마다 다른 빨강이면 색으로 묶어 보는 일이 성립하지 않는다.
 */
export const NOTE_COLOR_VAR: Record<ItemColor, string> = {
  red: "var(--color-tag-red)",
  orange: "var(--color-tag-orange)",
  amber: "var(--color-tag-amber)",
  green: "var(--color-tag-green)",
  teal: "var(--color-tag-teal)",
  blue: "var(--color-tag-blue)",
  violet: "var(--color-tag-violet)",
  pink: "var(--color-tag-pink)",
};

export const NOTE_COLOR_LABEL: Record<ItemColor, string> = {
  red: "빨강",
  orange: "주황",
  amber: "노랑",
  green: "초록",
  teal: "청록",
  blue: "파랑",
  violet: "보라",
  pink: "분홍",
};

/**
 * 메모의 바탕색. 색을 안 고르면 테마 강조색이 대신한다.
 *
 * 형광펜의 노랑 자리인데 고정된 노랑을 박지 않는다 — 테마마다 종이색과 글자색이
 * 달라 어떤 테마에서는 노랑이 그냥 묻힌다. 강조색이면 어느 테마에서든 같은
 * 정도로 뜬다. `amber` 를 기본으로 삼지 않은 이유도 있다: 사람이 고른 노랑과
 * "색 안 고름" 이 화면에서 구별되지 않게 된다.
 */
export function noteInk(color: ItemColor | null | undefined): string {
  return color ? NOTE_COLOR_VAR[color] : "var(--color-accent)";
}

/** 종이 위에 얹을 옅은 색. 글자가 비쳐야 하므로 늘 섞어서 쓴다. */
export function noteTint(color: ItemColor | null | undefined, percent: number): string {
  return `color-mix(in oklab, ${noteInk(color)} ${percent}%, transparent)`;
}

// ─────────────────────────────────────────────────────────────
//   그려진 쪽 붙들기
// ─────────────────────────────────────────────────────────────

export interface RenderedPage {
  pageNumber: number;
  /** pdf.js 의 `.page` div. 비율 좌표의 기준이다 — 캔버스가 아니다. */
  el: HTMLElement;
  /**
   * 다시 그려질 때마다 올라간다.
   *
   * `el` 은 그대로인 채 **자식만** 갈아치워지는 것이 보통이라, DOM 노드를 비교해
   * 서는 다시 그린 것을 알아챌 수 없다. 이 숫자가 오버레이를 새로 꽂는 신호다.
   */
  renderKey: number;
}

/**
 * 뷰어가 그려 놓은 쪽들을 들고 있는다.
 *
 * 뷰어(`pdf-view.tsx`)는 `pagerendered` 를 받을 때마다 `onPageRendered` 를
 * 부르기만 하면 된다. 언제 다시 꽂을지는 여기서 정한다 — 그 판단이 뷰어와
 * 오버레이 두 곳에 나뉘어 있으면 한쪽만 고치는 날이 온다.
 */
export function useRenderedPages() {
  const [pages, setPages] = useState<RenderedPage[]>([]);

  const onPageRendered = useCallback((pageNumber: number, el: HTMLElement) => {
    setPages((prev) => {
      const i = prev.findIndex((p) => p.pageNumber === pageNumber);
      if (i === -1) {
        return [...prev, { pageNumber, el, renderKey: 1 }].sort(
          (a, b) => a.pageNumber - b.pageNumber,
        );
      }
      const next = prev.slice();
      next[i] = { pageNumber, el, renderKey: prev[i].renderKey + 1 };
      return next;
    });
  }, []);

  /** 문서를 갈아 끼울 때. 앞 문서의 쪽 div 를 붙들고 있으면 portal 이 허공에 그린다. */
  const resetPages = useCallback(() => setPages([]), []);

  return { pages, onPageRendered, resetPages };
}

// ─────────────────────────────────────────────────────────────
//   층
// ─────────────────────────────────────────────────────────────

export function NoteLayer({
  pages,
  notes,
  activeId,
  onPick,
  pending,
}: {
  /** `useRenderedPages()` 가 주는 것. */
  pages: RenderedPage[];
  notes: NoteDTO[];
  /** 목록이나 손잡이에서 고른 메모. 진하게 칠한다. */
  activeId?: string | null;
  /** 손잡이를 눌렀을 때. 목록에서 그 메모를 강조하라는 뜻이다. */
  onPick?: (id: string) => void;
  /**
   * 아직 저장하지 않은 자리.
   *
   * 적는 상자가 떠 있는 동안 어디에 붙는지 보여 준다. 이게 없으면 상자에 글을
   * 적는 사이 브라우저의 글자 선택이 풀려(상자를 누르는 순간이다) 어디를 짚었는지
   * 화면에서 사라진다.
   */
  pending?: Anchor | null;
}) {
  const byPage = useMemo(() => {
    const m = new Map<number, NoteDTO[]>();
    for (const n of notes) {
      const list = m.get(n.anchor.page);
      if (list) list.push(n);
      else m.set(n.anchor.page, [n]);
    }
    return m;
  }, [notes]);

  return (
    <>
      {pages.map((page) => (
        /*
         * key 에 `renderKey` 를 넣는 것이 핵심이다. 쪽을 다시 그리면 key 가
         * 달라져 이 조각이 통째로 새로 마운트되고, 그 과정에서 오버레이가
         * 새 자식들 위에 다시 꽂힌다.
         */
        <PageOverlay
          key={`${page.pageNumber}:${page.renderKey}`}
          page={page}
          notes={byPage.get(page.pageNumber) ?? []}
          activeId={activeId ?? null}
          onPick={onPick}
          pending={pending && pending.page === page.pageNumber ? pending : null}
        />
      ))}
    </>
  );
}

function PageOverlay({
  page,
  notes,
  activeId,
  onPick,
  pending,
}: {
  page: RenderedPage;
  notes: NoteDTO[];
  activeId: string | null;
  onPick?: (id: string) => void;
  pending: Anchor | null;
}) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    /*
     * 꽂을 그릇을 직접 만든다. pdf.js 가 만든 자식(캔버스·글자층) 중 하나에
     * 얹으면 그쪽이 사라질 때 함께 사라지고, 무엇보다 캔버스는 다시 그리는
     * 동안 CSS 로 늘어나 있어 그 안의 퍼센트 좌표가 어긋난다.
     */
    const el = document.createElement("div");
    el.dataset.paperNoteLayer = String(page.pageNumber);
    // 칠한 것이 글자 선택을 먹지 않도록. 누를 수 있는 것은 손잡이뿐이다.
    el.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:4;";
    page.el.appendChild(el);
    setHost(el);

    // StrictMode 의 이중 마운트에서도 그릇이 둘 남지 않게 반드시 걷어낸다.
    return () => {
      el.remove();
      setHost(null);
    };
  }, [page.el, page.renderKey, page.pageNumber]);

  if (!host) return null;

  return createPortal(
    <>
      {notes.map((n) => (
        <NoteMark key={n.id} note={n} active={n.id === activeId} onPick={onPick} />
      ))}
      {pending && <PendingMark anchor={pending} />}
    </>,
    host,
  );
}

/** 메모 하나. 칠한 조각들과 누를 수 있는 손잡이. */
function NoteMark({
  note,
  active,
  onPick,
}: {
  note: NoteDTO;
  active: boolean;
  onPick?: (id: string) => void;
}) {
  const ink = noteInk(note.color);
  const [bx, by, bw] = note.anchor.box;
  const label = note.body.trim() || "(빈 메모)";

  return (
    <>
      {note.anchor.rects.map(([x, y, w, h], i) => (
        <div
          key={i}
          aria-hidden
          className="absolute rounded-[2px] transition-[background-color,box-shadow] duration-150"
          style={{
            left: `${x * 100}%`,
            top: `${y * 100}%`,
            width: `${w * 100}%`,
            height: `${h * 100}%`,
            // 진하게 칠하면 밑의 글자를 못 읽는다. 고른 것만 조금 더 진하다.
            backgroundColor: noteTint(note.color, active ? 42 : 24),
            boxShadow: active ? `0 0 0 1.5px ${ink}` : undefined,
          }}
        />
      ))}

      {/*
        손잡이. 여기만 `pointer-events: auto` 다.
        칠한 상자에 클릭을 붙이면 그 위에서 드래그로 새 글자를 고를 수 없다 —
        메모를 단 문장에 또 메모를 다는 일은 드물지 않다. 그래서 누르는 자리를
        글자 바깥의 14px 짜리 점 하나로 몰아 둔다.
      */}
      <button
        type="button"
        onClick={() => onPick?.(note.id)}
        title={label}
        aria-label={`${note.page}쪽 메모: ${label}`}
        className="absolute grid h-3.5 w-3.5 cursor-pointer place-items-center rounded-full text-[8px] leading-none font-bold ring-1 ring-black/10 transition-transform"
        style={{
          left: `${(bx + bw) * 100}%`,
          top: `${by * 100}%`,
          backgroundColor: ink,
          /*
           * 태그색은 밝은 테마에서 어둡고 어두운 테마에서 밝다. `--color-bg` 가
           * 정확히 그 반대로 움직이므로 어느 쪽에서도 대비가 남는다.
           */
          color: "var(--color-bg)",
          pointerEvents: "auto",
          /*
           * 옮기기와 키우기를 한 속성에 함께 적는다. Tailwind 의 translate/scale
           * 유틸과 섞으면 둘 다 `transform` 을 건드려 한쪽이 통째로 날아간다.
           */
          transform: `translate(0.375rem, -50%) scale(${active ? 1.3 : 1})`,
        }}
      >
        ●
      </button>
    </>
  );
}

/** 아직 저장 안 한 자리. 점선으로만 두른다 — 저장한 메모와 헷갈리면 안 된다. */
function PendingMark({ anchor }: { anchor: Anchor }) {
  return (
    <>
      {anchor.rects.map(([x, y, w, h], i) => (
        <div
          key={i}
          aria-hidden
          className="absolute rounded-[2px] border border-dashed"
          style={{
            left: `${x * 100}%`,
            top: `${y * 100}%`,
            width: `${w * 100}%`,
            height: `${h * 100}%`,
            backgroundColor: noteTint(null, 18),
            borderColor: "var(--color-accent)",
          }}
        />
      ))}
    </>
  );
}
