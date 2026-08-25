import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { AgentLogPanel } from "./agent-log-panel";

export const dynamic = "force-dynamic";

export default function AgentLogPage() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-5 px-6 py-10">
      <Link
        href="/settings"
        className="flex w-fit items-center gap-1.5 text-sm text-(--color-fg-3) transition hover:text-(--color-fg)"
      >
        <ArrowLeft className="h-4 w-4" />
        설정으로
      </Link>
      <h1 className="text-2xl text-(--color-fg)">에이전트 기록</h1>
      <AgentLogPanel />
    </main>
  );
}
