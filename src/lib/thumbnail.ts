import { kindOf } from "./file-kind";

/**
 * 업로드 전에 **브라우저에서** 썸네일을 만든다.
 * 서버에 이미지 처리 네이티브 의존성(sharp 등)을 넣지 않기 위한 선택.
 * 실패하면 null → 서버는 썸네일 없이 저장하고 UI 는 파일 아이콘으로 폴백한다.
 */

const MAX_EDGE = 400;

export async function makeThumbnail(file: File): Promise<string | null> {
  if (typeof document === "undefined") return null;
  const kind = kindOf(file.name);
  try {
    if (kind === "image") return await imageThumb(file);
    if (kind === "pdf") return await pdfThumb(file);
  } catch {
    /* 폴백: 아이콘 표시 */
  }
  return null;
}

async function imageThumb(file: File): Promise<string | null> {
  const dataUrl = await readAsDataUrl(file);
  const img = await loadImage(dataUrl);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) return null;
  return drawToDataUrl(img, w, h);
}

async function pdfThumb(file: File): Promise<string | null> {
  // pdfjs 는 무겁고 브라우저 전용이라 필요할 때만 동적으로 로드한다.
  const pdfjs = await import("pdfjs-dist");
  try {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
  } catch {
    /* 워커 URL 해석 실패 시 pdfjs 기본값 사용 */
  }

  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const page = await doc.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(1, MAX_EDGE / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  // PDF 는 투명 배경이라 흰 종이처럼 깔아준다
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  void doc.destroy();
  return encode(canvas);
}

function drawToDataUrl(
  img: HTMLImageElement,
  w: number,
  h: number,
): string | null {
  const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return encode(canvas);
}

/** webp 지원 브라우저면 webp, 아니면 png. (서버는 png/jpeg/webp 만 받는다) */
function encode(canvas: HTMLCanvasElement): string {
  const webp = canvas.toDataURL("image/webp", 0.82);
  if (webp.startsWith("data:image/webp")) return webp;
  return canvas.toDataURL("image/png");
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(new Error("파일을 읽을 수 없습니다"));
    fr.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("이미지를 불러올 수 없습니다"));
    img.src = src;
  });
}
