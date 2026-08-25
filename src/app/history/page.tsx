import { desc } from "drizzle-orm";
import { ArrowLeft, CheckCircle2, Clock, Lock, XCircle, Zap } from "lucide-react";
import Link from "next/link";

import { isAuthEnabled } from "@/lib/auth";
import { db, schema } from "@/lib/db";

/**
 * 로그인 기록.
 *
 * 인증을 끈 배포에서는 볼 것이 없어 안내만 띄운다. 설정 화면도 인증이 켜졌을
 * 때만 이 링크를 그리지만, 주소를 직접 쳐서 들어올 수 있으니 여기서도 막는다.
 */
export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  if (!isAuthEnabled()) {
    return (
      <main className="mx-auto max-w-[640px] px-6 py-16 text-center">
        <p className="text-sm text-(--color-fg-3)">
          인증이 비활성 상태입니다 (.env.local 에 AUTH_PASSWORD 설정 시 활성화).
        </p>
        <Link
          href="/"
          className="mt-4 inline-block text-sm text-(--color-accent-strong) hover:underline"
        >
          서재로 돌아가기
        </Link>
      </main>
    );
  }

  const logs = db
    .select()
    .from(schema.loginLog)
    .orderBy(desc(schema.loginLog.at))
    .limit(500)
    .all();

  return (
    <main className="relative mx-auto flex min-h-screen max-w-[860px] flex-col gap-6 px-6 py-10">
      <header className="flex items-center justify-between">
        <Link
          href="/"
          className="flex items-center gap-2 text-sm text-(--color-fg-3) hover:text-(--color-fg)"
        >
          <ArrowLeft className="h-4 w-4" />
          서재로
        </Link>
        <h1 className="text-2xl leading-tight" style={{ fontFamily: "var(--font-serif)" }}>
          로그인 기록
        </h1>
      </header>

      <div className="flex items-start gap-2 rounded-lg bg-(--color-surface) px-4 py-3 text-xs text-(--color-fg-3) ring-1 ring-(--color-border-soft)">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-(--color-fg-4)" />
        <span>
          모든 로그인 시도(수동/자동/성공/실패)가 기록되며 <strong>삭제할 수 없습니다</strong>.
          최근 500건 표시.
        </span>
      </div>

      <section className="overflow-hidden rounded-[var(--radius-card)] bg-(--color-surface) ring-1 ring-(--color-border-soft)">
        {logs.length === 0 ? (
          <div className="px-6 py-16 text-center text-sm text-(--color-fg-4)">
            아직 로그인 기록이 없습니다
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-(--color-border-soft) bg-(--color-bg-2)">
                <tr className="text-[10.5px] tracking-wider text-(--color-fg-4) uppercase">
                  <th className="px-5 py-3 text-left font-medium">시각</th>
                  <th className="px-3 py-3 text-left font-medium">유형</th>
                  <th className="px-3 py-3 text-left font-medium">결과</th>
                  <th className="px-5 py-3 text-left font-medium">User Agent</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-(--color-border-soft)">
                {logs.map((log) => {
                  const dt = log.at instanceof Date ? log.at : new Date(log.at);
                  return (
                    <tr key={log.id} className="hover:bg-(--color-surface-hi)">
                      <td className="px-5 py-2.5 font-mono text-[11.5px] text-(--color-fg-2)">
                        {dt.toLocaleString("ko-KR")}
                      </td>
                      <td className="px-3 py-2.5">
                        {log.type === "manual" ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-(--color-bg-2) px-2 py-0.5 text-[10.5px] text-(--color-fg-2) ring-1 ring-(--color-border-soft)">
                            <Lock className="h-2.5 w-2.5" />
                            수동
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-(--color-accent-soft) px-2 py-0.5 text-[10.5px] text-(--color-accent-strong) ring-1 ring-(--color-accent)/30">
                            <Zap className="h-2.5 w-2.5" />
                            자동
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {log.success ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-(--color-fg-2)">
                            <CheckCircle2 className="h-3 w-3 text-(--color-accent-strong)" />
                            성공
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] text-(--color-danger)">
                            <XCircle className="h-3 w-3" />
                            실패
                          </span>
                        )}
                      </td>
                      <td className="max-w-[280px] truncate px-5 py-2.5 font-mono text-[11px] text-(--color-fg-4)">
                        {log.userAgent ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <footer className="text-center text-[10.5px] text-(--color-fg-4)">
        <Clock className="mx-auto mb-1 h-3 w-3" />
        가장 최근 500건만 표시. 더 오래된 기록은 DB 의 login_log 테이블에 그대로 보존.
      </footer>
    </main>
  );
}
