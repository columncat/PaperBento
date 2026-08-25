"use client";

import { Bot, Loader2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api-path";

interface Entry {
  id: number;
  at: number;
  actor: string;
  action: string;
  target: string | null;
  detail: unknown;
}

/**
 * 에이전트가 무엇을 고쳤는지.
 *
 * 변경만 남는다 — 읽기까지 남기면 목록 한 번 부를 때마다 줄이 쌓여 정작 봐야 할
 * 것이 묻힌다. 여기 없는 변경은 사람이 화면에서 한 것이다.
 */
export function AgentLogPanel() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const r = await apiFetch("/api/agent-log");
      const j = (await r.json()) as { entries?: Entry[]; retentionDays?: number };
      setEntries(j.entries ?? []);
      if (j.retentionDays) setDays(j.retentionDays);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const clear = async () => {
    if (!confirm("기록을 모두 지웁니다. 논문이나 서가가 사라지지는 않습니다. 진행할까요?")) {
      return;
    }
    await apiFetch("/api/agent-log", { method: "DELETE" });
    void load();
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-1 py-8 text-sm text-(--color-fg-4)">
        <Loader2 className="h-4 w-4 animate-spin" />
        불러오는 중…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm break-keep text-(--color-fg-3)">
          에이전트(MCP)가 고친 것만 남습니다. {days}일이 지나면 사라집니다.
        </p>
        {entries.length > 0 && (
          <button
            type="button"
            onClick={() => void clear()}
            className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] text-(--color-fg-4) transition hover:bg-(--color-danger)/15 hover:text-(--color-danger)"
          >
            <Trash2 className="h-3.5 w-3.5" />
            기록 비우기
          </button>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-(--color-border) py-10 text-center text-sm break-keep text-(--color-fg-4)">
          <Bot className="mx-auto mb-1.5 h-4 w-4" />
          아직 에이전트가 고친 것이 없습니다
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {entries.map((e) => (
            <li
              key={e.id}
              className="rounded-lg bg-(--color-bg-2) px-3 py-2.5 ring-1 ring-(--color-border-soft)"
            >
              <div className="flex items-baseline gap-2">
                <span className="shrink-0 rounded bg-(--color-surface-hi) px-1.5 py-0.5 font-mono text-[10.5px] text-(--color-fg-3)">
                  {e.actor}
                </span>
                <span className="min-w-0 flex-1 text-[13px] font-medium text-(--color-fg)">
                  {e.action}
                </span>
                <span className="shrink-0 font-mono text-[10.5px] text-(--color-fg-4)">
                  {new Date(e.at).toLocaleString("ko-KR")}
                </span>
              </div>
              {e.target && (
                <p className="mt-0.5 truncate text-[12px] text-(--color-fg-2)" title={e.target}>
                  {e.target}
                </p>
              )}
              {e.detail != null && (
                <p className="mt-0.5 font-mono text-[11px] break-all text-(--color-fg-4)">
                  {typeof e.detail === "string" ? e.detail : JSON.stringify(e.detail)}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
