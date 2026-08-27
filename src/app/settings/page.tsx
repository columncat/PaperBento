import { ArrowLeft, ChevronRight, Clock, Database, LogOut } from "lucide-react";
import Link from "next/link";

import { ExportMenu } from "@/components/export-menu";
import { PreferencesPanel } from "@/components/preferences-panel";
import { SettingsExport } from "@/components/settings-export";
import { apiPath } from "@/lib/api-path";
import { isAuthEnabled } from "@/lib/auth";
import { listGroups } from "@/lib/paper-server";
import { countPapers } from "@/lib/types";

/**
 * 설정.
 *
 * 자매 앱과 같은 짜임이다 — 저장 현황, 표시 설정, 백업, 그리고 기록. 휴지통과
 * 에이전트 기록은 한 단계 들어가서 본다. 둘 다 항목이 얼마든지 쌓이는 목록이라
 * 여기 펼쳐 두면 설정 화면이 끝없이 길어지고, 자주 보는 것도 아니다.
 */
export const dynamic = "force-dynamic";

/** 휴지통 보관 기간. 스키마 주석과 같은 값이다. */
const RETENTION_DAYS = 30;

export default async function SettingsPage() {
  const authEnabled = isAuthEnabled();
  const groups = listGroups();

  const papers = groups.reduce((s, g) => s + countPapers(g), 0);
  const subGroups = groups.reduce((s, g) => s + g.children.length, 0);
  const summaries = groups.reduce(
    (s, g) =>
      s +
      g.papers.filter((p) => p.hasSummary).length +
      g.children.reduce((n, c) => n + c.papers.filter((p) => p.hasSummary).length, 0),
    0,
  );

  return (
    <main className="relative mx-auto flex min-h-screen max-w-[860px] flex-col gap-6 px-6 py-10 lg:px-0">
      <header className="flex items-center justify-between">
        <Link
          href="/"
          className="flex items-center gap-2 text-sm text-(--color-fg-3) hover:text-(--color-fg)"
        >
          <ArrowLeft className="h-4 w-4" />
          서재로
        </Link>
        <div className="flex items-center gap-2">
          {authEnabled && (
            <>
              <Link
                href="/history"
                className="flex items-center gap-1.5 rounded-full bg-(--color-surface) px-3 py-1.5 text-xs text-(--color-fg-2) ring-1 ring-(--color-border-soft) transition hover:bg-(--color-surface-2)"
              >
                <Clock className="h-3.5 w-3.5" />
                로그인 기록
              </Link>
              {/*
                로그아웃은 폼이다. 쿠키를 지우는 것은 서버가 해야 하고,
                링크(GET)로 두면 다른 사이트의 <img> 하나로도 로그아웃당한다.
                손으로 적은 주소라 apiPath 를 지나야 하위 경로 배포에서 산다.
              */}
              <form action={apiPath("/api/logout")} method="POST">
                <button
                  type="submit"
                  className="flex items-center gap-1.5 rounded-full bg-(--color-surface) px-3 py-1.5 text-xs text-(--color-fg-3) ring-1 ring-(--color-border-soft) transition hover:bg-(--color-danger)/15 hover:text-(--color-danger)"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  로그아웃
                </button>
              </form>
            </>
          )}
        </div>
      </header>

      <h1 className="text-2xl leading-tight" style={{ fontFamily: "var(--font-serif)" }}>
        설정
      </h1>

      {/* 저장 현황 */}
      <section className="rounded-[var(--radius-card)] bg-(--color-surface) p-6 ring-1 ring-(--color-border-soft)">
        <div className="mb-4 flex items-center gap-2 text-base font-medium text-(--color-fg)">
          <Database className="h-4 w-4 text-(--color-fg-3)" />
          저장 현황
        </div>

        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="서가" value={String(groups.length)} />
          <Stat label="하위 칸" value={String(subGroups)} />
          <Stat label="논문" value={String(papers)} />
          <Stat label="요약" value={String(summaries)} />
        </dl>

        <p className="mt-3 text-[11px] break-keep text-(--color-fg-4)">
          서가는 <b>두 단까지</b>입니다 — 서가 안에 칸을 둘 수 있지만 그 칸은
          다시 칸을 갖지 못합니다. 시스템 서가(<b>Inbox</b>)는 이름 변경·삭제가
          잠겨 있고, 안의 논문은 자유롭게 옮길 수 있습니다.
        </p>
      </section>

      {/* 표시 설정 */}
      <PreferencesPanel />

      {/* 백업 */}
      <SettingsExport />

      {/*
        서지정보 내보내기 — 바로 위 "백업" 과 다른 것이다.

        둘 다 파일 하나가 떨어지는 단추라 붙여 두면 반드시 헷갈린다. 그래서
        같은 카드에 합치지 않고, 서로가 무엇이 **아닌지**를 두 줄로 적었다.
        백업은 우리 DB 모양 그대로라 되살리기 말고는 쓸 데가 없고(BibTeX 키도
        저자 성/이름 구분도 없다), 이쪽은 position·groupId 같은 우리 사정이
        빠진 대신 남의 프로그램이 읽는다.

        `?paper=` 도 `?group=` 도 주지 않으면 라우트가 서재 전체로 읽는다.
      */}
      <section className="rounded-[var(--radius-card)] bg-(--color-surface) p-6 ring-1 ring-(--color-border-soft)">
        <header className="mb-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-base font-medium text-(--color-fg)">서지정보 내보내기</div>
            <div className="text-xs break-keep text-(--color-fg-4)">
              서재에 든 논문 {papers}편을 논문 관리자가 읽는 형식으로 내보냅니다.
            </div>
          </div>
          <ExportMenu
            target={{}}
            label="서재 전체"
            title="서재 전체를 BibTeX · RIS · CSL-JSON 으로"
            className="bg-(--color-bg-2)"
          />
        </header>

        <p className="text-[11px] break-keep text-(--color-fg-4)">
          위의 <b>백업</b>과 다른 것입니다. 백업은 <b>이 앱으로 되살리기</b> 위한
          것이고(서가·요약·메모까지 우리 모양 그대로), 이쪽은{" "}
          <b>Zotero·EndNote·LaTeX 에 넣을 인용 자료</b>입니다. 원본 서지정보가
          없는 논문도 빠지지 않습니다 — 적어 둔 칸으로 최소한을 만들어 함께
          내보냅니다.
        </p>
      </section>

      {/* 기록 */}
      <section className="rounded-[var(--radius-card)] bg-(--color-surface) p-6 ring-1 ring-(--color-border-soft)">
        <h2 className="mb-1 text-lg font-medium text-(--color-fg)">기록</h2>
        <p className="mb-4 text-sm text-(--color-fg-4)">
          지운 것과, 에이전트가 고친 것.
        </p>
        <div className="flex flex-col gap-2">
          <SubPageLink
            href="/settings/trash"
            title="휴지통"
            desc={`지운 서가·논문을 ${RETENTION_DAYS}일간 보관합니다`}
          />
          <SubPageLink
            href="/settings/agent-log"
            title="에이전트 기록"
            desc="MCP 로 연결된 에이전트가 무엇을 고쳤는지"
          />
        </div>
      </section>
    </main>
  );
}

function SubPageLink({
  href,
  title,
  desc,
}: {
  href: string;
  title: string;
  desc: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-3 rounded-lg bg-(--color-bg-2) px-4 py-3 ring-1 ring-(--color-border-soft) transition hover:bg-(--color-surface-hi)"
    >
      <span className="min-w-0">
        <span className="block text-sm text-(--color-fg)">{title}</span>
        <span className="block text-[12px] break-keep text-(--color-fg-4)">{desc}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-(--color-fg-4)" />
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-(--color-bg-2) px-4 py-3 ring-1 ring-(--color-border-soft)">
      <dt className="text-[10.5px] tracking-wider text-(--color-fg-4) uppercase">{label}</dt>
      <dd className="mt-0.5 font-mono text-lg text-(--color-fg)">{value}</dd>
    </div>
  );
}
