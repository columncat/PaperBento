import { apiFetch } from "@/lib/api-path";
import { isUnauthenticated, readJson } from "@/lib/read-json";
import { makeThumbnail } from "@/lib/thumbnail";
import type { FileDTO, GroupDTO } from "@/lib/types";

/**
 * PDF 올리는 줄.
 *
 * MemoBento 의 transfer-queue 와 같은 3단(init/chunk/finish)이다. 큰 파일을
 * 한 번에 보내면 본문 전체가 서버 메모리에 올라가 NAS 가 죽고, Cloudflare
 * 무료 플랜의 100MB 본문 제한에도 걸린다. 조각마다 재시도하므로 300MB 짜리
 * 스캔본을 올리다 한 번 끊겼다고 처음부터 다시 하지 않는다.
 *
 * **논문 행은 서버가 만든다.** `/api/upload/finish` 가 파일을 확정하면서
 * 논문 한 편을 함께 세우고 `paperId` 를 돌려준다. 여기서 또 만들면 같은 PDF 를
 * 가리키는 논문이 둘이 된다. 그래서 이 줄이 넘겨주는 것은 "만들어라" 가 아니라
 * "방금 이 논문이 생겼다" 이고, 받는 쪽은 그걸 **고치는** 시트를 연다.
 */

export type UploadStatus =
  | "queued"
  | "preparing"
  | "uploading"
  | "done"
  | "error"
  | "canceled";

export interface UploadItem {
  id: string;
  name: string;
  size: number;
  /** 올릴 때 고른 서가. */
  groupId: string;
  status: UploadStatus;
  /** 올라간 바이트 수. */
  sent: number;
  error?: string;
  startedAt: number;
}

/** 다 올라가서 논문까지 선 것. 받는 쪽이 이걸로 등록 시트를 연다. */
export interface UploadedPaper {
  paperId: string;
  file: FileDTO;
  groupId: string;
  /** 서버가 함께 돌려준 갱신된 서재. 화면이 재조회하지 않는다. */
  groups: GroupDTO[];
}

type Listener = (items: UploadItem[]) => void;

const items: UploadItem[] = [];
const listeners = new Set<Listener>();
const canceled = new Set<string>();
const queue: { item: UploadItem; file: File }[] = [];
let running = false;
let onReady: ((uploaded: UploadedPaper) => void) | null = null;

const CHUNK_RETRIES = 3;

function emit() {
  const snapshot = items.map((i) => ({ ...i }));
  listeners.forEach((l) => l(snapshot));
}

export function subscribeUploads(l: Listener): () => void {
  listeners.add(l);
  l(items.map((i) => ({ ...i })));
  return () => {
    listeners.delete(l);
  };
}

/** 한 편이 올라갈 때마다 부를 곳. Library 가 등록 시트를 연다. */
export function setUploadSink(fn: ((uploaded: UploadedPaper) => void) | null): void {
  onReady = fn;
}

export function cancelUpload(id: string): void {
  canceled.add(id);
  const item = items.find((i) => i.id === id);
  if (item && (item.status === "queued" || item.status === "preparing")) {
    item.status = "canceled";
    emit();
  }
}

/** 끝난 항목 치우기. */
export function clearFinishedUploads(): void {
  for (let i = items.length - 1; i >= 0; i--) {
    if (["done", "error", "canceled"].includes(items[i].status)) items.splice(i, 1);
  }
  emit();
}

export function enqueueUploads(groupId: string, files: File[]): void {
  for (const file of files) {
    const item: UploadItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: file.name,
      size: file.size,
      groupId,
      status: "queued",
      sent: 0,
      startedAt: Date.now(),
    };
    items.push(item);
    queue.push({ item, file });
  }
  emit();
  void pump();
}

async function pump(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (queue.length > 0) {
      const next = queue.shift()!;
      if (canceled.has(next.item.id)) {
        next.item.status = "canceled";
        emit();
        continue;
      }
      await uploadOne(next.item, next.file);
    }
  } finally {
    running = false;
  }
}

class CanceledError extends Error {}

async function uploadOne(item: UploadItem, file: File): Promise<void> {
  item.status = "preparing";
  item.sent = 0;
  emit();

  let uploadId: string | null = null;
  try {
    /*
     * 표지는 원본을 읽어야 하므로 **올리기 전에** 만든다.
     *
     * 올린 뒤에 만들면 같은 바이트를 두 번 읽는 셈이고, 300MB 짜리에서는 그
     * 차이가 몇 초다. 실패해도 넘어간다 — 글자층 없는 스캔본이나 망가진
     * PDF 에서 pdfjs 가 터지는데, 그렇다고 파일까지 못 올릴 이유는 없다.
     * 표지가 없으면 화면이 아이콘으로 대신하고, 나중에 다시 그려 붙일 수 있다
     * (`/api/files/{id}/thumb`).
     */
    const thumb = await makeThumbnail(file);

    const initRes = await apiFetch("/api/upload/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId: item.groupId, name: file.name, size: file.size }),
    });
    const init = await readJson<{ uploadId?: string; chunkSize?: number }>(initRes);
    if (!init.uploadId || !init.chunkSize) throw new Error("업로드 자리를 받지 못했습니다");
    uploadId = init.uploadId;

    item.status = "uploading";
    emit();

    const chunkSize = init.chunkSize;
    const total = Math.max(1, Math.ceil(file.size / chunkSize));

    for (let index = 0; index < total; index++) {
      if (canceled.has(item.id)) throw new CanceledError();

      const start = index * chunkSize;
      const slice = file.slice(start, Math.min(file.size, start + chunkSize));
      const bytes = new Uint8Array(await slice.arrayBuffer());
      if (bytes.byteLength === 0) break;

      await putChunkWithRetry(uploadId, index, bytes, item);

      item.sent = Math.min(file.size, start + bytes.byteLength);
      emit();
    }

    if (canceled.has(item.id)) throw new CanceledError();

    // 표지를 확정 요청에 함께 싣는다. 따로 한 번 더 부르는 길도 있지만
    // (`putThumb`), 그건 표지가 아직 없을 때를 위한 것이다. 여기서 같이
    // 보내면 표지 없는 상태로 목록에 한 번 그려졌다 바뀌는 깜빡임이 없다.
    const finRes = await apiFetch("/api/upload/finish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uploadId, thumb: thumb ?? undefined }),
    });
    const fin = await readJson<{
      groups?: GroupDTO[];
      paperId?: string;
      file?: FileDTO;
    }>(finRes);
    if (!fin.paperId || !fin.file) throw new Error("올린 파일을 확인하지 못했습니다");

    item.status = "done";
    item.sent = file.size;
    emit();
    onReady?.({
      paperId: fin.paperId,
      file: fin.file,
      groupId: item.groupId,
      groups: fin.groups ?? [],
    });
  } catch (e) {
    /*
     * 반쯤 올라간 조각은 치운다 — 다만 로그인이 풀린 경우는 빼고.
     *
     * 큰 파일은 조각 전송에만 수십 분이 걸린다. 마지막 확정에서 세션이
     * 만료되면 조각은 이미 서버에 다 올라간 뒤인데, 여기서 지워 버리면 그
     * 수십 분이 통째로 날아간다. 지우자고 보낸 요청도 어차피 같은 이유로
     * 거절된다. 남겨 두면 서버가 때가 되면 스스로 치운다.
     */
    if (uploadId && !isUnauthenticated(e)) {
      void apiFetch(`/api/upload/finish?id=${encodeURIComponent(uploadId)}`, {
        method: "DELETE",
      }).catch(() => undefined);
    }
    if (e instanceof CanceledError || canceled.has(item.id)) {
      item.status = "canceled";
    } else {
      item.status = "error";
      item.error = isUnauthenticated(e)
        ? "로그인이 풀렸습니다. 새로고침하고 다시 시도하세요."
        : e instanceof Error
          ? e.message
          : "업로드 실패";
    }
    emit();
  }
}

async function putChunkWithRetry(
  uploadId: string,
  index: number,
  bytes: Uint8Array,
  item: UploadItem,
): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < CHUNK_RETRIES; attempt++) {
    if (canceled.has(item.id)) throw new CanceledError();
    try {
      const res = await apiFetch(
        `/api/upload/chunk?id=${encodeURIComponent(uploadId)}&index=${index}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/octet-stream" },
          body: bytes as unknown as BodyInit,
        },
      );
      if (res.ok) return;
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      lastErr = new Error(j.error ?? `HTTP ${res.status}`);
      // 4xx 는 다시 보내도 같은 답이다.
      if (res.status >= 400 && res.status < 500) throw lastErr;
    } catch (e) {
      lastErr = e;
      if (e instanceof CanceledError) throw e;
    }
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }
  throw lastErr instanceof Error ? lastErr : new Error("조각 전송 실패");
}
