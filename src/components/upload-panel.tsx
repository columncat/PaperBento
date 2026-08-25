"use client";

import { AlertCircle, CheckCircle2, Loader2, Upload, X } from "lucide-react";
import { useEffect, useState } from "react";

import { formatBytes } from "@/lib/types";
import { cn } from "@/lib/utils";

import {
  cancelUpload,
  clearFinishedUploads,
  subscribeUploads,
  type UploadItem,
} from "./upload-queue";

/** 헤더 단추에 띄울 요약 — 진행 중 건수. */
export function useUploadSummary() {
  const [items, setItems] = useState<UploadItem[]>([]);
  useEffect(() => subscribeUploads(setItems), []);
  const active = items.filter((i) => ["queued", "preparing", "uploading"].includes(i.status));
  return { total: items.length, active: active.length };
}

/** 올리는 줄. 열려 있을 때만 그린다 (헤더 단추로 토글). */
export function UploadPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [items, setItems] = useState<UploadItem[]>([]);
  useEffect(() => subscribeUploads(setItems), []);

  if (!open) return null;

  const active = items.filter((i) => ["queued", "preparing", "uploading"].includes(i.status));
  const totalSize = active.reduce((s, i) => s + i.size, 0);
  const totalSent = active.reduce((s, i) => s + i.sent, 0);

  return (
    <div className="fixed right-6 bottom-6 z-50 w-[min(380px,90vw)] rounded-[var(--radius-app)] bg-(--color-surface) shadow-2xl ring-1 ring-(--color-border)">
      <header className="flex items-center justify-between gap-2 border-b border-(--color-border-soft) px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Upload className="h-3.5 w-3.5 shrink-0 text-(--color-accent)" />
          <span className="truncate text-xs font-medium text-(--color-fg-2)">
            {active.length > 0
              ? `업로드 ${active.length}건 · ${formatBytes(totalSent)} / ${formatBytes(totalSize)}`
              : "업로드 완료"}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={clearFinishedUploads}
            className="rounded-md px-2 py-1 text-[11px] text-(--color-fg-4) hover:bg-(--color-surface-hi) hover:text-(--color-fg-2)"
            title="끝난 항목 치우기"
          >
            치우기
          </button>
          <button
            type="button"
            onClick={onClose}
            className="grid h-6 w-6 place-items-center rounded-md text-(--color-fg-4) hover:bg-(--color-surface-hi) hover:text-(--color-fg-2)"
            aria-label="닫기"
            title="닫기"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      {items.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs break-keep text-(--color-fg-4)">
          올리는 중인 항목이 없습니다
        </p>
      ) : (
        <ul className="scrollbar-thin max-h-[320px] divide-y divide-(--color-border-soft) overflow-y-auto">
          {items.map((i) => (
            <Row key={i.id} item={i} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Row({ item }: { item: UploadItem }) {
  const pct = item.size > 0 ? Math.min(100, Math.round((item.sent / item.size) * 100)) : 0;
  const busy = ["queued", "preparing", "uploading"].includes(item.status);

  return (
    <li className="flex items-start gap-2.5 px-4 py-2.5">
      <span className="mt-0.5 shrink-0">
        {item.status === "done" ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-(--color-accent-strong)" />
        ) : item.status === "error" ? (
          <AlertCircle className="h-3.5 w-3.5 text-(--color-danger)" />
        ) : item.status === "canceled" ? (
          <X className="h-3.5 w-3.5 text-(--color-fg-4)" />
        ) : (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-(--color-fg-3)" />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <div className="truncate text-[11.5px] text-(--color-fg-2)" title={item.name}>
          {item.name}
        </div>
        {busy && (
          <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-(--color-bg-2)">
            <div
              className="h-full rounded-full bg-(--color-accent) transition-[width]"
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
        <div
          className={cn(
            "mt-0.5 truncate font-mono text-[10px]",
            item.status === "error" ? "text-(--color-danger)" : "text-(--color-fg-4)",
          )}
        >
          {item.status === "error"
            ? item.error
            : item.status === "done"
              ? "완료 — 등록 시트가 열립니다"
              : item.status === "canceled"
                ? "취소됨"
                : `${formatBytes(item.sent)} / ${formatBytes(item.size)}`}
        </div>
      </div>

      {busy && (
        <button
          type="button"
          onClick={() => cancelUpload(item.id)}
          className="grid h-5 w-5 shrink-0 place-items-center rounded text-(--color-fg-4) hover:text-(--color-danger)"
          aria-label="취소"
          title="취소"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </li>
  );
}
