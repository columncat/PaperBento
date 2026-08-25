import { NextResponse } from "next/server";

import { exportAll } from "@/lib/paper-server";

/**
 * 전체 내보내기 — 그룹·논문·요약·메모·파일 목록.
 *
 * **파일 바이트는 담기지 않는다.** 논문 하나가 수백 MB 라 JSON 에 실을 것이
 * 아니고, 어차피 그것들은 data 볼륨에 그대로 남아 있다. 되살릴 때 파일은
 * 따로 챙겨야 한다 — 이 JSON 의 `files[].path` 가 그 대조표다.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(exportAll());
}
