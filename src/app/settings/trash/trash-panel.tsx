"use client";

import { FileText, Library, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { api, type TrashEntryDTO } from "@/lib/client-api";
import { cn, formatDateTime } from "@/lib/utils";

/**
 * 30일 휴지통 — 되살리기 / 지금 영구 삭제 / 통째로 비우기.
 *
 * 되살릴 수 없는 줄에는 **왜 못 되살리는지**를 그대로 보여 준다. 논문이 있던
 * 서가가 함께 지워졌다면 서가를 먼저 되살려야 하는데, 단추만 흐리게 해 두면
 * 사람은 그 순서를 알 길이 없다.
 */
export function TrashPanel({ retentionDays }: { retentionDays: number }) {
  const [entries, setEntries] = useState<TrashEntryDTO[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setEntries(await api.trash.list());
    } catch {
      setEntries([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (id: string, action: "restore" | "purge") => {
    if (action === "purge" && !confirm("지금 영구 삭제할까요? 되돌릴 수 없습니다.")) return;
    setBusy(id);
    setError(null);
    try {
      const r = action === "restore" ? await api.trash.restore(id) : await api.trash.purge(id);
      setEntries(r.trash);
    } catch (e) {
      setError(e instanceof Error ? e.message : "처리 실패");
    } finally {
      setBusy(null);
    }
  };

  const empty = async () => {
    if (!confirm("휴지통을 통째로 비웁니다. PDF 원본도 이때 디스크에서 사라집니다. 진행할까요?")) {
      return;
    }
    setBusy("__all__");
    setError(null);
    try {
      setEntries((await api.trash.empty()).trash);
    } catch (e) {
      setError(e instanceof Error ? e.message : "비우기 실패");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="rounded-[var(--radius-card)] bg-(--color-surface) p-6 ring-1 ring-(--color-border-soft)">
      <header className="mb-1 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-base font-medium text-(--color-fg)">
          <Trash2 className="h-4 w-4 text-(--color-fg-3)" />
          휴지통
        </span>
        {entries !== null && entries.length > 0 && (
          <button
            type="button"
            onClick={() => void empty()}
            disabled={busy !== null}
            className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] text-(--color-fg-4) transition hover:bg-(--color-danger)/15 hover:text-(--color-danger)"
          >
            {busy === "__all__" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            통째로 비우기
          </button>
        )}
      </header>
      <p className="mb-4 text-xs break-keep text-(--color-fg-4)">
        지운 서가·논문은 <b>{retentionDays}일</b> 동안 여기 보관되고 그때까지 되살릴 수
        있습니다. PDF 원본도 함께 남아 있다가 만료되면 같이 지워집니다 — 되살리면 같은
        파일이 그대로 다시 붙습니다.
      </p>

      {entries === null ? (
        <div className="flex items-center justify-center gap-2 py-8 text-xs text-(--color-fg-4)">
          <Loader2 className="h-4 w-4 animate-spin" />
          불러오는 중…
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-(--color-border) py-8 text-center text-xs text-(--color-fg-4)">
          휴지통이 비어 있습니다
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {entries.map((e) => (
            <li
              key={e.id}
              className="flex items-center gap-2.5 rounded-lg bg-(--color-bg-2) p-2.5 ring-1 ring-(--color-border-soft)"
            >
              <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-(--color-surface) text-(--color-fg-4)">
                {e.kind === "group" ? (
                  <Library className="h-3.5 w-3.5" />
                ) : (
                  <FileText className="h-3.5 w-3.5" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-(--color-fg)">
                  {e.label || "(제목 없음)"}
                </div>
                <div className="truncate font-mono text-[10.5px] text-(--color-fg-4)">
                  {e.kind === "group"
                    ? `서가 · 논문 ${e.papers}편${e.children ? ` · 칸 ${e.children}개` : ""}`
                    : (e.groupName ?? "논문")}
                  {" · "}
                  {formatDateTime(e.deletedAt)}
                  {" · "}
                  {e.daysLeft}일 남음
                </div>
              </div>

              <button
                type="button"
                onClick={() => void act(e.id, "restore")}
                disabled={busy !== null || !e.restorable}
                title={e.restorable ? "되살리기" : (e.blockedReason ?? "지금은 되살릴 수 없습니다")}
                className={cn(
                  "flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] ring-1 transition",
                  e.restorable
                    ? "bg-(--color-accent-soft) text-(--color-accent-strong) ring-(--color-accent)/40 hover:bg-(--color-accent)/25"
                    : "bg-(--color-surface) text-(--color-fg-4) ring-(--color-border-soft) opacity-60",
                )}
              >
                {busy === e.id ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RotateCcw className="h-3 w-3" />
                )}
                되살리기
              </button>
              <button
                type="button"
                onClick={() => void act(e.id, "purge")}
                disabled={busy !== null}
                title="지금 영구 삭제"
                className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-(--color-fg-4) transition hover:bg-(--color-danger)/20 hover:text-(--color-danger)"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="mt-2 text-xs text-(--color-danger)">{error}</p>}
    </section>
  );
}
