/**
 * pdf.js 의 CMap 과 기본 글꼴을 `public/pdfjs/` 로 옮긴다. 빌드 전에 한 번 돈다.
 *
 * **한글·한자 논문 때문에 필요하다.** CJK PDF 는 글자를 유니코드로 직접 담지 않고
 * "이 글꼴의 몇 번째 글자" 로 가리키는 일이 흔한데, 그 번호를 글자로 옮기는 표가
 * CMap 이다. pdf.js 는 이 표를 번들에 넣지 않고 **주소로 받아 간다** — 안 주면
 * 그 논문은 글자가 통째로 빠지거나 네모로 나온다. 라틴 문자는 시스템 글꼴로
 * 곱게 물러나서 이 구멍이 한동안 안 보인다.
 *
 * 기본 글꼴(standard_fonts)은 PDF 가 Helvetica·Times 같은 표준 14종을 글꼴을 안
 * 박고 이름만 적어 두었을 때 쓴다.
 *
 * git 에 넣지 않는다. 2MB 남짓의 바이너리가 저장소에 앉을 이유가 없고, 어차피
 * `node_modules` 에 있는 것을 그대로 옮기는 것이라 언제든 다시 만들 수 있다.
 * 그래서 `public/pdfjs/` 는 `.gitignore` 에 있고, 이 스크립트가 빌드마다 채운다.
 */

import { cp, mkdir, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "pdfjs-dist");
const out = join(root, "public", "pdfjs");

const PARTS = [
  ["cmaps", "cmaps"],
  ["standard_fonts", "standard_fonts"],
];

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists(src))) {
  // 의존성을 아직 안 깔았을 때. 빌드는 어차피 그다음에 멎으므로 여기서 죽이지 않는다.
  console.warn("[pdfjs-assets] pdfjs-dist 가 없습니다 — 건너뜁니다");
  process.exit(0);
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

for (const [from, to] of PARTS) {
  const a = join(src, from);
  if (!(await exists(a))) {
    console.warn(`[pdfjs-assets] ${from} 이 없습니다 — 건너뜁니다`);
    continue;
  }
  await cp(a, join(out, to), { recursive: true });
  console.log(`[pdfjs-assets] ${from} → public/pdfjs/${to}`);
}
