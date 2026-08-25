"use client";

import { FilePlus2, Upload } from "lucide-react";
import { useRef, useState } from "react";

import { extOf } from "@/lib/file-kind";
import { cn } from "@/lib/utils";

/**
 * PDF 를 끌어다 놓거나 골라 올리는 자리.
 *
 * 실제 전송은 `upload-queue.ts` 가 맡는다. 여기는 파일을 **받기만** 한다 —
 * 서가 카드마다 하나씩 놓이는 것이라, 큐를 카드 수만큼 만들지 않으려면
 * 받는 곳과 보내는 곳이 갈라져 있어야 한다.
 *
 * PDF 가 아닌 것은 여기서 떨어뜨린다. 서버도 막겠지만, 사진 폴더를 통째로
 * 끌어다 놓았을 때 오류 토스트 40개가 뜨는 것보다 조용히 걸러 내고 몇 개를
 * 걸렀는지 한 줄로 알려 주는 편이 낫다.
 */

const ACCEPT = ".pdf,application/pdf";

/** 받아도 되는 것만 남긴다. 걸러진 개수를 함께 돌려준다. */
export function keepPdfs(files: File[]): { kept: File[]; dropped: number } {
  const kept = files.filter((f) => extOf(f.name) === "pdf");
  return { kept, dropped: files.length - kept.length };
}

export function UploadDrop({
  onFiles,
  onReject,
  className,
  children,
  /** 카드 본문을 감쌀 때 쓰는 얇은 모드. 안내문 없이 오버레이만 띄운다. */
  bare = false,
}: {
  onFiles: (files: File[]) => void;
  /** 받을 수 없는 것을 떨어뜨렸을 때 알릴 곳. */
  onReject?: (message: string) => void;
  className?: string;
  children?: React.ReactNode;
  bare?: boolean;
}) {
  const [over, setOver] = useState(false);
  /*
   * dragenter/dragleave 는 자식 요소를 지날 때마다 짝지어 터진다. 참/거짓
   * 하나로 두면 목록 위를 지나는 동안 오버레이가 미친 듯이 깜빡인다.
   * 들어오고 나간 횟수를 세어 0 이 될 때만 끈다.
   */
  const depth = useRef(0);

  const take = (files: File[]) => {
    const { kept, dropped } = keepPdfs(files);
    if (dropped > 0) {
      onReject?.(
        kept.length > 0
          ? `PDF 가 아닌 파일 ${dropped}개는 건너뛰었습니다`
          : "PDF 만 올릴 수 있습니다",
      );
    }
    if (kept.length > 0) onFiles(kept);
  };

  return (
    <div
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        depth.current += 1;
        setOver(true);
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        // preventDefault 를 빼면 브라우저가 PDF 를 그냥 탭에 열어 버린다.
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        take(Array.from(e.dataTransfer.files ?? []));
      }}
      className={cn("relative", className)}
    >
      {children}

      {!bare && !children && (
        <div className="flex flex-col items-center justify-center gap-1.5 px-4 py-6 text-(--color-fg-4)">
          <Upload className="h-5 w-5" />
          <span className="text-[11.5px] break-keep">
            PDF 를 여기에 끌어다 놓으세요
          </span>
        </div>
      )}

      {over && (
        <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center rounded-[inherit] bg-(--color-accent-soft) ring-2 ring-(--color-accent)/60 ring-inset">
          <span className="flex items-center gap-2 rounded-full bg-(--color-surface) px-3 py-1.5 text-xs text-(--color-accent-strong) shadow-lg">
            <Upload className="h-3.5 w-3.5" />
            여기에 놓기
          </span>
        </div>
      )}
    </div>
  );
}

/** 파일 고르기 단추. 끌어다 놓기가 어려운 기기(터치)에서는 이쪽이 유일한 길이다. */
export function UploadButton({
  onFiles,
  onReject,
  className,
  label = "PDF 올리기",
}: {
  onFiles: (files: File[]) => void;
  onReject?: (message: string) => void;
  className?: string;
  label?: string;
}) {
  const input = useRef<HTMLInputElement | null>(null);

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          input.current?.click();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        title={label}
        aria-label={label}
        className={cn(
          "grid h-7 w-7 place-items-center rounded-md text-(--color-fg-4) transition hover:bg-(--color-surface-hi) hover:text-(--color-fg-2)",
          className,
        )}
      >
        <FilePlus2 className="h-3.5 w-3.5" />
      </button>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          // 같은 파일을 두 번 고를 수 있어야 한다. 값을 비우지 않으면
          // change 가 다시 터지지 않는다.
          e.target.value = "";
          const { kept, dropped } = keepPdfs(picked);
          if (dropped > 0) onReject?.(`PDF 가 아닌 파일 ${dropped}개는 건너뛰었습니다`);
          if (kept.length > 0) onFiles(kept);
        }}
      />
    </>
  );
}
