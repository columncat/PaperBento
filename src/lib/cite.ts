"use client";

/*
 * 인용문 한 줄 만들기 — citeproc-js 를 감싼다.
 *
 * 내보내기(`csl.ts`)와 무엇이 다른가. 저쪽은 **기계에게 주는 것**이다 —
 * .bib 파일을 서지관리기가 읽어 가서 제 형식으로 다시 그린다. 여기는 **사람이
 * 그대로 붙여 넣을 글**이다. "Vaswani, A., Shazeer, N., & Parmar, N. (2017)…"
 * 처럼 쉼표 하나 괄호 하나까지 그 판(APA·IEEE…)이 정한 대로 찍혀야 한다.
 *
 * 그 규칙을 손으로 짜지 않는다. APA 7판만 해도 저자가 스물을 넘을 때 어떻게
 * 줄이는지, 편저서의 쪽 표기가 어떻게 다른지 같은 것이 수백 갈래고, 판이
 * 바뀔 때마다 따라가야 한다. 그건 CSL 이라는 표준과 그것을 읽는 citeproc-js
 * 가 이미 하는 일이다. 우리는 CSL-JSON 한 덩어리를 넣고 글을 받아 온다.
 *
 * ## 브라우저에서 돈다
 *
 * citeproc 은 순수 JS 라 서버에서도 되지만 여기서는 브라우저다. 서버로 두면
 * 스타일을 바꿀 때마다 왕복이 생기는데, 그건 사람이 APA 와 IEEE 를 번갈아
 * 눌러 보는 자리다 — 누르는 즉시 바뀌어야 한다. 대신 번들이 1MB 급이라
 * (`citeproc_commonjs.js` 하나가 967KB) **처음 쓸 때 비로소 받아 온다.**
 * 이 파일이 정적 import 를 쓰지 않고 `import()` 로 쥐는 이유다.
 *
 * ## 왜 이 파일이 상태를 들고 있는가
 *
 * 셋을 캐시한다 — 받아 온 XML, citeproc 모듈, 세워 둔 엔진. 엔진 하나를
 * 세우려면 86KB 짜리 `apa.csl` 을 통째로 파싱해야 하는데, 스타일 단추를
 * 눌러 볼 때마다 그걸 다시 하면 누를 때마다 화면이 멎는다.
 */

import { apiPath } from "./api-path";
import { arxivIdOf, venueOf, yearOf, type CSLItem } from "./csl";

// ─────────────────────────────────────────────────────────────
//   스타일 목록
// ─────────────────────────────────────────────────────────────

/*
 * 어느 스타일을 싣는지, 왜 이것들인지, Vancouver 가 왜 빠졌는지는
 * `public/csl/README.md` 에 적어 두었다 — 파일이 그 폴더에 있으므로
 * 출처·라이선스와 함께 거기서 읽는 편이 낫다.
 *
 * 여기 한 줄과 `public/csl/` 의 파일 하나가 짝이다. 늘리려면 둘 다.
 */
export const CITE_STYLES = [
  { key: "apa", label: "APA", file: "apa.csl", note: "APA 7판" },
  { key: "ieee", label: "IEEE", file: "ieee.csl", note: "IEEE" },
  {
    key: "chicago",
    label: "Chicago",
    file: "chicago-author-date.csl",
    note: "시카고 18판 (저자-연도)",
  },
  { key: "mla", label: "MLA", file: "modern-language-association.csl", note: "MLA 9판" },
  { key: "nature", label: "Nature", file: "nature.csl", note: "Nature" },
  { key: "ama", label: "AMA", file: "american-medical-association.csl", note: "AMA 11판" },
] as const;

export type CiteStyleKey = (typeof CITE_STYLES)[number]["key"];

export const DEFAULT_CITE_STYLE: CiteStyleKey = "apa";

export function isCiteStyleKey(v: unknown): v is CiteStyleKey {
  return typeof v === "string" && CITE_STYLES.some((s) => s.key === v);
}

// ─────────────────────────────────────────────────────────────
//   citeproc 이 요구하는 모양
// ─────────────────────────────────────────────────────────────

/*
 * citeproc 은 타입 선언을 싣지 않고 `@types/citeproc` 도 없다. 우리가 실제로
 * 부르는 넷만 여기 적는다 — 전부를 옮겨 적을 이유가 없고, 옮겨 적으면 판이
 * 오를 때 조용히 거짓말이 된다.
 */
interface BibMeta {
  /**
   * 번호 매김 스타일이 참고문헌 앞에 다는 표(`[1]`, `1.`)를 따로 흘려 놓았는가.
   * 값이 있으면 출력에 `csl-left-margin` 칸이 생긴다 — 우리는 그걸 떼어 낸다.
   */
  "second-field-align"?: string | false;
  bibliography_errors?: string[];
}

interface CiteprocEngine {
  updateItems(ids: string[]): void;
  setOutputFormat(format: "html" | "text" | "rtf"): void;
  /** 참고문헌. 만들 수 없으면 **예외가 아니라** `false` 를 준다. */
  makeBibliography(): [BibMeta, string[]] | false;
  /** 본문 인용 한 덩어리. */
  makeCitationCluster(items: { id: string }[]): string;
}

interface CiteprocSys {
  retrieveItem(id: string): CSLItem | undefined;
  /** **동기여야 한다.** 아래 `ensureLocales` 가 있는 이유가 이것이다. */
  retrieveLocale(lang: string): string | undefined;
}

interface CiteprocModule {
  Engine: new (
    sys: CiteprocSys,
    style: string,
    lang?: string,
    forceLang?: boolean,
  ) => CiteprocEngine;
}

// ─────────────────────────────────────────────────────────────
//   자산 받아 오기
// ─────────────────────────────────────────────────────────────

/**
 * 받아 온 XML. **문자열이 아니라 Promise 를 담는다.**
 *
 * 문자열을 담으면 스타일 단추 여럿을 빠르게 눌렀을 때 같은 파일을 두세 번
 * 받아 온다. Promise 를 담아 두면 두 번째부터는 진행 중인 그것을 함께 기다린다.
 */
const assets = new Map<string, Promise<string>>();

function fetchAsset(name: string): Promise<string> {
  const hit = assets.get(name);
  if (hit) return hit;

  const p = fetch(apiPath(`/csl/${name}`), { cache: "force-cache" }).then(async (res) => {
    if (!res.ok) throw new Error(`인용 스타일을 받지 못했습니다 (${name}, ${res.status})`);
    const text = await res.text();
    /*
     * 배포가 어긋나 404 페이지가 200 으로 오는 일이 있다(`read-json.ts` 가
     * 같은 것을 API 쪽에서 겪었다). XML 이 아니면 citeproc 이 한참 뒤에
     * 알아볼 수 없는 오류로 죽으므로 여기서 막고 이름을 대 준다.
     */
    if (!text.trimStart().startsWith("<")) {
      throw new Error(`인용 스타일이 XML 이 아닙니다 (${name})`);
    }
    return text;
  });

  // 실패한 것은 캐시에 남기지 않는다 — 한 번 끊긴 것 때문에 영영 못 쓰게 된다.
  p.catch(() => assets.delete(name));
  assets.set(name, p);
  return p;
}

/** 미리 받아 둔 로케일. `retrieveLocale` 이 동기라 **여기서만** 읽는다. */
const locales = new Map<string, string>();

const BASE_LOCALE = "en-US";
const DEFAULT_LOCALE_RE = /\bdefault-locale="([^"]+)"/;

/**
 * 스타일이 쓸 로케일을 **엔진을 세우기 전에** 받아 둔다.
 *
 * citeproc 의 `sys.retrieveLocale` 은 동기다. 그 안에서 fetch 를 기다릴 길이
 * 없으므로, 무엇이 필요한지 미리 알아내어 손에 쥐고 있어야 한다. 알아내는
 * 길은 스타일 XML 의 `default-locale` 뿐이고, 안 적혀 있으면 en-US 다.
 *
 * 겪은 것: 여섯 중 `nature.csl` 만 `default-locale="en-GB"` 였다. en-US 하나만
 * 쥐고 있었을 때는 **오류 없이 미국식 용어로 조용히 찍혔다.** 인용문에서는
 * 조용한 오류가 제일 나쁘다 — 틀린 줄 모르고 논문에 붙는다.
 */
async function ensureLocales(styleXml: string): Promise<void> {
  const declared = DEFAULT_LOCALE_RE.exec(styleXml)?.[1];
  const want = declared && declared !== BASE_LOCALE ? [BASE_LOCALE, declared] : [BASE_LOCALE];

  await Promise.all(
    want
      .filter((lang) => !locales.has(lang))
      .map(async (lang) => {
        try {
          locales.set(lang, await fetchAsset(`locales-${lang}.xml`));
        } catch (e) {
          /*
           * 안 실린 로케일이면 en-US 로 물러선다(`retrieveLocale` 이 그렇게
           * 짜여 있다). 여기서 죽이면 스타일 하나 때문에 인용문 상자가 통째로
           * 비는데, 용어 몇 개가 미국식인 편이 낫다. en-US 자체가 없으면 그건
           * 배포가 깨진 것이므로 그대로 올려 보낸다.
           */
          if (lang === BASE_LOCALE) throw e;
          console.warn(`[cite] ${lang} 로케일이 없습니다 — en-US 로 갑니다`);
        }
      }),
  );
}

// ─────────────────────────────────────────────────────────────
//   엔진
// ─────────────────────────────────────────────────────────────

let citeprocModule: Promise<CiteprocModule> | null = null;

function loadCiteproc(): Promise<CiteprocModule> {
  if (!citeprocModule) {
    /*
     * 여기서만 부른다. 정적 import 로 바꾸면 967KB 가 상세 화면 첫 묶음에
     * 딸려 들어간다 — 서지정보를 펴지 않는 사람에게는 한 번도 안 쓰이는 무게다.
     */
    /*
     * `@ts-expect-error` 인 이유: citeproc 은 타입 선언을 싣지 않고
     * `@types/citeproc` 도 없다(npm 에 아예 없다). 모양은 위 `CiteprocModule`
     * 에 우리가 적어 두었으므로, 여기서는 "선언이 없다"는 것 하나만 눌러 둔다.
     * `.d.ts` 를 따로 두는 대신 이 파일 안에 붙여 두는 것은 citeproc 을 아는
     * 곳이 여기 하나뿐이기 때문이다 — 언젠가 선언이 생기면 이 줄이 "쓰이지
     * 않은 지시" 로 빨개져서 알려 준다.
     */
    // @ts-expect-error
    const loading = import("citeproc") as Promise<unknown>;

    citeprocModule = loading.then((m) => {
      // `module.exports = CSL` 인 CJS 라, 번들러에 따라 default 에 들어온다.
      const mod = (m as { default?: CiteprocModule }).default ?? (m as CiteprocModule);
      if (typeof mod?.Engine !== "function") throw new Error("citeproc 을 읽지 못했습니다");
      return mod;
    });
    citeprocModule.catch(() => {
      citeprocModule = null;
    });
  }
  return citeprocModule;
}

/**
 * 지금 그리는 항목.
 *
 * `sys.retrieveItem` 은 엔진을 세울 때 한 번 묶이는데, 엔진은 스타일마다
 * 캐시해 두고 다시 쓴다. 그래서 항목을 엔진에 매지 않고 **밖에 두고 갈아
 * 끼운다.** 아래 `formatCitation` 은 이 값을 세운 뒤 `await` 없이 끝까지
 * 달리므로, 두 호출이 겹쳐도 서로의 항목을 보는 일이 없다.
 */
let current: CSLItem | null = null;

/**
 * citeproc 에게 줄 항목 이름. **매번 새로 뽑는다.**
 *
 * 처음에는 `"cite"` 로 고정해 두었다. 한 번에 한 편만 그리니 이름이 하나면
 * 될 것 같았는데, **그게 조용히 틀린 인용문을 냈다.**
 *
 * citeproc 은 제 레지스트리에 항목을 이름으로 담아 두고, `updateItems` 에
 * **이미 있는 이름**이 오면 "그 항목이 그대로구나" 하고 `sys.retrieveItem` 을
 * 다시 부르지 않는다. 엔진을 스타일마다 캐시해 두고 다시 쓰는 우리 구조에서는
 * 그 말이 곧 **논문 A 를 본 뒤 B 를 열면 B 자리에 A 의 인용문이 그려진다**는
 * 뜻이다. 상세 화면끼리는 클라이언트 이동이라 이 모듈이 살아 있으므로 진짜로
 * 일어난다. 오류도 안 뜨고, 그럴싸한 한 줄이라 알아채기도 어렵다.
 *
 * 이름을 매번 새로 뽑으면 레지스트리가 새 항목으로 보고 다시 물어본다.
 * `updateItems` 는 목록에 없는 이름을 버리므로 옛것이 쌓이지도 않는다.
 */
let seq = 0;
const nextItemId = () => `cite-${++seq}`;

const sys: CiteprocSys = {
  retrieveItem: () => current ?? undefined,
  retrieveLocale: (lang) => locales.get(lang) ?? locales.get(BASE_LOCALE),
};

const engines = new Map<CiteStyleKey, Promise<CiteprocEngine>>();

function getEngine(key: CiteStyleKey): Promise<CiteprocEngine> {
  const hit = engines.get(key);
  if (hit) return hit;

  const style = CITE_STYLES.find((s) => s.key === key);
  if (!style) return Promise.reject(new Error(`모르는 인용 스타일입니다 (${key})`));

  const p = (async () => {
    const [CSL, xml] = await Promise.all([loadCiteproc(), fetchAsset(style.file)]);
    await ensureLocales(xml);
    /*
     * 언어를 넘기지 않는다. 넘기면 스타일이 제 `default-locale` 로 정해 둔
     * 것을 덮어써서 Nature 를 미국식으로 찍게 만든다. 비워 두면 스타일이
     * 이기고, 그게 맞다.
     */
    return new CSL.Engine(sys, xml);
  })();

  p.catch(() => engines.delete(key));
  engines.set(key, p);
  return p;
}

// ─────────────────────────────────────────────────────────────
//   다듬기
// ─────────────────────────────────────────────────────────────

/*
 * citeproc 이 참고문헌 한 항목을 내놓는 모양은 두 가지다.
 *
 *   <div class="csl-entry">Vaswani, A. …</div>
 *
 *   <div class="csl-entry">
 *     <div class="csl-left-margin">[1]</div>
 *     <div class="csl-right-inline">A. Vaswani …</div>
 *   </div>
 *
 * 두 번째가 번호 매김 스타일(IEEE·Nature·AMA)이다. 벗기는 순서가 중요하다 —
 * `csl-entry` 껍데기를 **먼저** 벗겨야 `csl-left-margin` 이 맨 앞에 온다.
 * (겪은 것: 순서를 반대로 두었더니 `^` 앵커가 `csl-entry` 에 막혀 번호가
 * 그대로 남았고, 화면에는 `[1]Vaswani…` 가 찍혔다.)
 */
const ENTRY_OPEN_RE = /^\s*<div class="csl-entry">/;
const ENTRY_CLOSE_RE = /<\/div>\s*$/;
const LEFT_MARGIN_RE = /^\s*<div class="csl-left-margin">([\s\S]*?)<\/div>\s*/;
const RIGHT_INLINE_RE = /<div class="csl-right-inline">([\s\S]*?)<\/div>/;

/**
 * 항목 하나를 화면에 그릴 조각과 복사할 글로 다듬는다.
 *
 * 하는 일이 둘인데 한 함수에 있다. 앞에 붙는 번호(`[1]` `1.`)를 **글 쪽에서도**
 * 떼야 하는데, 뗄 값을 알아내는 곳이 HTML 쪽이라 둘을 함께 쥐고 있어야 한다.
 *
 * 왜 번호를 떼는가. **그 번호는 목록 안에서만 뜻이 있다.** 우리는 한 편만
 * 그리므로 언제나 1 이고, 그대로 복사해 붙이면 문서에서 몇 번째에 놓이든
 * `[1]` 이 박힌다. 워드든 LaTeX 든 번호는 목록 쪽이 매기는 것이다.
 *
 * 글 쪽을 정규식으로 짐작하지 않는 이유: "1998년…" 처럼 진짜 숫자로 시작하는
 * 제목을 잘라 먹는다. HTML 에서 읽어 낸 그 값이 앞에 있을 때만 뗀다.
 */
function cleanEntry(rawHtml: string, rawText: string): { html: string; text: string } {
  let html = rawHtml.replace(ENTRY_OPEN_RE, "").replace(ENTRY_CLOSE_RE, "").trim();
  let text = rawText.trimStart();

  const m = LEFT_MARGIN_RE.exec(html);
  if (m) {
    const label = m[1].trim();
    html = html.replace(LEFT_MARGIN_RE, "");
    if (label && text.startsWith(label)) text = text.slice(label.length).trimStart();
  }

  // 남은 `csl-right-inline` 껍데기를 벗긴다. 안쪽 기울임만 쓸 것이다.
  html = html.replace(RIGHT_INLINE_RE, "$1").trim();

  return { html, text };
}

const TAGS_RE = /<[^>]+>/g;

/**
 * 번호 매김 스타일인가.
 *
 * 스타일 표에 손으로 적어 두지 않고 **나온 것을 보고** 판단한다 — 스타일을
 * 더할 때 맞춰야 할 표가 둘로 늘지 않도록. 본문 인용에서 태그와 괄호·대괄호를
 * 걷어냈을 때 숫자만 남으면 번호 매김이다.
 */
function isNumericCitation(inTextHtml: string): boolean {
  const bare = inTextHtml.replace(TAGS_RE, "").replace(/[[\]()\s.,]/g, "");
  return bare.length > 0 && /^\d+$/.test(bare);
}

// ─────────────────────────────────────────────────────────────
//   모자란 칸
// ─────────────────────────────────────────────────────────────

/**
 * 인용문을 만들 수는 있지만 **믿을 수 없게** 만드는 것들.
 *
 * citeproc 은 저자가 없으면 제목을 저자 자리에 세우고, 연도가 없으면
 * `(n.d.)` 를 끼운다. 그럴싸한 한 줄이 나오므로 보는 사람은 그것이 온전한 줄
 * 안다. 그래서 무엇이 없는지 화면이 먼저 말해야 한다.
 */
export function missingParts(item: CSLItem): string[] {
  const out: string[] = [];
  if (!item.title?.trim()) out.push("제목");
  if (!item.author?.length && !item.editor?.length) out.push("저자");
  if (yearOf(item.issued) == null) out.push("연도");
  /*
   * 실린 곳은 **프리프린트일 때 빼고** 센다. arXiv 에만 올라간 글은 실릴 곳이
   * 아직 없는 것이 맞는데, 그걸 모자란 것으로 세면 온전한 논문의 절반에
   * 헛경고가 붙는다. 경고가 흔해지면 아무도 안 읽는다.
   */
  if (!venueOf(item) && !arxivIdOf(item)) out.push("실린 곳");
  return out;
}

// ─────────────────────────────────────────────────────────────
//   만들기
// ─────────────────────────────────────────────────────────────

export interface Citation {
  /**
   * 참고문헌 한 줄, citeproc 이 준 HTML 조각.
   *
   * 들어오는 태그는 `<i> <b> <sup> <sub> <span>` 뿐이다. 그래도 화면은 이
   * 문자열을 `innerHTML` 로 밀어 넣지 않는다 — `cite-copy.tsx` 가 아는 태그만
   * 골라 React 노드로 세운다. 남의 서지정보에서 온 글이 섞여 있기 때문이다.
   */
  html: string;
  /** 같은 줄을 밋밋한 글로. 복사 단추가 기본으로 주는 것. */
  text: string;
  /** 본문 인용 — `(Vaswani et al., 2017)`. 번호 매김 스타일이면 null. */
  inText: string | null;
  /** 비어 있는 칸의 이름. 비었으면 온전하다. */
  missing: string[];
}

/**
 * CSL 한 덩어리를 인용문 한 줄로.
 *
 * 항목을 **복사해서** 넘긴다. citeproc 은 넘겨받은 것에 제 표시를 달아 두는데
 * (이름 갈래, 다중 언어 표시), 그게 원본에 남으면 다음에 다른 스타일로 다시
 * 그릴 때 앞선 스타일의 흔적을 물고 간다.
 */
export async function formatCitation(item: CSLItem, styleKey: CiteStyleKey): Promise<Citation> {
  const engine = await getEngine(styleKey);
  const missing = missingParts(item);

  const id = nextItemId();

  // ── 여기부터 끝까지 await 이 없다. `current` 를 남이 갈아 끼울 틈이 없다.
  const clone = structuredClone(item);
  clone.id = id;
  current = clone;
  try {
    engine.updateItems([id]);

    engine.setOutputFormat("html");
    const bibHtml = engine.makeBibliography();
    const inTextHtml = engine.makeCitationCluster([{ id }]);

    /*
     * 밋밋한 글을 HTML 에서 태그만 걷어 만들지 않는다. citeproc 이 `&` 를
     * `&#38;` 로 내보내므로 그렇게 만들면 복사한 줄에 `&#38;` 가 그대로 박힌다.
     * 같은 것을 text 형식으로 한 번 더 그리게 하는 편이 맞다 — 엔진은 이미
     * 세워져 있어 두 번째는 거의 공짜다.
     */
    engine.setOutputFormat("text");
    const bibText = engine.makeBibliography();
    const inTextText = engine.makeCitationCluster([{ id }]);

    if (!bibHtml || !bibText) throw new Error("이 서지정보로는 인용문을 만들지 못했습니다");

    const entry = cleanEntry(bibHtml[1].join(""), bibText[1].join(""));

    return {
      html: entry.html,
      // 참고문헌은 한 줄로 흐르게 눌러 둔다. 형식에 따라 줄바꿈·들여쓰기가 섞여 온다.
      text: entry.text.replace(/\s+/g, " ").trim(),
      inText: isNumericCitation(inTextHtml) ? null : inTextText.trim() || null,
      missing,
    };
  } finally {
    // 다음 사람이 남의 항목을 보지 않게. 엔진은 캐시에 남지만 항목은 안 남는다.
    current = null;
    // 캐시된 엔진의 출력 형식을 처음 모양으로 돌려 둔다.
    engine.setOutputFormat("html");
  }
}
