"use client";

import { AlertTriangle, Check, FileText, Loader2, Search, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { api, type PaperInput } from "@/lib/client-api";
import {
  coverUrl,
  formatBytes,
  paperUrl,
  type GroupDTO,
  type LookupReport,
  type LookupResult,
  type LookupSource,
  type PaperDTO,
} from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * 논문 등록·편집 시트.
 *
 * PDF 를 올린 **직후에 곧바로 열린다.** 파일 이름이 곧 논문 제목인 경우가
 * 거의 없기 때문이다 — `2310.06825v3.pdf` 를 그대로 서재에 꽂아 두면 나중에
 * 그게 무엇이었는지 알 길이 없고, 서지정보를 나중에 채우겠다는 다짐은
 * 지켜지지 않는다. 그래서 올린 자리에서 한 번 묻는다.
 *
 * 그때 시트는 **고치는 중**이지 만드는 중이 아니다. 논문 행은 업로드를 확정한
 * 서버가 이미 세웠다. 여기서 또 만들면 같은 PDF 를 가리키는 논문이 둘이 된다.
 * 다만 사람에게는 "등록" 으로 보여야 하므로 문구만 `fresh` 로 가른다.
 *
 * DOI·arXiv 번호를 적으면 이미 있는 논문인지 알려 주되 **막지는 않는다.**
 * 같은 논문을 두 서가에 두고 싶은 날이 오고, 에이전트가 틀린 DOI 를 제안하는
 * 날도 온다. 저장이 "제약 위반" 으로 죽는 것보다 알려 주고 맡기는 편이 낫다.
 */

export interface SheetTarget {
  /** 새로 만드는가(PDF 없이 서지정보만), 이미 있는 것을 고치는가. */
  mode: "create" | "edit";
  /** 고칠 논문 (mode === "edit"). */
  paper?: PaperDTO;
  /** 처음 놓일 서가. */
  groupId: string;
  /** 방금 올라온 것인가. 문구만 "등록" 으로 바꾼다. */
  fresh?: boolean;
}

/** 시트가 다루는 칸들. `PaperInput` 에서 화면이 안 건드리는 것을 뺀 것. */
type Fields = Required<
  Pick<
    PaperInput,
    "title" | "authors" | "venue" | "year" | "doi" | "arxivId" | "abstract" | "tags" | "url"
  >
> & {
  /**
   * 찾아온 서지정보의 **원본**(CSL-JSON 문자열).
   *
   * 다른 칸과 달리 `Required` 밖에 둔다 — 있을 때만 실려 나가야 하기 때문이다.
   * 서재 목록도 상세도 csl 본문은 안 받아 오므로(한 편에 1~2KB 라 무겁다) 시트가
   * 열릴 때 이 값은 **늘 비어 있다.** 이걸 다른 칸처럼 늘 실어 보내면 제목만
   * 고쳐 저장하는 순간 서버가 `csl: null` 을 받아 애써 받아 둔 원본을 지운다.
   * 그래서 찾아온 후보를 적용했을 때만 채운다.
   */
  csl?: string;
};

/** 찾아오기가 제안할 수 있는 칸. 태그는 바깥에서 오지 않는다. */
const SUGGEST_KEYS = [
  "title",
  "authors",
  "venue",
  "year",
  "doi",
  "arxivId",
  "url",
  "abstract",
] as const;
type SuggestKey = (typeof SUGGEST_KEYS)[number];

const SOURCE_LABEL: Record<LookupSource, string> = {
  doi: "DOI",
  arxiv: "arXiv",
  crossref: "제목 검색",
};

const EMPTY: Fields = {
  title: "",
  authors: null,
  venue: null,
  year: null,
  doi: null,
  arxivId: null,
  abstract: null,
  tags: null,
  url: null,
};

function fieldsOf(target: SheetTarget): Fields {
  const p = target.paper;
  if (!p) return EMPTY;
  return {
    title: p.title,
    authors: p.authors,
    venue: p.venue,
    year: p.year,
    doi: p.doi,
    arxivId: p.arxivId,
    abstract: p.abstract,
    tags: p.tags,
    url: p.url,
  };
}

export function PaperSheet({
  target,
  groups,
  onSubmit,
  onClose,
}: {
  target: SheetTarget | null;
  groups: GroupDTO[];
  onSubmit: (groupId: string, fields: Fields) => Promise<void>;
  onClose: () => void;
}) {
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [groupId, setGroupId] = useState("");
  const [busy, setBusy] = useState(false);
  const [dups, setDups] = useState<{ id: string; title: string }[]>([]);
  const titleRef = useRef<HTMLInputElement | null>(null);

  /*
   * 찾아오기 상태.
   *
   * `report` 는 거쳐 온 길까지 담고 있어서 실패했을 때도 버리지 않는다.
   * `picked` 는 사람이 고른 후보 — 제목으로 찾으면 후보가 여럿이라 우리가
   * 고르면 안 된다. 하나뿐이면 고를 것이 없으므로 저절로 정해진다.
   */
  const [lookupBusy, setLookupBusy] = useState(false);
  const [report, setReport] = useState<LookupReport | null>(null);
  const [picked, setPicked] = useState<LookupResult | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);

  // 열릴 때마다 값을 새로 심는다. 앞서 열었던 논문의 저자가 남아 있으면
  // 그걸 그대로 저장해 버리는 사고가 난다.
  useEffect(() => {
    if (!target) return;
    setFields(fieldsOf(target));
    setGroupId(target.groupId);
    setDups([]);
    // 앞 논문의 후보가 남아 있으면 남의 서지정보를 제안하게 된다.
    setReport(null);
    setPicked(null);
    setLookupError(null);
    setLookupBusy(false);
    // 방금 올린 것의 제목은 파일 이름에서 딴 짐작이라 거의 늘 고쳐야 한다.
    // 열자마자 통째로 골라 둔다 — 바로 덮어쓸 수 있게.
    queueMicrotask(() => titleRef.current?.select());
  }, [target]);

  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [target, onClose]);

  /*
   * 중복 찾기는 타이핑이 멎은 뒤에 한 번만 한다.
   *
   * DOI 는 30글자가 넘는다. 한 글자마다 물어보면 요청이 서른 번 나가고,
   * 그중 앞선 것이 늦게 도착해 "없음" 으로 덮는 일까지 생긴다.
   */
  const dupKey = `${fields.doi ?? ""}|${fields.arxivId ?? ""}`;
  useEffect(() => {
    if (!target) return;
    let alive = true;
    const timer = setTimeout(() => {
      void api
        .findDuplicates({
          doi: fields.doi,
          arxivId: fields.arxivId,
          // 고치는 중이라면 자기를 뺀다. 안 그러면 자기 DOI 를 자기가 겹친
          // 것으로 잡아 늘 경고가 뜬다.
          exceptId: target.paper?.id,
        })
        .then((hits) => alive && setDups(hits))
        .catch(() => undefined);
    }, 450);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // dupKey 하나만 본다 — 제목을 고칠 때마다 다시 물어볼 이유가 없다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dupKey, target]);

  /** 서가와 그 안의 칸을 한 줄로 편다. 고르는 자리에서는 두 단이면 충분하다. */
  const options = useMemo(
    () =>
      groups.flatMap((g) => [
        { id: g.id, label: g.name, depth: 0 },
        ...g.children.map((c) => ({ id: c.id, label: c.name, depth: 1 })),
      ]),
    [groups],
  );

  if (!target) return null;

  const set = <K extends keyof Fields>(k: K, v: Fields[K]) =>
    setFields((f) => ({ ...f, [k]: v }));

  // ── 찾아오기 ──────────────────────────────────────────────

  const canLookup =
    Boolean(fields.doi?.trim()) ||
    Boolean(fields.arxivId?.trim()) ||
    (fields.title?.trim().length ?? 0) >= 4;

  /**
   * 세 칸을 **함께** 보낸다. 무엇으로 찾을지는 서버가 정한다 (DOI → arXiv → 제목).
   *
   * 사람에게 "어느 것으로 찾을까요" 를 묻지 않는 이유는, 물어봤자 답이 늘
   * "있는 것으로" 이기 때문이다.
   */
  const runLookup = async () => {
    if (lookupBusy || !canLookup) return;
    setLookupBusy(true);
    setLookupError(null);
    setReport(null);
    setPicked(null);
    try {
      const r = await api.lookup({
        doi: fields.doi,
        arxiv: fields.arxivId,
        title: fields.title,
      });
      setReport(r);
      // 후보가 하나뿐이면 고를 것이 없다. 바로 제안으로 편다.
      if (r.candidates.length === 1) setPicked(r.candidates[0]);
    } catch (e) {
      setLookupError(e instanceof Error ? e.message : "찾아오기에 실패했습니다");
    } finally {
      setLookupBusy(false);
    }
  };

  const isBlank = (k: SuggestKey): boolean => {
    const v = fields[k];
    return v === null || v === undefined || String(v).trim() === "";
  };

  /**
   * 후보 하나를 그 칸에 넣는다. **csl 원본도 함께 붙인다.**
   *
   * 원본은 마지막으로 무언가를 가져온 후보의 것이 된다. 두 후보에서 한 칸씩
   * 집어 오면 원본과 우리 칸이 어긋날 수 있는데, 그래도 원본을 안 붙이는 것보다
   * 낫다 — 내보낼 때 `toCSL` 이 사람이 고친 우리 칸을 위에 덮기 때문에, 어긋난
   * 자리는 사람이 보고 있는 값으로 정리된다.
   */
  const applyOne = (k: SuggestKey) => {
    if (!picked) return;
    const v = picked.fields[k];
    if (v === null || v === undefined) return;
    setFields((f) => ({ ...f, [k]: v, csl: JSON.stringify(picked.csl) }) as Fields);
  };

  /** 머리의 "전부 적용". **이미 적힌 칸은 건드리지 않는다.** */
  const applyAll = () => {
    if (!picked) return;
    setFields((f) => {
      const next: Record<string, unknown> = { ...f, csl: JSON.stringify(picked.csl) };
      for (const k of SUGGEST_KEYS) {
        const v = picked.fields[k];
        if (v === null || v === undefined) continue;
        const cur = f[k];
        if (cur !== null && cur !== undefined && String(cur).trim() !== "") continue;
        next[k] = v;
      }
      return next as Fields;
    });
  };

  /** 빈 칸이면 찾아온 값을 회색 글씨(플레이스홀더)로 미리 보여 준다. */
  const ph = (k: SuggestKey, fallback: string): string => {
    const v = picked?.fields[k];
    return isBlank(k) && v !== null && v !== undefined ? String(v) : fallback;
  };

  /** 칸 밑에 붙는 적용 단추. 이미 같은 값이면 아무것도 안 띄운다. */
  const sug = (k: SuggestKey) => {
    const v = picked?.fields[k];
    if (v === null || v === undefined) return null;
    if (String(fields[k] ?? "").trim() === String(v).trim()) return null;
    return <SuggestRow blank={isBlank(k)} value={String(v)} onApply={() => applyOne(k)} />;
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onSubmit(groupId, fields);
      onClose();
    } catch {
      // 실패하면 시트를 닫지 않는다. 닫아 버리면 적어 둔 저자와 초록이
      // 통째로 사라지고, 다시 적으라고 할 수도 없다.
    } finally {
      setBusy(false);
    }
  };

  const registering = target.mode === "create" || target.fresh;
  const file = target.paper?.file ?? null;
  const cover = file ? coverUrl(file) : null;

  return (
    <div className="fixed inset-0 z-[70] flex justify-end">
      {/* 뒤를 눌러 닫는다. */}
      <button
        type="button"
        aria-label="닫기"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />

      <section
        role="dialog"
        aria-modal="true"
        aria-label={registering ? "논문 등록" : "서지정보 편집"}
        className="scrollbar-thin relative flex h-full w-[min(520px,100vw)] flex-col overflow-y-auto bg-(--color-surface) shadow-2xl ring-1 ring-(--color-border)"
        onKeyDown={(e) => {
          // 긴 초록을 적다가 Enter 로 저장되면 안 되므로 Ctrl+Enter 로만 확정한다.
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") void submit();
        }}
      >
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-(--color-border-soft) bg-(--color-surface) px-5 py-4">
          <h2 className="text-base font-medium text-(--color-fg)">
            {registering ? "논문 등록" : "서지정보 편집"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="grid h-7 w-7 place-items-center rounded-md text-(--color-fg-4) hover:bg-(--color-surface-hi) hover:text-(--color-fg-2)"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex flex-col gap-4 px-5 py-5">
          {/* 붙은 파일 */}
          {file && (
            <div className="flex items-center gap-3 rounded-lg bg-(--color-bg-2) p-3 ring-1 ring-(--color-border-soft)">
              <div className="thumb-checker grid h-[58px] w-[41px] shrink-0 place-items-center overflow-hidden rounded ring-1 ring-(--color-border-soft)">
                {cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={cover} alt="" className="h-full w-full object-cover" />
                ) : (
                  <FileText className="h-4 w-4 text-(--color-fg-4)" />
                )}
              </div>
              <div className="min-w-0">
                <div className="truncate text-xs text-(--color-fg-2)" title={file.name}>
                  {file.name}
                </div>
                <div className="font-mono text-[10.5px] text-(--color-fg-4)">
                  {formatBytes(file.size)}
                </div>
              </div>
            </div>
          )}

          <Field label="제목" required suggestion={sug("title")}>
            <input
              ref={titleRef}
              value={fields.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder={ph("title", "논문 제목")}
              className={INPUT}
            />
          </Field>

          <Field
            label="저자"
            hint="사람이 읽는 한 줄로 적습니다. 쉼표로 나누면 보기 좋습니다"
            suggestion={sug("authors")}
          >
            <input
              value={fields.authors ?? ""}
              onChange={(e) => set("authors", e.target.value || null)}
              placeholder={ph("authors", "Vaswani, Shazeer, Parmar…")}
              className={INPUT}
            />
          </Field>

          <div className="grid grid-cols-[1fr_110px] gap-3">
            <Field label="학회 · 저널" suggestion={sug("venue")}>
              <input
                value={fields.venue ?? ""}
                onChange={(e) => set("venue", e.target.value || null)}
                placeholder={ph("venue", "NeurIPS")}
                className={INPUT}
              />
            </Field>
            <Field label="연도" suggestion={sug("year")}>
              <input
                value={fields.year ?? ""}
                inputMode="numeric"
                onChange={(e) => {
                  // 서버가 1000~3000 만 받는다. 네 자리로 잘라 두면 "20177"
                  // 같은 오타가 저장 단계까지 가지 않는다.
                  const raw = e.target.value.replace(/[^0-9]/g, "").slice(0, 4);
                  set("year", raw ? Number(raw) : null);
                }}
                placeholder={ph("year", "2017")}
                className={INPUT}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="DOI" suggestion={sug("doi")}>
              <input
                value={fields.doi ?? ""}
                onChange={(e) => set("doi", e.target.value.trim() || null)}
                placeholder={ph("doi", "10.1145/3292500")}
                className={INPUT}
              />
            </Field>
            <Field label="arXiv" suggestion={sug("arxivId")}>
              <input
                value={fields.arxivId ?? ""}
                onChange={(e) => set("arxivId", e.target.value.trim() || null)}
                placeholder={ph("arxivId", "1706.03762")}
                className={INPUT}
              />
            </Field>
          </div>

          {/*
            찾아오기.
            DOI·arXiv 칸 바로 밑에 둔다 — 그 두 칸이 이 단추의 재료이고,
            누른 결과가 바로 위 칸들로 흘러 들어가는 것이 눈에 보여야 한다.
          */}
          <div className="flex flex-col gap-2.5 rounded-lg bg-(--color-bg-2) px-3 py-3 ring-1 ring-(--color-border-soft)">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void runLookup()}
                disabled={lookupBusy || !canLookup}
                className="flex shrink-0 items-center gap-1.5 rounded-full bg-(--color-surface-hi) px-3 py-1.5 text-xs font-medium text-(--color-fg-2) ring-1 ring-(--color-border-soft) transition hover:bg-(--color-surface) disabled:opacity-40"
              >
                {lookupBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Search className="h-3.5 w-3.5" />
                )}
                찾아오기
              </button>
              <p className="min-w-0 flex-1 text-[10.5px] leading-snug break-keep text-(--color-fg-4)">
                DOI → arXiv → 제목 차례로 바깥에서 찾습니다.
              </p>
              {picked && (
                <button
                  type="button"
                  onClick={applyAll}
                  className="flex shrink-0 items-center gap-1 rounded-full bg-(--color-accent)/15 px-2.5 py-1 text-[11px] font-medium text-(--color-accent) transition hover:bg-(--color-accent)/25"
                >
                  <Check className="h-3 w-3" />
                  전부 적용
                </button>
              )}
            </div>

            {/*
              후보가 여럿일 때는 **우리가 고르지 않는다.**
              제목 검색은 1등이 맞다는 보장이 없고, 틀린 것을 조용히 채워 넣으면
              사람은 그게 자기가 적은 값인 줄 안다.
            */}
            {report && report.candidates.length > 1 && (
              <div className="flex flex-col gap-1.5">
                <div className="text-[10.5px] text-(--color-fg-4)">
                  후보 {report.candidates.length}개 — 맞는 것을 고르세요
                </div>
                {report.candidates.map((c, i) => (
                  <button
                    key={`${c.fields.doi ?? c.fields.title ?? i}`}
                    type="button"
                    onClick={() => setPicked(c)}
                    aria-pressed={picked === c}
                    className={cn(
                      "flex flex-col gap-0.5 rounded-md px-2.5 py-2 text-left ring-1 transition",
                      picked === c
                        ? "bg-(--color-accent)/10 ring-(--color-accent)/50"
                        : "bg-(--color-surface) ring-(--color-border-soft) hover:bg-(--color-surface-hi)",
                    )}
                  >
                    <span className="line-clamp-2 text-[11.5px] leading-snug text-(--color-fg-2)">
                      {c.fields.title ?? "제목 없음"}
                    </span>
                    <span className="truncate text-[10.5px] text-(--color-fg-4)">
                      {[c.fields.authors, c.fields.venue, c.fields.year]
                        .filter(Boolean)
                        .join(" · ") || SOURCE_LABEL[c.source]}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {picked && (
              <p className="text-[10.5px] leading-snug break-keep text-(--color-fg-4)">
                빈 칸에 회색으로 미리 들어가 있습니다. 이미 적어 둔 칸은 그대로 두고,
                덮으려면 그 칸의 단추를 누르세요. 적용하면 받아 온 <b>원본</b>도 함께
                저장되어 BibTeX 내보내기가 온전해집니다.
              </p>
            )}

            {/*
              어디서 넘어졌는지 그대로 보여 준다.
              "찾지 못했습니다" 한 줄이면 DOI 를 잘못 적은 것인지, 저쪽이 느려
              끊긴 것인지, 등록기관이 CSL 을 안 주는 것인지 알 수가 없다.
            */}
            {(report?.steps.length || lookupError) && (
              <ul className="flex flex-col gap-0.5">
                {report?.steps.map((s, i) => (
                  <li
                    key={`${s.source}-${i}`}
                    className={cn(
                      "text-[10.5px] leading-snug break-keep",
                      s.ok ? "text-(--color-fg-4)" : "text-(--color-warn)",
                    )}
                  >
                    {SOURCE_LABEL[s.source]} · {s.note}
                  </li>
                ))}
                {lookupError && (
                  <li className="text-[10.5px] leading-snug break-keep text-(--color-danger)">
                    {lookupError}
                  </li>
                )}
              </ul>
            )}
          </div>

          {dups.length > 0 && (
            <div className="flex flex-col gap-1 rounded-lg bg-(--color-warn)/10 px-3 py-2.5 ring-1 ring-(--color-warn)/40">
              <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-(--color-warn)">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                같은 번호의 논문이 이미 있습니다
              </div>
              {dups.map((d) => (
                <Link
                  key={d.id}
                  href={paperUrl(d.id)}
                  className="truncate pl-5 text-[11.5px] text-(--color-fg-3) underline decoration-dotted hover:text-(--color-fg)"
                  title={d.title}
                >
                  {d.title}
                </Link>
              ))}
              <p className="pl-5 text-[10.5px] text-(--color-fg-4)">
                그래도 등록할 수 있습니다 — 같은 논문을 여러 서가에 둘 수 있습니다.
              </p>
            </div>
          )}

          <Field label="원문 주소" suggestion={sug("url")}>
            <input
              value={fields.url ?? ""}
              onChange={(e) => set("url", e.target.value.trim() || null)}
              placeholder={ph("url", "https://arxiv.org/abs/1706.03762")}
              className={INPUT}
            />
          </Field>

          <Field label="태그" hint="쉼표로 나눕니다">
            <input
              value={fields.tags ?? ""}
              onChange={(e) => set("tags", e.target.value || null)}
              placeholder="transformer, attention"
              className={INPUT}
            />
          </Field>

          <Field label="초록" suggestion={sug("abstract")}>
            <textarea
              value={fields.abstract ?? ""}
              onChange={(e) => set("abstract", e.target.value || null)}
              rows={5}
              placeholder={ph("abstract", "붙여 넣어 두면 나중에 찾기 쉽습니다")}
              className={cn(INPUT, "scrollbar-thin resize-y leading-relaxed")}
            />
          </Field>

          <Field label="꽂을 자리">
            <select
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              className={INPUT}
            >
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.depth === 1 ? `  └ ${o.label}` : o.label}
                </option>
              ))}
            </select>
          </Field>

          {/*
            에이전트에게 서지정보를 맡기는 자리. 3단계 몫이라 지금은 꺼 둔다.
            (`app_config.agentSuggestDefault` 가 그 기본값을 이미 들고 있다.)
            자리를 아예 비워 두지 않는 것은, 나중에 생기면 어디에 붙을지 지금
            정해 두는 편이 화면 짜임을 두 번 뒤집지 않기 때문이다.
          */}
          <div className="flex items-start gap-3 rounded-lg bg-(--color-bg-2) px-3 py-3 opacity-70 ring-1 ring-(--color-border-soft)">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-(--color-fg-4)" />
            <div className="min-w-0 flex-1">
              <div className="text-xs text-(--color-fg-3)">에이전트가 서지정보 채우기</div>
              <p className="mt-0.5 text-[10.5px] break-keep text-(--color-fg-4)">
                PDF 첫 쪽을 읽어 제목·저자·연도를 짐작해 넣습니다.{" "}
                <b className="text-(--color-fg-3)">3단계에서 켜집니다.</b>
              </p>
            </div>
            <input
              type="checkbox"
              disabled
              checked={false}
              readOnly
              aria-label="에이전트가 서지정보 채우기 (3단계에서 켜집니다)"
              className="mt-0.5 h-4 w-4 shrink-0 cursor-not-allowed rounded border-(--color-border) bg-(--color-bg-2)"
            />
          </div>
        </div>

        <footer className="sticky bottom-0 mt-auto flex items-center justify-end gap-2 border-t border-(--color-border-soft) bg-(--color-surface) px-5 py-4">
          <span className="mr-auto text-[10.5px] text-(--color-fg-4)">Ctrl+Enter 로 저장</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-(--color-bg-2) px-4 py-2 text-sm text-(--color-fg-3) ring-1 ring-(--color-border-soft) transition hover:bg-(--color-surface-hi)"
          >
            {/* 방금 올린 것은 이미 서재에 있다. "취소" 라고 하면 올린 것이
                없던 일이 되는 줄 안다. */}
            {target.fresh ? "나중에" : "취소"}
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            className="flex items-center gap-2 rounded-full bg-(--color-accent) px-5 py-2 text-sm font-medium text-(--color-bg) transition hover:bg-(--color-accent-strong) disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {registering ? "서재에 꽂기" : "저장"}
          </button>
        </footer>
      </section>
    </div>
  );
}

const INPUT =
  "w-full rounded-lg bg-(--color-bg-2) px-3 py-2 text-sm text-(--color-fg) ring-1 ring-(--color-border-soft) outline-none placeholder:text-(--color-fg-4) focus:ring-(--color-accent)/60";

/**
 * 이름표와 칸 한 벌.
 *
 * 바깥이 `<label>` 이 아니라 `<div>` 인 것은 제안 단추 때문이다. `<label>` 안의
 * 단추를 누르면 브라우저가 딸린 칸까지 함께 눌러(포커스) 버려서, "적용" 을 눌렀는데
 * 커서가 엉뚱한 칸으로 뛰는 일이 생긴다. 그래서 이름표와 칸만 `<label>` 로 묶고
 * 제안 줄은 그 바깥에 둔다.
 */
function Field({
  label,
  hint,
  required,
  suggestion,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  /** 찾아온 값을 이 칸에 넣는 줄. 제안이 없으면 null. */
  suggestion?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label className="flex flex-col gap-1.5">
        <span className="text-[11px] font-medium tracking-wider text-(--color-fg-4) uppercase">
          {label}
          {required && <span className="ml-1 text-(--color-accent)">*</span>}
        </span>
        {children}
      </label>
      {hint && <span className="text-[10.5px] break-keep text-(--color-fg-4)">{hint}</span>}
      {suggestion}
    </div>
  );
}

/**
 * 찾아온 값을 이 칸에 넣는 줄.
 *
 * 빈 칸이면 값이 이미 회색 글씨로 칸 안에 보이므로 단추만 있으면 된다.
 * **사람이 적어 둔 칸은 다르다** — 무엇으로 바뀌는지 보여 주고, 단추 이름도
 * "덮어쓰기" 로 말한다. 적어 둔 것이 소리 없이 사라지는 것이 가장 나쁘다.
 */
function SuggestRow({
  blank,
  value,
  onApply,
}: {
  blank: boolean;
  value: string;
  onApply: () => void;
}) {
  return (
    <div className="flex items-start gap-2">
      <p className="min-w-0 flex-1 text-[10.5px] leading-snug text-(--color-fg-4)">
        {blank ? (
          <span>찾아온 값이 회색으로 들어 있습니다</span>
        ) : (
          <span className="line-clamp-2 break-all">
            찾아온 값: <span className="text-(--color-fg-3)">{value}</span>
          </span>
        )}
      </p>
      <button
        type="button"
        onClick={onApply}
        className={cn(
          "shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium transition",
          blank
            ? "bg-(--color-accent)/15 text-(--color-accent) hover:bg-(--color-accent)/25"
            : "bg-(--color-warn)/15 text-(--color-warn) hover:bg-(--color-warn)/25",
        )}
      >
        {blank ? "적용" : "덮어쓰기"}
      </button>
    </div>
  );
}

export type { Fields as PaperSheetFields };
