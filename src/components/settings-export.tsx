"use client";

import { AlertTriangle, Download } from "lucide-react";
import { useState } from "react";

import { apiFetch } from "@/lib/api-path";
import { STORAGE_KEYS } from "@/lib/preferences";
import { readJson } from "@/lib/read-json";

/**
 * 백업 내보내기.
 *
 * **불러오기는 아직 없다.** 1단계에서는 서버에 되살리는 길이 없고
 * (`paper-server.ts` 에 `exportAll` 만 있다), 반쪽짜리 복원 단추를 두는 것은
 * 없는 것보다 나쁘다 — 눌러 보고 나서야 안 된다는 걸 알게 된다.
 *
 * 표시 설정은 브라우저에만 있으므로 여기서 얹어 준다. 그것까지 한 파일에
 * 있어야 새 기기에서 같은 화면으로 시작할 수 있다.
 */
export function SettingsExport() {
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const onExport = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const res = await apiFetch("/api/export", { cache: "no-store" });
      const payload = await readJson<Record<string, unknown>>(res);
      payload.prefs = readPrefs();

      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `paperbento-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      // 놓아주지 않으면 파일이 통째로 메모리에 남는다. 서재가 크면 그게 수십 MB 다.
      URL.revokeObjectURL(url);
      setStatus({ ok: true, msg: "내보내기 완료" });
    } catch (e) {
      setStatus({ ok: false, msg: e instanceof Error ? e.message : "내보내기 실패" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-[var(--radius-card)] bg-(--color-surface) p-6 ring-1 ring-(--color-border-soft)">
      <header className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-base font-medium text-(--color-fg)">백업</div>
          <div className="text-xs break-keep text-(--color-fg-4)">
            서가·논문·요약·메모와 표시 설정을 한 파일로 내보냅니다.
          </div>
        </div>
        <button
          type="button"
          onClick={() => void onExport()}
          disabled={busy}
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-(--color-bg-2) px-3 py-1.5 text-xs text-(--color-fg-2) ring-1 ring-(--color-border-soft) transition hover:bg-(--color-surface-hi) disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" />
          내보내기
        </button>
      </header>

      <p className="flex items-start gap-1.5 text-[11px] break-keep text-(--color-fg-4)">
        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-(--color-warn)" />
        <span>
          PDF 의 <b>바이트는 이 JSON 에 들어 있지 않습니다</b> — 원본은{" "}
          <code className="font-mono">data/uploads</code> 볼륨에 있습니다. 서버를
          옮길 때는 JSON 과 함께 그 디렉터리도 복사하세요. 논문은 파일이 곧
          본체라 여기서 어긋나면 되살려도 빈 껍데기가 됩니다.
        </span>
      </p>

      {status && (
        <p
          className={
            "mt-2 text-xs " +
            (status.ok ? "text-(--color-accent-strong)" : "text-(--color-danger)")
          }
        >
          {status.msg}
        </p>
      )}
    </section>
  );
}

function readPrefs(): Record<string, string | undefined> {
  try {
    return {
      theme: localStorage.getItem(STORAGE_KEYS.theme) ?? undefined,
      mode: localStorage.getItem(STORAGE_KEYS.mode) ?? undefined,
      columns: localStorage.getItem(STORAGE_KEYS.columns) ?? undefined,
    };
  } catch {
    return {};
  }
}
