import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { RETENTION_DAYS } from "@/lib/trash";

import { TrashPanel } from "./trash-panel";

export const dynamic = "force-dynamic";

/**
 * 휴지통은 따로 둔다.
 *
 * 지운 것이 쌓이면 길이가 얼마든지 늘어난다. 설정 페이지에 함께 두면 그 아래
 * 것들이 화면 밖으로 밀려나, 맨 아래로 내려도 스크롤이 길어지는 것은 그대로다.
 */
export default function TrashPage() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-5 px-6 py-10">
      <Link
        href="/settings"
        className="flex w-fit items-center gap-1.5 text-sm text-(--color-fg-3) transition hover:text-(--color-fg)"
      >
        <ArrowLeft className="h-4 w-4" />
        설정으로
      </Link>
      <h1 className="text-2xl text-(--color-fg)">휴지통</h1>
      <TrashPanel retentionDays={RETENTION_DAYS} />
    </main>
  );
}
