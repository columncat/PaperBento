"use client";

import { BookMarked, Braces, FileText, Quote } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { EXPORT_FORMATS, bibExportUrl, type ExportFormat } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * 서지정보 내보내기를 고르는 자리 — 논문 하나·서가 하나·서재 전체가 함께 쓴다.
 *
 * 셋이 부르는 주소는 `bibExportUrl()` 하나이고 고를 것은 형식 셋뿐이라, 세
 * 화면에 각각 적어 두면 형식이 하나 늘 때 세 곳을 고쳐야 한다. 한 곳에 두고
 * `EXPORT_FORMATS` 를 그대로 돈다 — csl.ts 에 형식이 늘면 여기 표에 자리가
 * 비어 컴파일이 막힌다.
 *
 * ## 내려받기는 평범한 `<a href>` 다
 *
 * `download` 속성을 붙이지 않는다. MemoBento 에서 겪었다 — 그 속성이 붙으면
 * 브라우저의 다운로드 관리자가 직접 내보내느라 쿠키가 안 실리는 경우가 있고,
 * 무엇보다 서버가 `Content-Disposition` 으로 정해 주는 이름을 속성값이 덮는다.
 * 라우트는 서가 이름을 다듬어 `"읽을-것.bib"` 같은 이름을 붙여 주는데,
 * `download` 를 쓰면 그걸 여기서 다시 만들어야 하고 그 순간 두 벌이 된다.
 * 응답이 `attachment` 라 링크를 눌러도 화면은 그대로 있다.
 *
 * ## 세 가지 껍데기
 *
 * `ExportLinks` 가 알맹이(링크 셋)고, 나머지 둘은 그것을 어디에 담느냐만
 * 다르다. `ExportMenu` 는 제 단추와 팝오버를 데리고 다니고(상세 화면·설정),
 * `ExportSection` 은 **이미 열려 있는 남의 메뉴 안에** 끼워 넣는다(서가 카드).
 * 메뉴 안에 또 메뉴를 띄우면 바깥 메뉴의 "바깥을 누르면 닫힘" 과 부딪혀,
 * 형식을 고르려고 누르는 순간 둘 다 닫힌다.
 */

/** 무엇을 내보내는가. 둘 다 없으면 서재 전체다 — 라우트가 그렇게 읽는다. */
export interface ExportTarget {
  paperId?: string;
  groupId?: string;
}

const FORMAT_META: Record<
  ExportFormat,
  { label: string; hint: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  bibtex: { label: "BibTeX", hint: ".bib · LaTeX · Overleaf", Icon: FileText },
  ris: { label: "RIS", hint: ".ris · EndNote · RefWorks", Icon: BookMarked },
  csl: { label: "CSL-JSON", hint: ".json · Zotero · Pandoc", Icon: Braces },
};

/** 형식 셋. 남의 메뉴 안에도 우리 팝오버 안에도 그대로 들어간다. */
export function ExportLinks({
  target,
  onPick,
}: {
  target: ExportTarget;
  /** 담고 있는 메뉴를 닫으라고 알린다. 내려받기 자체는 링크가 알아서 한다. */
  onPick?: () => void;
}) {
  return (
    <>
      {EXPORT_FORMATS.map((format) => {
        const meta = FORMAT_META[format];
        return (
          <a
            key={format}
            role="menuitem"
            href={bibExportUrl({ ...target, format })}
            onClick={onPick}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition hover:bg-(--color-surface-hi)"
          >
            <meta.Icon className="h-3.5 w-3.5 shrink-0 text-(--color-fg-4)" />
            <span className="min-w-0">
              <span className="block text-xs text-(--color-fg-2)">{meta.label}</span>
              <span className="block truncate text-[10px] text-(--color-fg-4)">{meta.hint}</span>
            </span>
          </a>
        );
      })}
    </>
  );
}

/** 남의 메뉴 안에 끼우는 한 토막 — 위에 줄을 긋고 무엇을 내보내는지 밝힌다. */
export function ExportSection({
  target,
  title,
  hint,
  onPick,
}: {
  target: ExportTarget;
  title: string;
  hint?: string;
  onPick?: () => void;
}) {
  return (
    <div className="mt-1 border-t border-(--color-border-soft) pt-1">
      <p className="px-3 pt-1 pb-0.5 text-[10px] tracking-wider text-(--color-fg-4) uppercase">
        {title}
      </p>
      <ExportLinks target={target} onPick={onPick} />
      {hint && (
        <p className="px-3 pt-0.5 pb-1 text-[10px] break-keep text-(--color-fg-4)">{hint}</p>
      )}
    </div>
  );
}

/**
 * 제 단추를 가진 꼴.
 *
 * 팝오버를 닫는 배선은 서가 카드의 메뉴와 같다 — `pointerdown` 을 캡처 단계에서
 * 받는다. `click` 으로 받으면 아래 요소가 먼저 눌려 메뉴가 닫히기 전에 그쪽
 * 동작이 먼저 일어난다.
 */
export function ExportMenu({
  target,
  label,
  title,
  hint,
  className,
}: {
  target: ExportTarget;
  /** 단추에 적힐 글. PDF "내려받기" 와 헷갈리지 않는 이름을 준다. */
  label: string;
  title?: string;
  /** 팝오버 아래 한 줄. 원본 서지정보 유무 같은 것. */
  hint?: string;
  className?: string;
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
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={title ?? "BibTeX · RIS · CSL-JSON 으로 내보내기"}
        className={cn(
          "flex shrink-0 items-center gap-1.5 rounded-full bg-(--color-surface) px-3 py-1.5 text-xs text-(--color-fg-2) ring-1 ring-(--color-border-soft) transition hover:bg-(--color-surface-2)",
          className,
        )}
      >
        <Quote className="h-3.5 w-3.5" />
        {label}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute top-9 right-0 z-50 w-56 overflow-hidden rounded-xl bg-(--color-surface) py-1 shadow-xl ring-1 ring-(--color-border)"
        >
          <ExportLinks target={target} onPick={() => setOpen(false)} />
          {hint && (
            <p className="mt-1 border-t border-(--color-border-soft) px-3 pt-1.5 pb-1 text-[10px] break-keep text-(--color-fg-4)">
              {hint}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
