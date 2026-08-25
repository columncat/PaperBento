"use client";

import { fileUrl, type FileDTO } from "./types";

/**
 * 파일 내려받기.
 *
 * 예전에는 숨은 iframe 을 썼다. `<a download>` 는 브라우저의 다운로드 관리자가
 * 직접 내보내며 **서비스 워커를 거치지 않아서**, 복호화 경로인 `/dl/…` 이 워커를
 * 지나쳐 서버까지 갔고 그런 라우트가 없어 404 가 됐다. 화면에서 여는 것은
 * 멀쩡한데 다운로드만 실패하던 이유다.
 *
 * 암호화를 걷어내면서 그 우회가 통째로 필요 없어졌다. 저장된 바이트가 곧
 * 파일이라 평범한 링크로 받으면 된다.
 */

export type DownloadResult = { ok: true } | { ok: false; reason: string };

export function startDownload(file: Pick<FileDTO, "id" | "name">): DownloadResult {
  const a = document.createElement("a");
  a.href = fileUrl(file.id, true);
  a.download = file.name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  return { ok: true };
}
