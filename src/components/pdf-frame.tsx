"use client";

import { FileQuestion } from "lucide-react";

import { fileUrl } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * PDF 를 브라우저 내장 뷰어에 맡기는 자리. **지금은 대비책이다.**
 *
 * 본체는 `pdf-view.tsx` 다. 앵커 메모가 pdf.js 를 요구했다 — 글자 층의 좌표를
 * 알아야 칠할 자리를 잡고, 쪽 요소를 우리가 쥐고 있어야 비율 좌표가 배율
 * 변화에 버틴다. 내장 뷰어는 그중 아무것도 내주지 않는다.
 *
 * 그래도 이 파일이 남아 있는 이유는 pdf.js 가 못 서는 자리가 있기 때문이다.
 * 워커나 청크를 못 받아 오면(프록시·오프라인·배포 중 갈린 청크) 뷰어가 그리다
 * 예외를 던지고, `paper-detail.tsx` 의 오류 울타리가 그걸 잡아 여기로 물러난다 —
 * 내장 뷰어는 워커도 청크도 필요 없어서, 메모는 못 달아도 논문은 읽힌다. 밖으로 내보이는 것이 `fileId` 하나뿐인 것은 그 갈아 끼우기가 부르는
 * 쪽을 건드리지 않게 하려는 것이다.
 *
 * 파일 라우트가 응답에 `Content-Security-Policy: sandbox allow-scripts` 를
 * 붙인다. 내장 PDF 뷰어가 스크립트로 동작해 순수 sandbox 로는 빈 화면이
 * 되지만, `allow-same-origin` 은 빠져 있어 오리진은 불투명하게 남는다 —
 * PDF 안의 스크립트가 우리 쿠키나 DOM 에 닿지 못한다.
 */
export function PdfFrame({
  fileId,
  title,
  className,
}: {
  /** 붙어 있는 PDF. 없으면 자리만 그린다 — 서지정보만 먼저 적어 둔 논문. */
  fileId: string | null;
  title: string;
  className?: string;
}) {
  if (!fileId) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-[var(--radius-app)] bg-(--color-bg-2) text-(--color-fg-4) ring-1 ring-(--color-border-soft)",
          className,
        )}
      >
        <FileQuestion className="h-7 w-7" />
        <p className="px-6 text-center text-xs break-keep">
          이 논문에는 아직 PDF 가 붙어 있지 않습니다
        </p>
      </div>
    );
  }

  return (
    <iframe
      // fileId 가 바뀌면 iframe 을 새로 만든다. src 만 갈면 앞 논문의 스크롤
      // 위치와 검색어가 그대로 남는다.
      key={fileId}
      src={fileUrl(fileId)}
      title={`${title} 원문`}
      className={cn(
        "w-full rounded-[var(--radius-app)] bg-(--color-bg-2) ring-1 ring-(--color-border-soft)",
        className,
      )}
    />
  );
}
