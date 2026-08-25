import type { FileKind } from "./db/schema";

/**
 * 파일 분류는 **확장자**로 판별한다 (브라우저가 보내는 MIME 은 신뢰하지 않음).
 * image / pdf / text 는 앱 안에서 열람 가능, file 은 클릭 즉시 다운로드.
 *
 * 논문함에서 실제로 오는 것은 거의 pdf 하나지만, 표를 좁혀 두면 나중에
 * 보충자료(zip·csv)를 받기 시작할 때 되돌려 넓혀야 한다. MemoBento 것을 그대로 둔다.
 */

export const IMAGE_EXT = new Set([
  "png",
  "jpg",
  "jpeg",
  "jfif",
  "gif",
  "webp",
  "avif",
  "bmp",
  "svg",
  "ico",
  "heic",
  "heif",
  "tif",
  "tiff",
]);

export const PDF_EXT = new Set(["pdf"]);

export const TEXT_EXT = new Set([
  "txt",
  "text",
  "md",
  "markdown",
  "rst",
  "log",
  "csv",
  "tsv",
  "json",
  "jsonl",
  "yaml",
  "yml",
  "toml",
  "ini",
  "cfg",
  "conf",
  "env",
  "properties",
  "xml",
  "svgz",
  "html",
  "htm",
  "css",
  "scss",
  "sass",
  "less",
  "js",
  "mjs",
  "cjs",
  "jsx",
  "ts",
  "mts",
  "cts",
  "tsx",
  "vue",
  "svelte",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "kt",
  "kts",
  "swift",
  "c",
  "h",
  "cc",
  "cpp",
  "hpp",
  "cs",
  "php",
  "pl",
  "lua",
  "r",
  "sql",
  "sh",
  "bash",
  "zsh",
  "fish",
  "bat",
  "cmd",
  "ps1",
  "dockerfile",
  "gitignore",
  "editorconfig",
  "srt",
  "vtt",
  "ass",
  "tex",
  "bib",
  "diff",
  "patch",
]);

/** 파일명에서 소문자 확장자 추출 (점 없음). 없으면 "". */
export function extOf(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  const i = base.lastIndexOf(".");
  if (i <= 0 || i === base.length - 1) {
    // ".gitignore" 처럼 점으로 시작하는 이름은 전체를 확장자로 본다
    return base.startsWith(".") ? base.slice(1).toLowerCase() : "";
  }
  return base.slice(i + 1).toLowerCase();
}

export function kindOf(filename: string): FileKind {
  const ext = extOf(filename);
  if (IMAGE_EXT.has(ext)) return "image";
  if (PDF_EXT.has(ext)) return "pdf";
  if (TEXT_EXT.has(ext)) return "text";
  return "file";
}

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jfif: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  heic: "image/heic",
  heif: "image/heif",
  tif: "image/tiff",
  tiff: "image/tiff",
  pdf: "application/pdf",
  json: "application/json",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  js: "text/javascript",
  mjs: "text/javascript",
  md: "text/markdown",
  xml: "application/xml",
  zip: "application/zip",
  "7z": "application/x-7z-compressed",
  rar: "application/vnd.rar",
  gz: "application/gzip",
  tar: "application/x-tar",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
};

/**
 * 응답에 쓸 Content-Type. 확장자 우선, 없으면 업로드 MIME, 그것도 없으면 octet-stream.
 * text 계열은 UTF-8 을 명시해 브라우저가 깨진 글자로 렌더하지 않게 한다.
 */
export function contentTypeFor(filename: string, uploadedMime?: string): string {
  const ext = extOf(filename);
  const known = MIME_BY_EXT[ext];
  if (known) {
    return known.startsWith("text/") ? `${known}; charset=utf-8` : known;
  }
  if (kindOf(filename) === "text") return "text/plain; charset=utf-8";
  if (uploadedMime && uploadedMime !== "application/octet-stream") {
    return uploadedMime;
  }
  return "application/octet-stream";
}

/**
 * inline(Content-Disposition: inline)으로 내려도 되는 타입인가.
 * 그 외에는 attachment 로 강제해 브라우저가 렌더하지 않게 한다.
 *
 * 주의: SVG/HTML 처럼 스크립트를 품을 수 있는 타입도 여기서는 inline 이지만,
 * 파일 라우트가 모든 응답에 `Content-Security-Policy: sandbox` 와
 * `X-Content-Type-Options: nosniff` 를 붙여 스크립트 실행을 차단한다.
 */
export function isInlineSafe(filename: string): boolean {
  const kind = kindOf(filename);
  return kind === "image" || kind === "pdf" || kind === "text";
}

/**
 * 업로드 파일 응답에 붙일 CSP.
 *
 * 기본은 `sandbox` — 불투명 오리진 + 스크립트 금지라, SVG/HTML 을 직접 열어도
 * 우리 오리진의 쿠키·DOM 에 손댈 수 없다.
 *
 * PDF 만 예외로 `allow-scripts` 를 준다. 브라우저 내장 PDF 뷰어가 스크립트로
 * 동작하기 때문에 순수 `sandbox` 로는 빈 화면이 된다. `allow-same-origin` 은
 * 여전히 빼므로 오리진은 불투명하게 유지된다 (PDF 안의 스크립트가 우리 쪽을
 * 건드릴 수 없음).
 */
export function cspFor(filename: string): string {
  return kindOf(filename) === "pdf" ? "sandbox allow-scripts" : "sandbox";
}
