"use client";

/*
 * 인용문 상자 — 서지정보를 펼친 자리에 앉는다.
 *
 * 여기가 메우는 구멍: BibTeX·RIS 로 **내보내기**는 되는데 그건 서지관리기에게
 * 주는 것이다. 논문을 읽다가 APA 한 줄을 집어 지금 쓰던 문서에 붙이려면
 * 파일을 받아 Zotero 에 넣고 거기서 다시 복사해야 했다. 그 왕복을 없앤다.
 *
 * ## 왜 서버에서 CSL 을 다시 받아 오는가
 *
 * 화면이 이미 들고 있는 `PaperDTO` 로도 인용문을 만들 수는 있다. 하지만 그건
 * **사람이 보라고 눌러 담은 모양**이라 저자가 "Vaswani, Shazeer" 처럼 성만
 * 남은 한 줄이고, 권·호·쪽은 아예 자리가 없다(`csl.ts` 의 첫 주석). 그걸로
 * APA 를 뽑으면 "Vaswani, Shazeer. (2017)" 같은 것이 나오는데 — 오류가 아니라
 * 그럴싸하게 **틀린** 줄이다. 조용히 틀린 인용문을 내는 것이 여기서 제일
 * 피해야 할 일이라, 원본 CSL 을 쥐고 있는 서버에 한 번 물어본다.
 *
 * 물어보는 곳은 이미 있는 내보내기 라우트다 (`?format=csl`). 거기가 저장된
 * csl 과 사람이 고친 우리 컬럼을 합치는 규칙(`toCSL`)을 이미 담고 있어서,
 * 새 라우트를 파면 그 규칙이 두 벌이 된다.
 */

import { AlertTriangle, Check, Copy, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import {
  CITE_STYLES,
  DEFAULT_CITE_STYLE,
  formatCitation,
  isCiteStyleKey,
  type Citation,
  type CiteStyleKey,
} from "@/lib/cite";
import { readJson } from "@/lib/read-json";
import { bibExportUrl, type CSLItem } from "@/lib/types";
import { cn } from "@/lib/utils";

/*
 * 고른 스타일을 기억할 칸.
 *
 * `paperbento.` 접두어는 `preferences.ts` 의 `STORAGE_KEYS` 와 같은 이유다 —
 * 한 도메인에 `/paper` 와 `/memo` 를 나란히 얹으면 오리진이 같아지고,
 * localStorage 는 경로를 구분하지 않아 두 앱이 같은 칸을 쓰게 된다.
 *
 * `STORAGE_KEYS` 에 넣지 않고 여기 둔 것은 이 값이 인용문 상자 밖에서는
 * 아무 뜻이 없기 때문이다 (`paper-detail.tsx` 의 `SPLIT_KEY` 도 같다).
 */
const STYLE_KEY = "paperbento.citeStyle";

function readStylePref(): CiteStyleKey {
  try {
    const v = localStorage.getItem(STYLE_KEY);
    if (isCiteStyleKey(v)) return v;
  } catch {
    /* 사생활 보호 모드에서 localStorage 가 던진다. 기본값으로 간다. */
  }
  return DEFAULT_CITE_STYLE;
}

// ─────────────────────────────────────────────────────────────
//   복사
// ─────────────────────────────────────────────────────────────

/**
 * 인용문을 클립보드로. 되도록 **서식까지** 넘긴다.
 *
 * `text/html` 을 함께 실으면 워드나 구글 문서에 붙일 때 저널 이름의 기울임이
 * 살아 있다. 인용 형식에서 기울임은 장식이 아니라 규칙이라, 밋밋한 글로만
 * 주면 붙인 사람이 손으로 다시 기울여야 한다.
 *
 * 물러서는 길이 둘 더 있다.
 * 1. `ClipboardItem` 이 없는 브라우저 → `writeText` 로 글만.
 * 2. `navigator.clipboard` 자체가 없는 경우 → 옛 `execCommand`.
 *
 * 2번이 진짜로 필요하다. 클립보드 API 는 **보안 컨텍스트에서만** 있는데,
 * 이 앱은 집 서버에 `http://192.168.x.x:3000` 으로 얹는 일이 흔하다. 거기서는
 * `navigator.clipboard` 가 통째로 undefined 라, 이 갈래가 없으면 복사 단추가
 * 아무 말 없이 안 먹는다.
 */
async function copyCitation(text: string, html: string): Promise<boolean> {
  // ① 서식까지. 되면 여기서 끝난다.
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ]);
      return true;
    } catch {
      /*
       * 여기서 멈추지 않고 ② 로 내려간다. `ClipboardItem` 이 있어도 `text/html`
       * 을 거절하는 브라우저가 있어서(파이어폭스가 오래 그랬다), 이 갈래를
       * 안 두면 서식을 넘기려다 **글까지 못 넘기고** 끝난다.
       */
    }
  }

  // ② 글만.
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* 권한을 거절당했거나 창이 포커스를 잃었다. */
    }
  }

  // ③ 옛 길.
  return legacyCopy(text);
}

/** 밋밋한 글을 HTML 자리에 실을 때. `&` 를 먼저 바꾸지 않으면 뒤에서 또 바꾼다. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function legacyCopy(text: string): boolean {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    // 화면 밖으로 보내되 `display:none` 은 안 된다 — 안 보이는 요소는 고를 수 없다.
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.setAttribute("readonly", "");
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
//   citeproc 이 준 HTML 그리기
// ─────────────────────────────────────────────────────────────

type Mark = "i" | "b" | "sup" | "sub" | "sc";

const MARK_CLASS: Record<Mark, string> = {
  i: "italic",
  b: "font-semibold",
  sup: "align-super text-[0.8em]",
  sub: "align-sub text-[0.8em]",
  sc: "[font-variant:small-caps]",
};

/**
 * `&#38;` 같은 것을 글자로 되돌린다.
 *
 * citeproc 은 `&` 를 `&#38;` 로 내보낸다. 복사에 쓰는 글은 text 형식으로 따로
 * 받아 오므로 멀쩡하지만, 화면에 그리는 쪽은 HTML 조각이라 여기서 푼다.
 *
 * `&amp;` 를 **맨 마지막에** 푸는 것이 중요하다. 먼저 풀면 `&amp;lt;` 가
 * `&lt;` 를 거쳐 `<` 가 되어, 원문에 있던 꺾쇠가 태그처럼 되살아난다.
 */
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/**
 * 앞말에 받침이 있으면 "이", 없으면 "가".
 *
 * 모자란 칸 이름을 이어 붙여 문장을 만드는데, 그 마지막 낱말이 "연도" 일 때도
 * "실린 곳" 일 때도 있다. 하나로 박아 두면 "실린 곳가 비어 있습니다" 가 된다.
 */
function subjectJosa(word: string): "이" | "가" {
  const c = word.charCodeAt(word.length - 1);
  // 한글 음절이 아니면(숫자·영문으로 끝나는 이름이 생기면) 무난한 쪽으로.
  if (c < 0xac00 || c > 0xd7a3) return "가";
  return (c - 0xac00) % 28 === 0 ? "가" : "이";
}

const SMALL_CAPS_RE = /font-variant:\s*small-caps/i;

function markOf(tag: string, attrs: string): Mark | null {
  switch (tag.toLowerCase()) {
    case "i":
    case "em":
      return "i";
    case "b":
    case "strong":
      return "b";
    case "sup":
      return "sup";
    case "sub":
      return "sub";
    case "span":
      return SMALL_CAPS_RE.test(attrs) ? "sc" : null;
    default:
      return null;
  }
}

const TAG_RE = /<(\/?)([a-z]+)([^>]*)>/gi;

/**
 * citeproc 의 HTML 조각을 React 노드로.
 *
 * **`innerHTML` 을 쓰지 않는다.** 이 문자열은 남이 등록한 서지정보(제목·저널
 * 이름)에서 왔다. citeproc 이 이스케이프를 하기는 하지만, 그 한 겹만 믿고
 * 문서에 HTML 을 밀어 넣는 습관을 들이지 않는다 — 요약과 채팅을 그리는
 * `rich-text.tsx` 도 같은 이유로 노드를 세운다.
 *
 * 아는 태그(`i b em strong sup sub`, 작은대문자 `span`)만 서식으로 받고,
 * 나머지는 **버리지 않고 글자로도 남기지 않는다** — 태그는 지우고 안쪽 글만
 * 흘려보낸다. 인용문에 뜻 없는 꺾쇠가 박히는 것보다 낫다.
 */
function CitationText({ html }: { html: string }) {
  const nodes = useMemo(() => {
    const out: ReactNode[] = [];
    const stack: Mark[] = [];
    let cursor = 0;
    let key = 0;

    const push = (raw: string) => {
      if (!raw) return;
      const text = decodeEntities(raw);
      if (!text) return;
      if (!stack.length) {
        out.push(text);
        return;
      }
      // 안쪽부터 감싼다. 여러 겹이면 (기울임 안의 작은대문자) 클래스가 겹쳐 붙는다.
      out.push(
        <span key={key++} className={cn(stack.map((m) => MARK_CLASS[m]))}>
          {text}
        </span>,
      );
    };

    TAG_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TAG_RE.exec(html)) !== null) {
      push(html.slice(cursor, m.index));
      cursor = TAG_RE.lastIndex;

      const mark = markOf(m[2], m[3]);
      if (!mark) continue;
      if (m[1] === "/") {
        // 마지막 것부터 닫는다. 겹쳐 열린 같은 태그를 엉뚱하게 닫지 않으려고.
        const at = stack.lastIndexOf(mark);
        if (at >= 0) stack.splice(at, 1);
      } else {
        stack.push(mark);
      }
    }
    push(html.slice(cursor));
    return out;
  }, [html]);

  return <>{nodes}</>;
}

// ─────────────────────────────────────────────────────────────
//   상자
// ─────────────────────────────────────────────────────────────

export function CiteCopy({ paperId, hasCsl }: { paperId: string; hasCsl: boolean }) {
  const [style, setStyle] = useState<CiteStyleKey>(DEFAULT_CITE_STYLE);
  const [item, setItem] = useState<CSLItem | null>(null);
  const [cite, setCite] = useState<Citation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  /** 방금 복사한 것. "참고문헌" 인지 "본문 인용" 인지 나눠 표시한다. */
  const [copied, setCopied] = useState<"bib" | "in" | null>(null);

  /*
   * 고른 스타일은 첫 그림 뒤에 읽는다.
   *
   * `useState(readStylePref)` 로 하면 서버가 그린 것과 브라우저가 그린 것이
   * 달라져 hydration 이 어긋난다. 이 상자는 `ssr: false` 로 물려 있어 지금은
   * 안전하지만, 그 설정은 부르는 쪽에 있으므로 여기서 기대지 않는다.
   */
  useEffect(() => {
    setStyle(readStylePref());
  }, []);

  /* 원본 CSL 한 덩어리. 논문이 바뀌지 않는 화면이라 한 번만 받는다. */
  useEffect(() => {
    let alive = true;
    setBusy(true);
    setError(null);

    (async () => {
      try {
        const res = await fetch(bibExportUrl({ paperId, format: "csl" }), { cache: "no-store" });
        const list = await readJson<CSLItem[]>(res);
        if (!alive) return;
        const first = Array.isArray(list) ? list[0] : null;
        if (!first) throw new Error("이 논문의 서지정보를 찾지 못했습니다");
        setItem(first);
      } catch (e) {
        if (alive) {
          setError(e instanceof Error ? e.message : "서지정보를 받지 못했습니다");
          setBusy(false);
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, [paperId]);

  /* 항목이나 스타일이 바뀌면 다시 뽑는다. */
  useEffect(() => {
    if (!item) return;
    let alive = true;
    setBusy(true);

    formatCitation(item, style)
      .then((c) => {
        if (!alive) return;
        setCite(c);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setCite(null);
        setError(e instanceof Error ? e.message : "인용문을 만들지 못했습니다");
      })
      .finally(() => {
        if (alive) setBusy(false);
      });

    return () => {
      alive = false;
    };
  }, [item, style]);

  /* 복사했다는 표시는 잠깐만 둔다. */
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  const pick = useCallback((key: CiteStyleKey) => {
    setStyle(key);
    try {
      localStorage.setItem(STYLE_KEY, key);
    } catch {
      /* 못 기억해도 이번 화면에서는 바뀐다. */
    }
  }, []);

  const onCopy = useCallback(
    async (what: "bib" | "in") => {
      if (!cite) return;
      const text = what === "bib" ? cite.text : (cite.inText ?? "");
      if (!text) return;
      /*
       * 본문 인용은 citeproc 이 준 것이 밋밋한 글이다. 그걸 그대로 text/html
       * 자리에 실으면 "Smith & Sons" 의 `&` 가 실체 참조로 읽힐 여지가 생긴다 —
       * 붙여 넣는 쪽 파서에 달린 일이라, 우리가 먼저 HTML 로 만들어 넘긴다.
       */
      const html = what === "bib" ? cite.html : escapeHtml(text);
      const ok = await copyCitation(text, html);
      if (ok) setCopied(what);
      else setError("복사하지 못했습니다 — 아래 글을 직접 골라서 복사하세요.");
    },
    [cite],
  );

  return (
    <div className="mt-3 rounded-lg bg-(--color-bg-2) p-3 ring-1 ring-(--color-border-soft)">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="text-[11px] tracking-wider text-(--color-fg-4) uppercase">인용문</span>

        <div className="flex flex-wrap items-center gap-1">
          {CITE_STYLES.map((s) => (
            <button
              key={s.key}
              type="button"
              title={s.note}
              onClick={() => pick(s.key)}
              aria-pressed={style === s.key}
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] transition",
                style === s.key
                  ? "bg-(--color-accent-soft) text-(--color-accent-strong) ring-1 ring-(--color-accent)/40"
                  : "text-(--color-fg-4) hover:bg-(--color-surface-hi) hover:text-(--color-fg-2)",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>

        {busy && <Loader2 className="h-3 w-3 animate-spin text-(--color-fg-4)" />}
      </div>

      {error && (
        <p className="flex items-start gap-1.5 text-[11px] break-keep text-(--color-fg-3)">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-(--color-warn)" />
          <span>{error}</span>
        </p>
      )}

      {cite && (
        <>
          {/*
            고른 글을 그대로 쥘 수 있게 `select-text` 를 준다. 복사 단추가 막힌
            자리(클립보드 API 가 없는 http 배포에서 execCommand 마저 거절될 때)
            에서 사람이 손으로 긁어 갈 마지막 길이다.
          */}
          <p
            className="text-[12.5px] leading-relaxed break-keep text-(--color-fg-2) select-text"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            <CitationText html={cite.html} />
          </p>

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void onCopy("bib")}
              className="flex shrink-0 items-center gap-1.5 rounded-full bg-(--color-surface) px-3 py-1 text-[11px] text-(--color-fg-2) ring-1 ring-(--color-border-soft) transition hover:bg-(--color-surface-hi)"
            >
              {copied === "bib" ? (
                <Check className="h-3 w-3 text-(--color-accent-strong)" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
              {copied === "bib" ? "복사됨" : "복사"}
            </button>

            {/*
              본문 인용. 번호 매김 스타일(IEEE·Nature·AMA)에서는 없다 — 거기서
              본문 인용은 "[1]" 이고, 그 번호는 참고문헌 목록 안에서만 뜻이
              있어서 혼자 떼어 놓으면 아무것도 가리키지 않는다.
            */}
            {cite.inText && (
              <button
                type="button"
                onClick={() => void onCopy("in")}
                title="본문에 넣는 짧은 인용"
                className="flex min-w-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] text-(--color-fg-4) transition hover:bg-(--color-surface-hi) hover:text-(--color-fg-2)"
              >
                {copied === "in" ? (
                  <Check className="h-3 w-3 shrink-0 text-(--color-accent-strong)" />
                ) : (
                  <Copy className="h-3 w-3 shrink-0" />
                )}
                <span className="truncate font-mono">{cite.inText}</span>
              </button>
            )}
          </div>

          {(cite.missing.length > 0 || !hasCsl) && (
            <div className="mt-2.5 flex flex-col gap-1 border-t border-(--color-border-soft) pt-2">
              {cite.missing.length > 0 && (
                <p className="flex items-start gap-1.5 text-[11px] break-keep text-(--color-fg-3)">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-(--color-warn)" />
                  <span>
                    <b>{cite.missing.join(" · ")}</b>
                    {subjectJosa(cite.missing[cite.missing.length - 1])} 비어 있습니다. 인용
                    형식은 그 자리를 비운 채로도 한 줄을 만들어 내므로, 이대로 붙이면
                    틀린 인용이 됩니다 — 위의 <b>고치기</b> 로 채우거나 서지정보를 다시
                    찾아오세요.
                  </span>
                </p>
              )}
              {!hasCsl && (
                <p className="flex items-start gap-1.5 text-[11px] break-keep text-(--color-fg-4)">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>
                    원본 서지정보(CSL)가 없어 화면에 적힌 칸만으로 만들었습니다. 저자
                    이름이 성만 남고 권·호·쪽이 빠집니다 — <b>고치기</b> 에서 DOI 나
                    arXiv 번호로 한 번 찾아오면 온전해집니다.
                  </span>
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
