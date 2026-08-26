"use client";

import "pdfjs-dist/web/pdf_viewer.css";

import {
  AlertCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Loader2,
  Maximize,
  Minus,
  MoveHorizontal,
  Plus,
  Search,
  X,
} from "lucide-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { anchorFromSelection, pageFrame, ratioStyle } from "@/lib/anchor";
import { loadPdfViewer, TextLayerMode, type PdfjsUi } from "@/lib/pdfjs";
import { fileUrl, type Anchor, type NoteDTO } from "@/lib/types";
import { apiPath } from "@/lib/api-path";
import { cn } from "@/lib/utils";

import { NoteLayer, useRenderedPages } from "./note-layer";

/**
 * PDF 뷰어 본체. `pdf-frame.tsx` 의 iframe 을 대신한다.
 *
 * **왜 브라우저 내장 뷰어를 버렸나.** 파일 라우트가 응답에
 * `Content-Security-Policy: sandbox` 를 붙이고 `allow-same-origin` 을 빼서
 * 오리진을 불투명하게 만든다. 덕분에 PDF 안의 스크립트가 우리 쿠키에 닿지
 * 못하지만, 같은 이유로 **우리도** 그 안에 닿지 못한다. 쪽 위에 무엇을 그릴
 * 수도, 사람이 고른 글자를 읽을 수도 없다. 앵커 메모는 그 둘이 다 있어야 한다.
 *
 * 대신 iframe 은 버려 두지 않는다. 여기가 못 뜨면 `onFail` 로 알리고 부르는
 * 쪽이 기본 보기로 물러난다 — 메모는 못 달아도 논문은 읽을 수 있어야 한다.
 *
 * **이 파일이 하는 일과 하지 않는 일.** 문서를 열고, 쪽을 그리고, 배율과 검색을
 * 다루고, 고른 글자를 앵커로 바꿔 알린다. 메모를 **칠하는** 모양은
 * `note-layer.tsx` 가 정하고, 언제 무엇을 칠할지 정하는 배선은
 * `paper-detail.tsx` 에 있다. 여기는 둘 사이의 쪽 div 를 넘겨 주는 자리다.
 *
 * 무거운 것(pdfjs 코어 + 뷰어 = 1MB 급)은 모두 `lib/pdfjs.ts` 의 `import()`
 * 뒤에 있다. 그래도 이 파일 자체를 `dynamic(() => import(...), { ssr: false })`
 * 로 물려라 — 위의 CSS import 와 브라우저 전용 코드가 서버 번들에 얹힐 이유가
 * 없다.
 */

// ─────────────────────────────────────────────────────────────
//   밖으로 내보이는 것
// ─────────────────────────────────────────────────────────────

export interface PdfViewHandle {
  /** 앵커 자리로 굴러간다. 아직 안 그려진 쪽이어도 쪽 번호까지는 맞춰 준다. */
  scrollToAnchor(anchor: Anchor): void;
  /**
   * 그 앵커가 **지금 화면의 어디**인가 (client 좌표, 상자의 아래 가운데).
   *
   * 적기 상자를 띄울 자리를 잡는 데 쓴다. 아직 안 그려진 쪽이면 null —
   * 그때는 부르는 쪽이 알아서 다른 자리를 고른다.
   */
  anchorPoint(anchor: Anchor): { x: number; y: number } | null;
  /** 지금 고른 글자를 앵커로. 고른 것이 없거나 PDF 밖이면 null. */
  getSelectionAnchor(): Anchor | null;
  /** `notes` 안의 그 자리로 데려가 잠깐 번쩍인다. null 이면 번쩍임만 끈다. */
  highlight(noteId: string | null): void;
  /** 브라우저의 글자 선택을 푼다. 메모를 저장한 뒤 파랗게 남은 것을 걷을 때. */
  clearSelection(): void;
  /** 쪽 번호로. 1부터. */
  goToPage(page: number): void;
}

export interface PdfViewProps {
  fileId: string;
  title: string;
  /** 원문 위에 칠할 메모들. */
  notes?: readonly NoteDTO[];
  /** 지금 짚고 있는 메모. 진하게 칠해진다. */
  activeNoteId?: string | null;
  /**
   * 글자를 고르고 손을 뗐다.
   *
   * `at` 은 고른 자리의 아래 끝(client 좌표)이다. 적기 상자를 그 옆에 띄우라고
   * 좌표까지 함께 주는 이유는, 부르는 쪽이 pdf.js 의 쪽 배치를 알지 못해서다.
   *
   * 고르는 **중**에는 오지 않는다. 드래그가 끝난 뒤 한 번만 온다 — 끄는 동안
   * 계속 오면 적기 상자가 손을 따라다닌다.
   */
  onSelect?: (anchor: Anchor, at: { x: number; y: number }) => void;
  /** 원문 위의 메모 손잡이를 눌렀다. */
  onPickNote?: (noteId: string) => void;
  /**
   * 뷰어를 띄우지 못했다. 부르는 쪽은 기본 보기로 물러나면 된다.
   *
   * 여기서 오류 화면을 그리고 끝내지 않는 이유는, 못 뜨는 이유가 대개 이
   * 브라우저에서 pdf.js 가 안 도는 것이지 파일이 잘못된 것이 아니기 때문이다.
   * 그럴 때 "열 수 없습니다" 를 띄우면 읽을 수 있는 논문을 못 읽게 만든다.
   */
  onFail?: (reason: string) => void;
  className?: string;
}

// ─────────────────────────────────────────────────────────────
//   상수
// ─────────────────────────────────────────────────────────────

const MIN_SCALE = 0.25;
const MAX_SCALE = 8;
const SCALE_STEP = 1.1;
/** 앵커로 굴러갈 때 위에 남길 여백. 화면 맨 윗줄에 딱 붙으면 앞을 읽을 수 없다. */
const SCROLL_MARGIN = 96;
/** 번쩍임이 남아 있는 시간. */
const FLASH_MS = 1500;
/** 선택이 끝난 뒤 앵커를 만들기까지 기다리는 시간. 브라우저가 선택을 확정할 틈. */
const SELECT_SETTLE_MS = 40;

/*
 * pdf.js 가 자기 CSS 에서 가정하는 것을 되돌리고, 나머지는 앱 테마에 맞춘다.
 *
 * **`box-sizing` 이 진짜 문제다.** Tailwind 의 preflight 가 모든 요소를
 * `border-box` 로 바꾸는데, pdf.js 는 `content-box` 를 전제로 `.page` 에
 * `width: calc(var(--scale-factor) * 폭px)` 를 적고 그 위에 9px 테두리를 두른다.
 * border-box 로 바뀌면 쪽의 안쪽이 18px 좁아지는데, 캔버스는 `width: 100%` 라
 * 함께 좁아지고 **글자층 span 은 절대 px 라 안 좁아진다.** 그러면 글자층이
 * 그림보다 넓어져 오른쪽으로 갈수록 선택 영역이 글자에서 밀린다 — 앵커가
 * 통째로 어긋난다. 그래서 PDF 안쪽만 `content-box` 로 되돌린다.
 * (pdf.js 가 스스로 `border-box` 로 지정한 것들은 선택자가 더 좁아 살아남는다)
 *
 * Tailwind v4 의 preflight 는 `@layer base` 안이고 이 `<style>` 은 층 밖이라,
 * 순서나 명시도와 무관하게 이쪽이 이긴다.
 */
const VIEWER_CSS = `
.pb-pdf *, .pb-pdf *::before, .pb-pdf *::after { box-sizing: content-box; }
.pb-pdf .pdfViewer .page { box-shadow: 0 2px 14px rgb(0 0 0 / 0.28); }
.pb-pdf .textLayer {
  --highlight-bg-color: color-mix(in oklab, var(--color-warn) 40%, transparent);
  --highlight-selected-bg-color: color-mix(in oklab, var(--color-accent) 55%, transparent);
}
.pb-pdf .textLayer ::selection {
  background: color-mix(in oklab, var(--color-accent) 42%, transparent);
}
.pb-pdf-flash { position: absolute; inset: 0; pointer-events: none; z-index: 6; }
.pb-pdf-flash > i {
  position: absolute;
  display: block;
  border-radius: 2px;
  background: color-mix(in oklab, var(--color-accent) 38%, transparent);
  box-shadow: 0 0 0 2px var(--color-accent);
  animation: pb-pdf-flash ${FLASH_MS}ms ease-out forwards;
}
@keyframes pb-pdf-flash { 0%, 55% { opacity: 1 } 100% { opacity: 0 } }
`;

// ─────────────────────────────────────────────────────────────

type Ui = PdfjsUi;
type Viewer = InstanceType<Ui["PDFViewer"]>;
type Bus = InstanceType<Ui["EventBus"]>;

/** 문서 하나를 여는 동안 살아 있는 것들. 정리하는 코드가 이 묶음 하나만 보면 되게 모은다. */
interface Session {
  viewer: Viewer;
  bus: Bus;
  linkService: InstanceType<Ui["PDFLinkService"]>;
  findController: InstanceType<Ui["PDFFindController"]>;
}

export const PdfView = forwardRef<PdfViewHandle, PdfViewProps>(function PdfView(
  { fileId, title, notes, activeNoteId, onSelect, onPickNote, onFail, className },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerElRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const flashRef = useRef<HTMLElement | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /*
   * 콜백과 목록을 ref 로 한 번 감싼다. 문서를 여는 효과의 의존성에 이것들을
   * 그대로 넣으면, 부모가 화살표 함수를 인라인으로 넘기는 흔한 모양 하나에
   * PDF 가 매 렌더마다 새로 열린다.
   */
  const cb = useRef({ onSelect, onFail });
  cb.current = { onSelect, onFail };
  const notesRef = useRef<readonly NoteDTO[]>(notes ?? []);
  notesRef.current = notes ?? [];

  /*
   * 함정 2 의 절반. pdf.js 는 쪽을 다시 그릴 때 `.page` 의 자식을 통째로
   * 갈아치운다. 그린 쪽을 여기 붙들어 두고, 다시 꽂는 일은 `note-layer.tsx` 가
   * 한다 — 언제 다시 꽂을지의 판단이 두 곳에 나뉘지 않게.
   */
  const { pages, onPageRendered, resetPages } = useRenderedPages();
  const pageHooks = useRef({ onPageRendered, resetPages });
  pageHooks.current = { onPageRendered, resetPages };

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageDraft, setPageDraft] = useState("1");
  const [pageCount, setPageCount] = useState(0);
  const [scalePct, setScalePct] = useState(100);
  const [fitMode, setFitMode] = useState<"page-width" | "page-fit" | null>("page-width");

  /**
   * 아직 저장하지 않은 자리.
   *
   * 적기 상자를 누르는 순간 브라우저의 글자 선택이 풀린다. 그때 이것이 없으면
   * 글을 적기 시작하자마자 "어디에 붙는 메모인지" 가 화면에서 사라진다.
   * 걷는 신호는 셋이다 — 새 선택, 원문을 그냥 누름(고르기를 그만둠), 그리고
   * 목록이 바뀜(저장·삭제가 끝남).
   */
  const [pending, setPending] = useState<Anchor | null>(null);
  useEffect(() => setPending(null), [notes]);

  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  const [notFound, setNotFound] = useState(false);

  // ───────────────────────────────────────────────────────────
  //   문서 열기 — 이 효과 하나가 뷰어의 한살이 전부다
  // ───────────────────────────────────────────────────────────

  useEffect(() => {
    const container = containerRef.current;
    const viewerEl = viewerElRef.current;
    if (!fileId || !container || !viewerEl) return;

    /*
     * 함정 3 — StrictMode 는 개발에서 마운트를 두 번 한다. 이 깃발이 없으면
     * 첫 마운트의 비동기 로딩이 정리된 뒤에 돌아와 뷰어를 하나 더 만들고,
     * 그 뷰어는 아무도 정리하지 않아 워커째 남는다.
     */
    let alive = true;
    let session: Session | null = null;
    let task: { destroy: () => Promise<void> } | null = null;
    let ro: ResizeObserver | null = null;
    let roFrame = 0;
    /*
     * 문서가 붙기 전에는 배율을 다시 넣지 않는다.
     *
     * `ro.observe()` 는 붙이는 그 순간 한 번 발화한다. 그런데 관찰자를 다는
     * 시점은 문서를 받아 오기 **전**이라, 그 첫 발화가 그대로 `viewer.update()`
     * 까지 가면 아직 쪽이 하나도 없는 뷰어에서 터진다
     * (`Cannot read properties of undefined (reading '0')`).
     *
     * 화면은 멀쩡해 보인다 — 문서가 붙은 뒤의 발화는 정상이라, 콘솔에 오류
     * 한 줄이 조용히 쌓일 뿐이다. 그래서 눈에 안 띈다.
     */
    let ready = false;
    const offs: (() => void)[] = [];

    setStatus("loading");
    setError(null);

    void (async () => {
      try {
        const { core, ui } = await loadPdfViewer();
        if (!alive) return;

        const bus = new ui.EventBus();
        const linkService = new ui.PDFLinkService({
          eventBus: bus,
          // PDF 안의 바깥 링크는 새 탭으로. 뷰어 자리에서 논문이 떠나 버리면
          // 읽던 자리와 적던 메모를 함께 잃는다.
          externalLinkTarget: ui.LinkTarget.BLANK,
          externalLinkRel: "noopener noreferrer",
        });
        const findController = new ui.PDFFindController({
          eventBus: bus,
          linkService,
          updateMatchesCountOnProgress: true,
        });

        const viewer = new ui.PDFViewer({
          container,
          viewer: viewerEl,
          eventBus: bus,
          linkService,
          findController,
          /*
           * 글자층이 있어야 선택이 되고, 선택이 되어야 앵커를 잡는다.
           * `ENABLE_PERMISSIONS` 는 선택은 되지만 복사를 막는다 — 논문에서
           * 문장을 복사하는 것은 막을 이유가 없어 `ENABLE` 을 쓴다.
           */
          textLayerMode: TextLayerMode.ENABLE,
          /*
           * 링크·하이라이트는 그리되 **폼은 그리지 않는다.** 폼 위젯은 입력을
           * 받는 진짜 DOM 이라 그 위에서는 글자를 고를 수 없고, 논문에 폼이
           * 있을 이유도 없다. 편집기도 끈다 — 우리 메모와 자리를 다툰다.
           */
          annotationMode: core.AnnotationMode.ENABLE,
          annotationEditorMode: core.AnnotationEditorType.DISABLE,
          enableHWA: true,
        });
        linkService.setViewer(viewer);
        session = { viewer, bus, linkService, findController };
        sessionRef.current = session;

        // ── 사건 ────────────────────────────────────────────
        const on = (name: string, fn: (e: never) => void) => {
          bus.on(name, fn);
          offs.push(() => bus.off(name, fn));
        };

        on("pagesinit", () => {
          if (!alive) return;
          // 처음 여는 배율. 논문은 세로로 길어서 폭을 채우는 쪽이 읽기 좋다.
          viewer.currentScaleValue = "page-width";
          setPageCount(viewer.pagesCount);
          setStatus("ready");
        });

        on("pagechanging", (e: { pageNumber: number }) => {
          if (!alive) return;
          setPage(e.pageNumber);
          setPageDraft(String(e.pageNumber));
        });

        on("scalechanging", (e: { scale: number; presetValue?: string }) => {
          if (!alive) return;
          setScalePct(Math.round(e.scale * 100));
          const preset = e.presetValue;
          setFitMode(preset === "page-width" || preset === "page-fit" ? preset : null);
        });

        /*
         * 함정 2 — 오버레이를 한 번 꽂고 끝내면 "메모가 가끔 안 보인다" 가 된다.
         * 배율 변경, 창 크기 변경, 화면 밖으로 나갔다 돌아온 쪽에서 모두 다시
         * 그려지고 그때마다 자식이 갈린다. 그릴 때마다 알린다.
         */
        on("pagerendered", (e: { pageNumber: number; source: { div: HTMLElement } }) => {
          if (!alive) return;
          pageHooks.current.onPageRendered(e.pageNumber, e.source.div);
        });

        on("updatefindmatchescount", (e: { matchesCount: { current: number; total: number } }) => {
          if (!alive) return;
          setFound(e.matchesCount);
        });

        on(
          "updatefindcontrolstate",
          (e: { state: number; matchesCount: { current: number; total: number } }) => {
            if (!alive) return;
            setFound(e.matchesCount);
            // FindState.NOT_FOUND === 1. 뷰어 번들이 상수를 내주지 않는다.
            setNotFound(e.state === 1);
          },
        );

        /*
         * 함정 1 — pdf.js 는 `window` 의 resize 만 듣는다.
         *
         * 상세 화면은 원문과 글 사이의 칸막이를 끌 수 있다. 그때 창 크기는
         * 그대로라 pdf.js 에게는 아무 일도 일어나지 않고, `page-width` 배율이
         * 옛 폭에 묶인 채 남아 쪽이 잘리거나 오른쪽에 여백이 남는다.
         * 폭이 바뀌면 배율을 **다시 넣어** 지금 폭으로 계산하게 한다.
         */
        ro = new ResizeObserver(() => {
          // rAF 로 미루지 않으면 이 안에서 일으킨 배치 변화가 다시 관찰돼
          // "ResizeObserver loop" 경고가 뜬다.
          if (roFrame) return;
          roFrame = requestAnimationFrame(() => {
            roFrame = 0;
            if (!alive || !ready) return;
            const v = viewer.currentScaleValue;
            // 사람이 배율을 직접 고른 상태(숫자)면 건드리지 않는다.
            if (v === "auto" || v === "page-width" || v === "page-fit") {
              viewer.currentScaleValue = v;
            }
            viewer.update();
          });
        });
        ro.observe(container);

        // ── 문서 ────────────────────────────────────────────
        const loading = core.getDocument({
          url: fileUrl(fileId),
          /*
           * 파일 라우트가 Range 를 지원한다. 자동으로 끝까지 당겨 오지 않게
           * 막아 두면 보이는 쪽만 조각으로 받는다 — 200쪽짜리 논문도 첫 쪽이
           * 뜨는 시간이 파일 크기와 거의 무관해진다.
           */
          disableAutoFetch: true,
          rangeChunkSize: 128 * 1024,
          /*
           * 한글·한자 논문을 위한 것.
           *
           * CJK PDF 는 글자를 유니코드로 담지 않고 "이 글꼴의 몇 번째 글자" 로
           * 가리키는 일이 흔하다. 그 번호를 글자로 옮기는 표가 CMap 인데,
           * pdf.js 는 이 표를 번들에 넣지 않고 **주소로 받아 간다.** 안 주면
           * 그 논문은 글자가 통째로 빠지거나 네모로 나온다.
           *
           * 라틴 문자는 시스템 글꼴로 곱게 물러나서 이 구멍이 한동안 안 보인다 —
           * 영어 논문만 열어 보는 동안에는 아무 일도 없다.
           *
           * 자산은 `scripts/copy-pdfjs-assets.mjs` 가 빌드 전에 `public/pdfjs/`
           * 로 옮긴다. 주소는 `apiPath()` 를 타야 한다 (하위 경로 배포).
           * 끝의 슬래시가 없으면 pdf.js 가 파일 이름을 그대로 이어 붙여 깨진다.
           */
          cMapUrl: apiPath("/pdfjs/cmaps/"),
          cMapPacked: true,
          standardFontDataUrl: apiPath("/pdfjs/standard_fonts/"),
          // 남의 PDF 안의 식을 eval 로 돌리지 않는다. 폼을 안 그리므로 잃는 것도 없다.
          isEvalSupported: false,
          enableXfa: false,
        });
        task = loading;

        const doc = await loading.promise;
        if (!alive) {
          void doc.destroy();
          return;
        }
        viewer.setDocument(doc);
        linkService.setDocument(doc, null);
        findController.setDocument(doc);
        ready = true;
      } catch (e) {
        if (!alive) return;
        const reason = readError(e);
        setStatus("error");
        setError(reason);
        // 읽기라도 되게. 부르는 쪽이 기본 보기로 물러난다.
        cb.current.onFail?.(reason);
      }
    })();

    return () => {
      alive = false;
      ro?.disconnect();
      if (roFrame) cancelAnimationFrame(roFrame);
      for (const off of offs) off();

      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashRef.current?.remove();
      flashRef.current = null;

      /*
       * 함정 3 의 나머지 반쪽. `setDocument(null)` 로 뷰어·링크·검색이 붙들고
       * 있는 문서를 놓고 `destroy()` 로 워커를 내린다. 하나라도 빠지면
       * StrictMode 의 두 번 마운트에서 워커가 한 벌씩 쌓인다.
       */
      const s = session;
      if (s) {
        try {
          s.viewer.setDocument(null as never);
          s.linkService.setDocument(null as never);
          s.findController.setDocument(null as never);
        } catch {
          /* 이미 내려간 뒤라면 그만이다 */
        }
      }
      void task?.destroy().catch(() => undefined);
      sessionRef.current = null;
      // 앞 문서의 쪽 div 를 붙들고 있으면 portal 이 허공에 그린다.
      pageHooks.current.resetPages();
    };
  }, [fileId]);

  // ───────────────────────────────────────────────────────────
  //   ref 로 내주는 명령
  // ───────────────────────────────────────────────────────────

  /** 그려져 있는 쪽의 `.page` div. 아직 안 그려졌으면 null. */
  const livePage = useCallback((pageNumber: number): HTMLElement | null => {
    const viewer = sessionRef.current?.viewer;
    if (!viewer || pageNumber < 1 || pageNumber > viewer.pagesCount) return null;
    const div = viewer.getPageView(pageNumber - 1)?.div as HTMLElement | undefined;
    return div?.isConnected ? div : null;
  }, []);

  const scrollToAnchor = useCallback((anchor: Anchor) => {
    const viewer = sessionRef.current?.viewer;
    if (!viewer || anchor.page < 1 || anchor.page > viewer.pagesCount) return;

    const vp = viewer.getPageView(anchor.page - 1)?.viewport;
    if (!vp) {
      // 아직 만들어지지 않은 쪽. 쪽 번호까지만 맞춰 준다.
      viewer.currentPageNumber = anchor.page;
      return;
    }
    /*
     * 비율 → 쪽 안의 CSS 픽셀 → PDF 좌표.
     *
     * pdf.js 의 스크롤 목표는 PDF 좌표(아래에서 위로 자라는 축)로 말해야 한다.
     * 배율이 얼마든 같은 자리를 가리키게 하려면 이 변환을 거쳐야 하고,
     * `ignoreDestinationZoom` 이 있어야 사람이 맞춰 둔 배율을 건드리지 않는다.
     */
    const x = anchor.box[0] * vp.width;
    const y = Math.max(0, anchor.box[1] * vp.height - SCROLL_MARGIN);
    const [pdfX, pdfY] = vp.convertToPdfPoint(x, y) as [number, number];
    viewer.scrollPageIntoView({
      pageNumber: anchor.page,
      destArray: [null, { name: "XYZ" }, pdfX, pdfY, null],
      ignoreDestinationZoom: true,
      allowNegativeOffset: true,
    });
  }, []);

  const anchorPoint = useCallback(
    (anchor: Anchor): { x: number; y: number } | null => {
      const pageDiv = livePage(anchor.page);
      if (!pageDiv) return null;
      // `pageFrame` 이 테두리를 벗겨 준다 — 비율을 잰 기준과 같은 상자여야 한다.
      const f = pageFrame(pageDiv);
      const [bx, by, bw, bh] = anchor.box;
      return {
        x: f.left + (bx + bw / 2) * f.width,
        y: f.top + (by + bh) * f.height,
      };
    },
    [livePage],
  );

  const getSelectionAnchor = useCallback((): Anchor | null => {
    const root = containerRef.current;
    if (!root || typeof window === "undefined") return null;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;

    /*
     * 선택이 시작된 쪽을 기준으로 삼는다. 두 쪽에 걸친 선택은 첫 쪽 몫만
     * 담긴다 (`anchorFromRange` 가 잘라 낸다) — `Anchor` 에 쪽이 하나뿐이다.
     */
    const start = sel.getRangeAt(0).startContainer;
    const el = start.nodeType === Node.ELEMENT_NODE ? (start as Element) : start.parentElement;
    const pageDiv = el?.closest<HTMLElement>(".page") ?? null;
    if (!pageDiv || !root.contains(pageDiv)) return null;

    const pageNumber = Number(pageDiv.dataset.pageNumber);
    if (!Number.isFinite(pageNumber) || pageNumber < 1) return null;
    return anchorFromSelection(pageDiv, pageNumber, sel);
  }, []);

  /**
   * 그 자리로 데려가 잠깐 번쩍인다.
   *
   * 칠해 두는 것(`note-layer.tsx`)과 일부러 다르게 그린다. 저건 "이 메모가
   * 여기 있다" 는 상태고 이건 "방금 네가 누른 것이 여기다" 는 한 번짜리
   * 신호라, 둘이 같은 모양이면 목록에서 눌렀을 때 눈이 어디로 갈지 모른다.
   *
   * React 로 그리지 않고 DOM 에 직접 꽂는다. 잠깐 살다 사라지는 것 하나
   * 때문에 portal 수명주기를 또 한 벌 들고 있을 이유가 없다.
   */
  const highlight = useCallback(
    (noteId: string | null) => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashRef.current?.remove();
      flashRef.current = null;
      if (!noteId) return;

      const note = notesRef.current.find((n) => n.id === noteId);
      if (!note) return;
      scrollToAnchor(note.anchor);

      const pageDiv = livePage(note.anchor.page);
      if (!pageDiv) return;

      const host = document.createElement("div");
      host.className = "pb-pdf-flash";
      for (const rect of note.anchor.rects) {
        const box = document.createElement("i");
        Object.assign(box.style, ratioStyle(rect));
        host.append(box);
      }
      pageDiv.append(host);
      flashRef.current = host;
      flashTimer.current = setTimeout(() => {
        host.remove();
        if (flashRef.current === host) flashRef.current = null;
      }, FLASH_MS);
    },
    [livePage, scrollToAnchor],
  );

  const clearSelection = useCallback(() => {
    if (typeof window !== "undefined") window.getSelection()?.removeAllRanges();
  }, []);

  const goToPage = useCallback((n: number) => {
    const viewer = sessionRef.current?.viewer;
    if (!viewer) return;
    viewer.currentPageNumber = Math.min(Math.max(1, Math.round(n)), viewer.pagesCount);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      scrollToAnchor,
      anchorPoint,
      getSelectionAnchor,
      highlight,
      clearSelection,
      goToPage,
    }),
    [scrollToAnchor, anchorPoint, getSelectionAnchor, highlight, clearSelection, goToPage],
  );

  // ───────────────────────────────────────────────────────────
  //   고른 글자 알리기
  // ───────────────────────────────────────────────────────────

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    /*
     * 고르는 **중**이 아니라 손을 뗀 뒤에 한 번만 본다. `selectionchange` 를
     * 듣는 길도 있지만 그건 드래그하는 내내 쏟아지고, 그때마다 범위를 복제해
     * 훑는 일(앵커 만들기)을 하게 된다.
     *
     * `pointerdown` 은 문서 안쪽에서만 듣는다. 원문을 그냥 눌러 고르기를
     * 그만두면 아직 저장 안 한 자리 표시도 함께 걷는다.
     */
    const onDown = () => setPending(null);

    let timer: ReturnType<typeof setTimeout> | null = null;
    const onUp = () => {
      if (timer) clearTimeout(timer);
      // 브라우저가 선택을 확정하기 전에 읽으면 한 박자 전 값이 잡힌다.
      timer = setTimeout(() => {
        const anchor = getSelectionAnchor();
        if (!anchor) return;
        setPending(anchor);
        cb.current.onSelect?.(anchor, selectionPoint() ?? { x: 0, y: 0 });
      }, SELECT_SETTLE_MS);
    };

    root.addEventListener("pointerdown", onDown);
    // 드래그가 원문 밖에서 끝나는 일이 흔하다. 그래서 뗄 때는 문서 전체를 본다.
    document.addEventListener("pointerup", onUp);
    return () => {
      root.removeEventListener("pointerdown", onDown);
      document.removeEventListener("pointerup", onUp);
      if (timer) clearTimeout(timer);
    };
  }, [getSelectionAnchor]);

  // ───────────────────────────────────────────────────────────
  //   도구줄이 부르는 것
  // ───────────────────────────────────────────────────────────

  const zoom = (dir: 1 | -1) => {
    const viewer = sessionRef.current?.viewer;
    if (!viewer) return;
    const next = dir > 0 ? viewer.currentScale * SCALE_STEP : viewer.currentScale / SCALE_STEP;
    viewer.currentScaleValue = String(Math.min(MAX_SCALE, Math.max(MIN_SCALE, next)));
  };

  const setFit = (mode: "page-width" | "page-fit") => {
    const viewer = sessionRef.current?.viewer;
    if (viewer) viewer.currentScaleValue = mode;
  };

  const commitPage = () => {
    const n = Number(pageDraft);
    if (Number.isFinite(n) && n >= 1) goToPage(n);
    else setPageDraft(String(page));
  };

  /**
   * 검색을 pdf.js 에 부탁한다.
   *
   * 입력창을 우리가 그리므로 `PDFFindBar` 는 쓰지 않는다. 대신 `EventBus` 에
   * 같은 이름의 사건을 직접 던진다 — `PDFFindController` 가 듣는 것은 결국
   * 이것뿐이다. `type` 이 빈 문자열이면 새 검색, `"again"` 이면 다음/이전.
   */
  const find = (type: "" | "again", findPrevious = false) => {
    const bus = sessionRef.current?.bus;
    if (!bus) return;
    bus.dispatch("find", {
      source: null,
      type,
      query,
      caseSensitive: false,
      entireWord: false,
      highlightAll: true,
      findPrevious,
      matchDiacritics: false,
    });
  };

  const closeFind = () => {
    setFindOpen(false);
    setQuery("");
    setFound({ current: 0, total: 0 });
    setNotFound(false);
    // 빈 검색어를 한 번 더 던져야 쪽에 칠해 둔 노란 자국이 걷힌다.
    sessionRef.current?.bus.dispatch("find", {
      source: null,
      type: "",
      query: "",
      caseSensitive: false,
      entireWord: false,
      highlightAll: false,
      findPrevious: false,
      matchDiacritics: false,
    });
  };

  // ───────────────────────────────────────────────────────────
  //   그리기
  // ───────────────────────────────────────────────────────────

  return (
    <div
      className={cn(
        "relative flex flex-col overflow-hidden rounded-[var(--radius-app)] bg-(--color-bg-2) ring-1 ring-(--color-border-soft)",
        className,
      )}
    >
      <style>{VIEWER_CSS}</style>

      {/* 도구줄. 얇게 — 여기가 두꺼우면 논문이 그만큼 덜 보인다. */}
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-(--color-border-soft) bg-(--color-surface) px-2 py-1.5">
        <IconButton label="앞 쪽" disabled={page <= 1} onClick={() => goToPage(page - 1)}>
          <ChevronLeft className="h-4 w-4" />
        </IconButton>
        <div className="flex items-center gap-1 text-[11px] text-(--color-fg-3)">
          <input
            value={pageDraft}
            onChange={(e) => setPageDraft(e.target.value.replace(/[^0-9]/g, ""))}
            onBlur={commitPage}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitPage();
                e.currentTarget.blur();
              }
            }}
            aria-label="쪽 번호"
            className="w-10 rounded bg-(--color-bg-2) px-1.5 py-0.5 text-center text-(--color-fg) tabular-nums ring-1 ring-(--color-border-soft) outline-none focus:ring-(--color-accent)/60"
          />
          <span className="tabular-nums">/ {pageCount || "–"}</span>
        </div>
        <IconButton
          label="다음 쪽"
          disabled={pageCount > 0 && page >= pageCount}
          onClick={() => goToPage(page + 1)}
        >
          <ChevronRight className="h-4 w-4" />
        </IconButton>

        <span className="mx-1 h-4 w-px bg-(--color-border-soft)" />

        <IconButton label="축소" onClick={() => zoom(-1)}>
          <Minus className="h-4 w-4" />
        </IconButton>
        <span className="w-10 text-center text-[11px] text-(--color-fg-3) tabular-nums">
          {scalePct}%
        </span>
        <IconButton label="확대" onClick={() => zoom(1)}>
          <Plus className="h-4 w-4" />
        </IconButton>

        {/*
          폭 맞춤 ↔ 쪽 맞춤. 둘을 나란히 두지 않고 하나로 오가게 한 것은
          도구줄을 한 줄로 지키려는 것이고, 지금 어느 쪽인지는 아이콘으로 보인다.
        */}
        <IconButton
          label={fitMode === "page-width" ? "쪽 맞춤으로" : "폭 맞춤으로"}
          active={fitMode !== null}
          onClick={() => setFit(fitMode === "page-width" ? "page-fit" : "page-width")}
        >
          {fitMode === "page-width" ? (
            <Maximize className="h-4 w-4" />
          ) : (
            <MoveHorizontal className="h-4 w-4" />
          )}
        </IconButton>

        <span className="mx-1 h-4 w-px bg-(--color-border-soft)" />

        {findOpen ? (
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <Search className="h-3.5 w-3.5 shrink-0 text-(--color-fg-4)" />
            <input
              value={query}
              autoFocus
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  find("again", e.shiftKey);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  closeFind();
                }
              }}
              placeholder="문서에서 찾기"
              aria-label="문서에서 찾기"
              className="min-w-0 flex-1 rounded bg-(--color-bg-2) px-2 py-0.5 text-[11px] text-(--color-fg) ring-1 ring-(--color-border-soft) outline-none placeholder:text-(--color-fg-4) focus:ring-(--color-accent)/60"
            />
            <span
              className={cn(
                "shrink-0 text-[11px] tabular-nums",
                notFound ? "text-(--color-danger)" : "text-(--color-fg-4)",
              )}
            >
              {notFound ? "없음" : found.total ? `${found.current}/${found.total}` : ""}
            </span>
            <IconButton label="이전 결과" onClick={() => find("again", true)}>
              <ChevronUp className="h-4 w-4" />
            </IconButton>
            <IconButton label="다음 결과" onClick={() => find("again", false)}>
              <ChevronDown className="h-4 w-4" />
            </IconButton>
            <IconButton label="찾기 닫기" onClick={closeFind}>
              <X className="h-4 w-4" />
            </IconButton>
          </div>
        ) : (
          <IconButton label="문서에서 찾기" onClick={() => setFindOpen(true)}>
            <Search className="h-4 w-4" />
          </IconButton>
        )}
      </div>

      {/*
        pdf.js 는 **container 가 `position: absolute`** 이기를 요구한다 —
        아니면 생성자에서 그대로 던진다. 그래서 자리를 잡는 상자를 하나 더 두고
        그 안에 절대위치로 깐다.
      */}
      <div className="relative min-h-0 flex-1">
        <div
          ref={containerRef}
          className="pb-pdf scrollbar-thin absolute inset-0 overflow-auto"
          aria-label={`${title} 원문`}
        >
          <div ref={viewerElRef} className="pdfViewer" />
        </div>

        {status === "loading" && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <Loader2 className="h-5 w-5 animate-spin text-(--color-fg-4)" />
          </div>
        )}

        {/*
          오류는 부르는 쪽에 `onFail` 로도 알린다. 그쪽이 기본 보기로 갈아
          끼우면 이 화면은 사라진다 — 갈아 끼울 데가 없는 곳에서 쓸 때를 위해
          여기에도 한 줄 남겨 둔다.
        */}
        {status === "error" && (
          <div className="absolute inset-0 grid place-items-center px-8">
            <div className="flex max-w-sm items-start gap-2 rounded-xl bg-(--color-surface) px-4 py-3 text-xs text-(--color-danger) ring-1 ring-(--color-danger)/40">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="min-w-0 break-keep">{error}</span>
            </div>
          </div>
        )}
      </div>

      {/* 쪽 안으로 들어가는 portal 이라 트리의 어디에 두든 같다. 뷰어 곁에 둔다. */}
      <NoteLayer
        pages={pages}
        notes={notes ? [...notes] : []}
        activeId={activeNoteId ?? null}
        onPick={onPickNote}
        pending={pending}
      />
    </div>
  );
});

// ─────────────────────────────────────────────────────────────

/** 고른 자리의 아래 끝(client 좌표). 적기 상자를 그 밑에 띄우라고. */
function selectionPoint(): { x: number; y: number } | null {
  if (typeof window === "undefined") return null;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const rects = sel.getRangeAt(0).getClientRects();
  const last = rects[rects.length - 1];
  if (!last) return null;
  return { x: last.left + last.width / 2, y: last.bottom };
}

function IconButton({
  label,
  onClick,
  disabled,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        "grid h-6 w-6 shrink-0 place-items-center rounded text-(--color-fg-3) transition hover:bg-(--color-surface-hi) hover:text-(--color-fg) disabled:opacity-35 disabled:hover:bg-transparent",
        active && "text-(--color-accent-strong)",
      )}
    >
      {children}
    </button>
  );
}

/** pdfjs 가 던지는 것을 사람이 읽을 한 줄로. 이름으로 가른다 — 클래스는 번들 안에 숨어 있다. */
function readError(e: unknown): string {
  const name = e instanceof Error ? e.name : "";
  if (name === "PasswordException") return "암호가 걸린 PDF 라 열 수 없습니다";
  if (name === "InvalidPDFException") return "PDF 가 깨졌거나 PDF 가 아닙니다";
  if (name === "MissingPDFException") return "파일을 찾을 수 없습니다";
  if (name === "UnexpectedResponseException") return "파일을 받아오지 못했습니다";
  return e instanceof Error && e.message ? e.message : "PDF 를 열지 못했습니다";
}
