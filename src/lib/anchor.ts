import type { Anchor } from "./types";

/**
 * 고른 글자 ↔ `Anchor` 변환.
 *
 * 뷰어에서 떼어 둔 이유가 둘이다.
 *
 * 하나, 여기 있는 계산은 pdf.js 를 조금도 알 필요가 없다. `.page` 처럼 생긴
 * 요소 하나와 선택 영역만 있으면 된다. 뷰어를 바꿔 끼워도 이 파일은 그대로다.
 *
 * 둘, **`normalizeText` 는 저장할 때와 찾을 때 같은 것을 써야 한다.** 뷰어
 * 안에 숨겨 두면 나중에 서버가 인용문으로 자리를 다시 찾을 때 같은 규칙을
 * 손으로 한 벌 더 적게 되고, 그 순간부터 두 벌이 조금씩 갈라진다. 공백 하나가
 * 갈리면 인용은 아예 안 맞는다 — 부분 점수가 없는 비교다.
 *
 * 좌표는 `Anchor` 가 정한 대로 **비율(0~1)** 이고 기준은 `.page` 다.
 */

/** 앞뒤로 담아 둘 글자 수. 같은 문장이 여러 번 나올 때 가리는 것이 목적이라 길 필요가 없다. */
export const CONTEXT_CHARS = 40;

/**
 * 칠할 조각의 최대 개수.
 *
 * 한 쪽을 통째로 고르면 줄 수만큼(수백 개) 나온다. 그걸 다 저장하면 메모 한
 * 줄에 앵커 JSON 이 수십 KB 가 되고, 그리는 쪽도 그만큼 div 를 만든다.
 * 잘린 뒤에도 `box` 는 **자르기 전 전체**를 감싸므로 스크롤은 제자리로 간다.
 */
export const MAX_RECTS = 60;

type Rect4 = [number, number, number, number];

export interface PageFrame {
  left: number;
  top: number;
  width: number;
  height: number;
}

// ─────────────────────────────────────────────────────────────
//   글자 다듬기
// ─────────────────────────────────────────────────────────────

/*
 * 보이지 않으면서 비교만 어긋나게 하는 글자들. soft hyphen(U+00AD),
 * zero-width 계열(U+200B~200D), BOM(U+FEFF) 이 모두 유니코드 분류 Cf 다.
 * 목록을 손으로 적으면 다음에 새로운 놈이 나왔을 때 또 빠진다.
 */
const INVISIBLE = /\p{Cf}/gu;

/*
 * 줄 끝에서 낱말을 자른 하이픈. ASCII 하이픈과 U+2010/U+2011 만 본다 —
 * 줄표(em dash)까지 넣으면 "문장 —\n다음" 이 "문장다음" 으로 붙어 버린다.
 */
const HYPHEN_BREAK = /[-‐‑][ \t]*\r?\n[ \t]*/g;

/**
 * 인용문을 비교할 수 있는 꼴로.
 *
 * PDF 에서 뽑은 글자는 원문과 눈으로는 같아 보여도 바이트로는 다르다.
 * - 줄바꿈이 아무 데나 들어간다 (쪽 폭에서 잘린 자리).
 * - 줄 끝에서 낱말을 하이픈으로 자른다: `trans-` + 줄바꿈 + `form`.
 * - 폭 없는 공백·soft hyphen 이 글자 사이에 섞인다.
 * - 같은 한글이 조합형(NFD)과 완성형(NFC)으로 갈린다.
 *
 * 그래서 **저장하기 직전과 찾기 직전에 반드시 이 함수를 통과시킨다.**
 * 순서가 중요하다: 안 보이는 글자를 먼저 지우고, 하이픈 줄바꿈을 붙인 뒤,
 * 남은 공백을 하나로 만든다. 공백을 먼저 뭉개면 하이픈 뒤의 줄바꿈이 그냥
 * 빈칸이 되어 하이픈을 알아볼 수 없다.
 */
export function normalizeText(s: string): string {
  return s
    .normalize("NFC")
    .replace(INVISIBLE, "")
    .replace(HYPHEN_BREAK, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ─────────────────────────────────────────────────────────────
//   기준 상자
// ─────────────────────────────────────────────────────────────

/**
 * 비율의 기준이 되는 상자. **`getBoundingClientRect()` 를 그대로 쓰면 안 된다.**
 *
 * pdf.js 의 `.page` 에는 기본으로 9px 투명 테두리가 있다(`--page-border`).
 * 그래서 그 사각형은 실제 쪽보다 가로세로 18px 씩 크다. 반면 쪽 안에 절대위치로
 * 얹는 것 — 글자층, 주석층, 우리 메모층 — 의 `inset: 0` 과 퍼센트는 모두
 * **테두리 안쪽** 상자를 기준으로 잡힌다. 두 기준을 섞으면 메모가 늘 9px 씩
 * 어긋나고, 배율을 키울수록 눈에 띈다.
 *
 * 테두리를 껐는지 켰는지에 상관없이 맞도록 계산으로 벗겨 낸다 — 나중에
 * `removePageBorders` 를 켜도 이 함수는 고칠 것이 없다.
 *
 * `clientWidth` 대신 사각형에서 빼는 것은 그쪽이 정수로 반올림되기 때문이다.
 * 배율이 1.35 같은 값일 때 0.5px 이 날아가고, 그만큼 아래쪽 줄이 밀린다.
 */
export function pageFrame(pageDiv: HTMLElement): PageFrame {
  const r = pageDiv.getBoundingClientRect();
  const cs = pageDiv.ownerDocument.defaultView?.getComputedStyle(pageDiv);
  const bl = num(cs?.borderLeftWidth);
  const bt = num(cs?.borderTopWidth);
  const br = num(cs?.borderRightWidth);
  const bb = num(cs?.borderBottomWidth);
  return {
    left: r.left + bl,
    top: r.top + bt,
    // 0 이면 나누기에서 Infinity 가 나온다. 쪽이 아직 안 그려졌을 때 그렇다.
    width: Math.max(1, r.width - bl - br),
    height: Math.max(1, r.height - bt - bb),
  };
}

// ─────────────────────────────────────────────────────────────
//   선택 → Anchor
// ─────────────────────────────────────────────────────────────

/**
 * 지금 고른 글자를 `Anchor` 로.
 *
 * `pageDiv` 는 pdf.js 가 그린 `.page` 이고 `pageNumber` 는 1부터다. 부르는 쪽이
 * 쪽을 정해서 넘긴다 — 선택이 두 쪽에 걸쳐 있으면 **넘긴 쪽 안쪽만** 담는다.
 * 쪽을 넘나드는 앵커를 만들지 않는 것은 `Anchor` 가 `page` 하나만 들고 있기
 * 때문이다. 여러 쪽을 덮는 메모가 필요해지면 그건 앵커 모양을 바꿀 일이다.
 *
 * 고를 것이 없으면 null. 부르는 쪽은 그때 "적을 자리를 못 잡았다" 로 다룬다.
 */
export function anchorFromSelection(
  pageDiv: HTMLElement,
  pageNumber: number,
  selection: Selection | null,
): Anchor | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  return anchorFromRange(pageDiv, pageNumber, selection.getRangeAt(0));
}

/** `anchorFromSelection` 의 알맹이. 선택이 아니라 범위를 이미 들고 있을 때. */
export function anchorFromRange(
  pageDiv: HTMLElement,
  pageNumber: number,
  range: Range,
): Anchor | null {
  /*
   * 기준은 글자층이다. 쪽 전체가 아니라 글자층으로 자르는 이유는, 주석층의
   * 링크 같은 것이 범위 끝에 딸려 들어와 인용문에 엉뚱한 글자가 섞이기 때문이다.
   * 글자층이 아직 없으면(그리는 중) 쪽으로 물러선다.
   */
  const textLayer = pageDiv.querySelector<HTMLElement>(".textLayer") ?? pageDiv;
  const clipped = clipRange(range, textLayer);
  if (!clipped) return null;

  const frame = pageFrame(pageDiv);
  const rects = ratioRects(clipped.getClientRects(), frame);
  if (rects.length === 0) return null;

  const anchor: Anchor = {
    v: 1,
    page: pageNumber,
    rects: rects.slice(0, MAX_RECTS),
    // 자르기 **전** 전체를 감싼다. 스크롤 목표가 잘린 조각에만 맞으면 안 된다.
    box: unionBox(rects),
  };

  const quote = normalizeText(rangeText(clipped));
  if (quote) {
    anchor.quote = quote;
    // 앞은 뒤쪽 40자, 뒤는 앞쪽 40자. 인용문에 붙어 있는 쪽을 남긴다.
    const prefix = sideText(textLayer, clipped, "before").slice(-CONTEXT_CHARS);
    const suffix = sideText(textLayer, clipped, "after").slice(0, CONTEXT_CHARS);
    if (prefix) anchor.prefix = prefix;
    if (suffix) anchor.suffix = suffix;
  }

  return anchor;
}

// ─────────────────────────────────────────────────────────────
//   Anchor → 화면
// ─────────────────────────────────────────────────────────────

/**
 * 비율 상자를 `.page` 안에 얹을 퍼센트 style 로.
 *
 * 퍼센트로 두는 것이 요점이다. 픽셀로 바꿔 두면 배율이 바뀔 때마다 우리가
 * 다시 계산해야 하고 한 프레임씩 어긋나 칠한 자리가 떠다닌다. 퍼센트면 쪽이
 * 커지고 작아지는 대로 브라우저가 알아서 따라간다.
 */
export function ratioStyle([x, y, w, h]: Rect4): {
  left: string;
  top: string;
  width: string;
  height: string;
} {
  return {
    left: `${x * 100}%`,
    top: `${y * 100}%`,
    width: `${w * 100}%`,
    height: `${h * 100}%`,
  };
}

// ─────────────────────────────────────────────────────────────
//   속살
// ─────────────────────────────────────────────────────────────

function num(v: string | undefined): number {
  const n = Number.parseFloat(v ?? "");
  return Number.isFinite(n) ? n : 0;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 범위를 어떤 요소 안쪽으로 자른다. 겹치는 데가 없으면 null. */
function clipRange(range: Range, node: Node): Range | null {
  const doc = node.ownerDocument;
  if (!doc) return null;
  if (!range.intersectsNode(node)) return null;

  const bounds = doc.createRange();
  bounds.selectNodeContents(node);

  const out = range.cloneRange();
  if (out.compareBoundaryPoints(Range.START_TO_START, bounds) < 0) {
    out.setStart(bounds.startContainer, bounds.startOffset);
  }
  if (out.compareBoundaryPoints(Range.END_TO_END, bounds) > 0) {
    out.setEnd(bounds.endContainer, bounds.endOffset);
  }
  return out.collapsed ? null : out;
}

/**
 * 화면 사각형들을 비율로.
 *
 * 줄마다, 때로는 글자 뭉치마다 조각이 따로 나온다. 그대로 두면 한 줄이
 * 열몇 조각으로 칠해져 사이사이 흰 틈이 보인다. 같은 줄에 있고 맞닿은 것은
 * 미리 합친다 — 개수를 줄이는 일이기도 해서 `MAX_RECTS` 에 덜 걸린다.
 */
function ratioRects(list: DOMRectList, frame: PageFrame): Rect4[] {
  const px: Rect4[] = [];
  for (const r of Array.from(list)) {
    // 0 폭 조각. 줄 끝의 <br> 나 빈 span 에서 나온다.
    if (r.width < 0.5 || r.height < 0.5) continue;
    px.push([r.left - frame.left, r.top - frame.top, r.width, r.height]);
  }

  const out: Rect4[] = [];
  for (const [x, y, w, h] of mergeLines(px)) {
    // 네 귀퉁이를 각각 0~1 로 자른 뒤 폭을 다시 낸다. 좌표만 자르고 폭을
    // 그대로 두면 쪽 밖으로 삐져나간 조각이 남는다.
    const x0 = clamp01(x / frame.width);
    const y0 = clamp01(y / frame.height);
    const x1 = clamp01((x + w) / frame.width);
    const y1 = clamp01((y + h) / frame.height);
    if (x1 <= x0 || y1 <= y0) continue;
    out.push([x0, y0, x1 - x0, y1 - y0]);
  }
  return out;
}

function mergeLines(rects: Rect4[]): Rect4[] {
  const sorted = rects.slice().sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const out: Rect4[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    // 3px 까지는 낱말 사이 공백으로 본다. 이 선을 크게 잡으면 두 단짜리
    // 논문에서 왼쪽 단과 오른쪽 단이 한 덩어리로 칠해진다.
    if (last && sameLine(last, r) && r[0] - (last[0] + last[2]) <= 3) {
      const left = Math.min(last[0], r[0]);
      const top = Math.min(last[1], r[1]);
      const right = Math.max(last[0] + last[2], r[0] + r[2]);
      const bottom = Math.max(last[1] + last[3], r[1] + r[3]);
      out[out.length - 1] = [left, top, right - left, bottom - top];
      continue;
    }
    out.push(r);
  }
  return out;
}

/** 세로로 절반 넘게 겹치면 같은 줄로 본다. 위첨자·아래첨자가 따로 떨어지지 않게. */
function sameLine(a: Rect4, b: Rect4): boolean {
  const overlap = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  return overlap > Math.min(a[3], b[3]) * 0.5;
}

function unionBox(rects: Rect4[]): Rect4 {
  let x0 = 1;
  let y0 = 1;
  let x1 = 0;
  let y1 = 0;
  for (const [x, y, w, h] of rects) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x + w > x1) x1 = x + w;
    if (y + h > y1) y1 = y + h;
  }
  return [x0, y0, Math.max(0, x1 - x0), Math.max(0, y1 - y0)];
}

/**
 * 범위 안의 글자.
 *
 * `Range.toString()` 을 쓰지 않는다. 그건 글자 노드만 이어 붙이는데, pdf.js
 * 글자층은 줄이 끝날 때 `<br role="presentation">` 을 넣는다. 그래서
 * `toString()` 으로는 앞 줄의 마지막 낱말과 다음 줄의 첫 낱말이 붙어 버린다.
 * 줄바꿈을 살려 두면 `normalizeText` 가 공백 하나로 바꿔 준다.
 */
function rangeText(range: Range): string {
  return nodeText(range.cloneContents());
}

function nodeText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? "";
  if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === "BR") {
    return "\n";
  }
  let out = "";
  for (const child of Array.from(node.childNodes)) out += nodeText(child);
  return out;
}

/** 선택 앞(또는 뒤)에 남은 글자. 다듬어서 넘긴다 — 인용문과 같은 규칙이어야 한다. */
function sideText(layer: Node, range: Range, side: "before" | "after"): string {
  const doc = layer.ownerDocument;
  if (!doc) return "";
  try {
    const r = doc.createRange();
    r.selectNodeContents(layer);
    if (side === "before") r.setEnd(range.startContainer, range.startOffset);
    else r.setStart(range.endContainer, range.endOffset);
    return normalizeText(nodeText(r.cloneContents()));
  } catch {
    // 경계가 글자층 밖이면 setEnd/setStart 가 던진다. 문맥은 있으면 좋은
    // 것이지 없으면 안 되는 것이 아니라서 조용히 포기한다.
    return "";
  }
}
