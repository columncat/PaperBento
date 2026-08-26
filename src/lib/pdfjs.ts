/**
 * pdfjs 로 들어가는 문. **다른 곳에서 `pdfjs-dist` 를 직접 import 하지 않는다.**
 *
 * 한 곳으로 몰아 둔 이유가 셋이다.
 *
 * 1. **워커가 두 벌 뜬다.** `GlobalWorkerOptions.workerSrc` 는 모듈 전역이라
 *    여러 곳에서 각자 정하면 마지막 것이 이긴다. 표지를 만드는 쪽
 *    (`lib/thumbnail.ts`)과 뷰어가 서로 다른 주소를 적어 두면 브라우저가
 *    워커 스크립트를 두 번 내려받고 두 벌 띄운다.
 *
 * 2. **순서를 틀리면 죽는다.** `pdfjs-dist/web/pdf_viewer.mjs` 는 코어를 자기
 *    안에 담고 있지 않고, **모듈이 평가되는 그 순간** `globalThis.pdfjsLib` 를
 *    구조분해한다 (파일 안: `const { getDocument, … } = globalThis.pdfjsLib`).
 *    코어를 먼저 올려 전역에 얹지 않으면 import 하는 자리에서
 *    "Cannot destructure property … of undefined" 로 멎는다. 이 순서를 아는
 *    코드가 한 벌뿐이어야 다음 사람이 밟지 않는다.
 *
 * 3. **번들이 무겁다.** 코어와 뷰어를 합치면 1MB 가 넘는다. 둘 다 `import()`
 *    뒤에 숨겨 두어 실제로 PDF 를 여는 화면에서만 내려받게 한다. 그래서 이
 *    파일이 내보내는 것은 모듈이 아니라 **모듈을 가져오는 함수**다.
 *
 * `next.config.mjs` 의 `serverExternalPackages` 에 `pdfjs-dist` 를 넣으면
 * 아래 `new URL(...)` 이 CJS require 로 풀리려다 빌드가 깨진다. 넣지 마라.
 */

export type PdfjsCore = typeof import("pdfjs-dist");
export type PdfjsUi = typeof import("pdfjs-dist/web/pdf_viewer.mjs");

/**
 * 글자층 모드. `pdf_viewer.mjs` 가 내보내지 않아 손으로 옮겨 적는다.
 *
 * 숫자를 부르는 쪽에 그대로 박으면 뜻이 사라지고, pdfjs 판이 올라 값의 의미가
 * 바뀌었을 때 조용히 다른 동작이 된다 — 실제로 옛 pdfjs 의 `2` 는
 * `ENABLE_ENHANCE` 였고 지금은 `ENABLE_PERMISSIONS` 다.
 *
 * `ENABLE_PERMISSIONS` 는 선택은 되지만 **복사를 막는다.** 앵커를 잡는 데는
 * 선택만 있으면 되므로 뷰어는 `ENABLE` 을 쓴다 — 논문에서 문장을 복사하는 것은
 * 막을 이유가 없는 일상 동작이다. (pdfjs 4.10 기준)
 */
export const TextLayerMode = {
  DISABLE: 0,
  ENABLE: 1,
  ENABLE_PERMISSIONS: 2,
} as const;

let corePromise: Promise<PdfjsCore> | null = null;
let uiPromise: Promise<PdfjsUi> | null = null;

/**
 * 코어만. 표지를 그리는 것처럼 화면 없이 쪽을 렌더할 때 쓴다.
 *
 * 한 번 시작한 import 는 약속을 그대로 재사용한다. 두 곳에서 동시에 불러도
 * 워커 주소는 한 번만 정해진다.
 */
export function loadPdfjs(): Promise<PdfjsCore> {
  corePromise ??= import("pdfjs-dist").then((core) => {
    try {
      /*
       * 워커 주소를 번들러에게 물어본다. 이 `new URL(…, import.meta.url)` 꼴을
       * webpack 이 알아보고 워커 파일을 정적 자산으로 뽑아 주소까지 맞춰 준다 —
       * 하위 경로(`/paper`) 배포에서도 이 길은 `apiPath` 가 필요 없다.
       */
      core.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
    } catch {
      /*
       * 주소를 못 풀면 pdfjs 기본값(가짜 워커)에 맡긴다. 느려질 뿐 멈추지는
       * 않는다 — 여기서 throw 하면 PDF 가 아예 안 열린다.
       */
    }
    return core;
  });
  return corePromise;
}

/**
 * 코어 + 뷰어 컴포넌트(`PDFViewer`·`EventBus`·`PDFLinkService`·`PDFFindController`).
 *
 * 위 2번 때문에 **반드시 이 함수를 거쳐야 한다.** 전역에 코어를 얹는 일과
 * 뷰어를 import 하는 일이 이 안에서만 붙어 있다.
 */
export async function loadPdfViewer(): Promise<{ core: PdfjsCore; ui: PdfjsUi }> {
  const core = await loadPdfjs();
  uiPromise ??= (async () => {
    // ↓ import 보다 **먼저**. 이 줄을 옮기면 다음 줄에서 죽는다.
    (globalThis as { pdfjsLib?: PdfjsCore }).pdfjsLib = core;
    return import("pdfjs-dist/web/pdf_viewer.mjs");
  })();
  return { core, ui: await uiPromise };
}
