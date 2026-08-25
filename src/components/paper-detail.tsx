"use client";

import {
  AlertCircle,
  ArrowLeft,
  Download,
  ExternalLink,
  Eye,
  Loader2,
  Pencil,
  Sparkles,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/lib/client-api";
import { startDownload } from "@/lib/download";
import {
  citationLine,
  fileUrl,
  formatBytes,
  type GroupDTO,
  type PaperDTO,
  type PaperMark,
  type ReadState,
  type SummaryDTO,
} from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

import { MarkPicker, ReadStateButton } from "./paper-mark";
import { PaperSheet, type SheetTarget } from "./paper-sheet";
import { PdfFrame } from "./pdf-frame";
import { RichText } from "./rich-text";

/**
 * 논문 상세. **1단계에서는 읽는 것과 요약뿐이다.**
 *
 * 쪽 위에 붙는 앵커 메모와 제대로 된 뷰어는 2단계다. 그 자리에 "곧 옵니다"
 * 를 두지 않는다 — 쓸 수 없는 것을 보여 주면 화면만 어지럽고, 대신 뷰어를
 * `pdf-frame.tsx` 로 떼어 두어 그때 그 파일만 갈아 끼우면 되게 했다.
 *
 * 요약은 마크다운이다. 그리는 것은 `rich-text.tsx` 로, 채팅창이 에이전트
 * 답변을 그리는 것과 **같은 렌더러**다. 요약은 사람이 쓸 수도 에이전트가 쓸
 * 수도 있는데 둘이 다르게 보이면 안 된다. HTML 문자열을 만들지 않는 렌더러라
 * 남의 글이 섞여 들어와도 태그가 끼어들 자리가 없다.
 */
export function PaperDetail({
  paper: initialPaper,
  groupName,
  groups,
  summary: initialSummary,
}: {
  paper: PaperDTO;
  groupName: string;
  groups: GroupDTO[];
  summary: SummaryDTO | null;
}) {
  const router = useRouter();
  const [paper, setPaper] = useState(initialPaper);
  const [summary, setSummary] = useState<SummaryDTO | null>(initialSummary);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialSummary?.body ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetTarget | null>(null);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 서버가 다시 그려 주면(편집 후 refresh) 그 값이 이긴다.
  useEffect(() => setPaper(initialPaper), [initialPaper]);

  const fail = useCallback((e: unknown) => {
    setError(e instanceof Error ? e.message : "요청에 실패했습니다");
    if (errorTimer.current) clearTimeout(errorTimer.current);
    errorTimer.current = setTimeout(() => setError(null), 6000);
  }, []);

  /**
   * 읽기 상태·표식은 즉시 반영하고 서버는 뒤따라간다.
   *
   * 여기서 `api.updatePaper` 가 돌려주는 것은 서재 전체다. 상세 화면은 그걸
   * 쓸 데가 없으므로 버린다 — 봉투를 화면마다 다르게 만들지 않기로 한 값이다.
   */
  const patch = (next: Partial<PaperDTO>) => {
    setPaper((p) => ({ ...p, ...next }));
    void api.updatePaper(paper.id, next as { readState?: ReadState; mark?: PaperMark | null }).catch(fail);
  };

  const saveSummary = async () => {
    setSaving(true);
    try {
      // 응답에 서가도 함께 온다 (`hasSummary` 가 달라지므로). 상세 화면은
      // 그걸 쓸 데가 없어 버리지만, 봉투를 화면마다 다르게 만들지 않기로 한
      // 값이라 그대로 둔다.
      const { summary: saved } = await api.saveSummary(paper.id, draft);
      setSummary(saved);
      setEditing(false);
      // 이 화면 안의 표시도 따라오게. 서재로 돌아가면 서버 값이 다시 이긴다.
      setPaper((p) => ({ ...p, hasSummary: draft.trim().length > 0 }));
    } catch (e) {
      fail(e);
    } finally {
      setSaving(false);
    }
  };

  const cite = citationLine(paper);
  const tags = (paper.tags ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  return (
    <main className="relative mx-auto flex min-h-screen w-full max-w-[1600px] flex-col gap-5 px-6 py-8 lg:px-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/"
          className="flex items-center gap-2 text-sm text-(--color-fg-3) hover:text-(--color-fg)"
        >
          <ArrowLeft className="h-4 w-4" />
          서재로
        </Link>

        <div className="flex items-center gap-1.5">
          <ReadStateButton
            state={paper.readState}
            onChange={(readState) => patch({ readState })}
            className="h-8 w-8"
          />
          <MarkPicker current={paper.mark} onPick={(mark) => patch({ mark })} />

          {paper.url && (
            <a
              href={paper.url}
              target="_blank"
              rel="noreferrer noopener"
              title={paper.url}
              className="flex items-center gap-1.5 rounded-full bg-(--color-surface) px-3 py-1.5 text-xs text-(--color-fg-2) ring-1 ring-(--color-border-soft) transition hover:bg-(--color-surface-2)"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              원문
            </a>
          )}

          {paper.file && (
            <button
              type="button"
              onClick={() => startDownload(paper.file!)}
              className="flex items-center gap-1.5 rounded-full bg-(--color-surface) px-3 py-1.5 text-xs text-(--color-fg-2) ring-1 ring-(--color-border-soft) transition hover:bg-(--color-surface-2)"
            >
              <Download className="h-3.5 w-3.5" />
              내려받기
            </button>
          )}

          <button
            type="button"
            onClick={() => setSheet({ mode: "edit", groupId: paper.groupId, paper })}
            className="flex items-center gap-1.5 rounded-full bg-(--color-accent-soft) px-3 py-1.5 text-xs text-(--color-accent-strong) ring-1 ring-(--color-accent)/40 transition hover:bg-(--color-accent)/25"
          >
            <Pencil className="h-3.5 w-3.5" />
            서지정보 편집
          </button>
        </div>
      </header>

      {/*
        넓은 화면에서는 왼쪽에 글, 오른쪽에 PDF 를 나란히 둔다. 논문을 읽으며
        요약을 적는 자리라 둘이 한 화면에 있어야 한다. 좁아지면 위아래로 쌓인다.
      */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          {/* 서지정보 */}
          <section className="rounded-[var(--radius-card)] bg-(--color-surface) p-6 ring-1 ring-(--color-border-soft)">
            <p className="mb-1 text-[11px] text-(--color-fg-4)">{groupName}</p>
            <h1
              className="text-xl leading-snug break-keep text-(--color-fg)"
              style={{ fontFamily: "var(--font-serif)" }}
            >
              {paper.title}
            </h1>
            {cite && <p className="mt-1.5 text-sm text-(--color-fg-3)">{cite}</p>}

            <dl className="mt-4 flex flex-col gap-2 text-xs">
              {paper.doi && <Meta label="DOI" value={paper.doi} href={`https://doi.org/${paper.doi}`} />}
              {paper.arxivId && (
                <Meta
                  label="arXiv"
                  value={paper.arxivId}
                  href={`https://arxiv.org/abs/${paper.arxivId}`}
                />
              )}
              {paper.file && (
                <Meta
                  label="파일"
                  value={`${paper.file.name} · ${formatBytes(paper.file.size)}`}
                  href={fileUrl(paper.file.id)}
                />
              )}
            </dl>

            {tags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <span
                    key={t}
                    className="rounded-full bg-(--color-bg-2) px-2 py-0.5 text-[11px] text-(--color-fg-3) ring-1 ring-(--color-border-soft)"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}

            {paper.abstract && (
              <details className="mt-4 border-t border-(--color-border-soft) pt-3">
                <summary className="cursor-pointer text-[11px] tracking-wider text-(--color-fg-4) uppercase select-none">
                  초록
                </summary>
                <p className="mt-2 text-[12.5px] leading-relaxed break-keep whitespace-pre-wrap text-(--color-fg-2)">
                  {paper.abstract}
                </p>
              </details>
            )}
          </section>

          {/* 요약 */}
          <section className="flex min-h-[260px] flex-col rounded-[var(--radius-card)] bg-(--color-surface) p-6 ring-1 ring-(--color-border-soft)">
            <header className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-medium text-(--color-fg)">요약</h2>
                {summary?.source === "agent" && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full bg-(--color-accent-soft) px-1.5 py-0.5 text-[10px] text-(--color-accent-strong)"
                    title={summary.instruction ?? "에이전트가 만든 요약"}
                  >
                    <Sparkles className="h-2.5 w-2.5" />
                    에이전트
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={() => {
                  setDraft(summary?.body ?? "");
                  setEditing((v) => !v);
                }}
                className="flex items-center gap-1.5 rounded-full bg-(--color-bg-2) px-3 py-1.5 text-[11px] text-(--color-fg-2) ring-1 ring-(--color-border-soft) transition hover:bg-(--color-surface-hi)"
              >
                {editing ? <Eye className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
                {editing ? "보기" : "고치기"}
              </button>
            </header>

            {editing ? (
              <>
                <textarea
                  value={draft}
                  autoFocus
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") void saveSummary();
                  }}
                  placeholder="마크다운으로 적습니다. 제목(#), 목록(-), 굵게(**), 코드(`) 를 알아봅니다."
                  className="scrollbar-thin min-h-[220px] flex-1 resize-y rounded-lg bg-(--color-bg-2) p-3 font-mono text-[12.5px] leading-relaxed text-(--color-fg) ring-1 ring-(--color-border-soft) outline-none placeholder:text-(--color-fg-4) focus:ring-(--color-accent)/60"
                />
                <div className="mt-3 flex items-center justify-end gap-2">
                  <span className="mr-auto text-[10.5px] text-(--color-fg-4)">
                    Ctrl+Enter 로 저장
                    {summary?.source === "agent" && " · 고치면 사람이 쓴 글이 됩니다"}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(summary?.body ?? "");
                      setEditing(false);
                    }}
                    className="rounded-full bg-(--color-bg-2) px-4 py-1.5 text-xs text-(--color-fg-3) ring-1 ring-(--color-border-soft) hover:bg-(--color-surface-hi)"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveSummary()}
                    disabled={saving}
                    className="flex items-center gap-1.5 rounded-full bg-(--color-accent) px-4 py-1.5 text-xs font-medium text-(--color-bg) hover:bg-(--color-accent-strong) disabled:opacity-50"
                  >
                    {saving && <Loader2 className="h-3 w-3 animate-spin" />}
                    저장
                  </button>
                </div>
              </>
            ) : summary?.body?.trim() ? (
              <>
                <RichText
                  text={summary.body}
                  className="text-[13px] leading-relaxed text-(--color-fg-2)"
                />
                <p className="mt-4 border-t border-(--color-border-soft) pt-2 text-[10.5px] text-(--color-fg-4)">
                  {formatDateTime(summary.updatedAt)} 고침
                </p>
              </>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setDraft("");
                  setEditing(true);
                }}
                className="flex flex-1 flex-col items-center justify-center gap-2 text-(--color-fg-4) transition hover:text-(--color-fg-2)"
              >
                <Pencil className="h-5 w-5" />
                <span className="text-xs">아직 요약이 없습니다 — 눌러서 적기</span>
              </button>
            )}
          </section>
        </div>

        {/*
          PDF. 왼쪽 글을 굴려도 원문은 제자리에 있어야 하므로 sticky 다.
          높이는 화면에 맞춘다 — 논문은 한 쪽이 세로로 길어서, 창 높이를 다
          쓰지 않으면 한 번에 몇 줄밖에 안 보인다.
        */}
        <PdfFrame
          fileId={paper.file?.id ?? null}
          title={paper.title}
          className="h-[calc(100vh-8rem)] xl:sticky xl:top-6"
        />
      </div>

      <PaperSheet
        target={sheet}
        groups={groups}
        onClose={() => setSheet(null)}
        onSubmit={async (groupId, fields) => {
          await api.updatePaper(paper.id, { ...fields, groupId });
          // 서버가 다시 그려 준 값으로 화면을 맞춘다. 여기서 손으로 합치면
          // 서버가 다듬은 것(빈 제목 → "제목 없음")과 어긋난다.
          router.refresh();
        }}
      />

      {error && (
        <div className="fixed bottom-6 left-1/2 z-[60] flex max-w-[92vw] -translate-x-1/2 items-start gap-2 rounded-xl bg-(--color-surface) px-4 py-3 text-sm text-(--color-danger) shadow-xl ring-1 ring-(--color-danger)/40">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="grid h-5 w-5 shrink-0 place-items-center rounded text-(--color-fg-4) hover:text-(--color-fg-2)"
            aria-label="닫기"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </main>
  );
}

function Meta({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href?: string;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="w-12 shrink-0 text-[10.5px] tracking-wider text-(--color-fg-4) uppercase">
        {label}
      </dt>
      <dd className="min-w-0 flex-1 truncate text-(--color-fg-2)" title={value}>
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="underline decoration-dotted underline-offset-2 hover:text-(--color-fg)"
          >
            {value}
          </a>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}
