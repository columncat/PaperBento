import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { logAgent } from "@/lib/agent-log";
import { db, schema } from "@/lib/db";

/**
 * 한 줄짜리 앱 설정. 늘 `id = 1` 한 행이다.
 *
 * `paper-server` 를 거치지 않고 여기서 바로 DB 를 만지는 유일한 도메인 라우트다.
 * 그 층은 "그룹·논문·요약·메모" 를 지키는 자리이고, 설정은 그 규칙과 아무
 * 관계가 없다 — 거기 끼워 넣으면 층이 무엇을 지키는 곳인지 흐려진다.
 *
 * DB 에 저장되는 모양과 화면이 받는 모양이 다르다. SQLite 에는 불리언도
 * 배열도 없어서 정수와 JSON 문자열로 눕혀 두고, 여기서 세워 내려보낸다.
 */

export const dynamic = "force-dynamic";

export interface ConfigDTO {
  /** 논문을 올릴 때 "에이전트가 서지정보를 채우기" 를 기본으로 켤지. */
  agentSuggestDefault: boolean;
  /** 요약 지시문 프리셋. 등록 시트의 드롭다운에 그대로 뜬다. */
  summaryPresets: string[];
}

const DEFAULTS: ConfigDTO = {
  agentSuggestDefault: false,
  summaryPresets: [],
};

function readConfig(): ConfigDTO {
  const row = db.select().from(schema.appConfig).where(eq(schema.appConfig.id, 1)).get();
  if (!row) return DEFAULTS;

  let presets: string[] = [];
  try {
    const parsed: unknown = row.summaryPresets ? JSON.parse(row.summaryPresets) : [];
    // 깨진 JSON 이나 배열이 아닌 것이 들어 있어도 설정 화면 전체가 죽으면 안 된다.
    if (Array.isArray(parsed)) {
      presets = parsed.filter((v): v is string => typeof v === "string");
    }
  } catch {
    presets = [];
  }

  return {
    agentSuggestDefault: row.agentSuggestDefault === 1,
    summaryPresets: presets,
  };
}

export async function GET() {
  return NextResponse.json({ config: readConfig() });
}

const putSchema = z.object({
  agentSuggestDefault: z.boolean().optional(),
  summaryPresets: z.array(z.string().trim().max(4000)).max(50).optional(),
});

export async function PUT(req: Request) {
  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const next: ConfigDTO = { ...readConfig(), ...parsed.data };

  /*
   * 넣기와 고치기를 한 문장으로 한다. 행이 없을 때 INSERT, 있을 때 UPDATE 를
   * 갈라 쓰면 첫 저장이 두 번 겹쳤을 때 한쪽이 유일 제약에 걸려 죽는다.
   */
  db.insert(schema.appConfig)
    .values({
      id: 1,
      agentSuggestDefault: next.agentSuggestDefault ? 1 : 0,
      summaryPresets: JSON.stringify(next.summaryPresets),
    })
    .onConflictDoUpdate({
      target: schema.appConfig.id,
      set: {
        agentSuggestDefault: next.agentSuggestDefault ? 1 : 0,
        summaryPresets: JSON.stringify(next.summaryPresets),
        updatedAt: new Date(),
      },
    })
    .run();

  logAgent(req, "설정 고치기", null, parsed.data);
  return NextResponse.json({ config: readConfig() });
}
