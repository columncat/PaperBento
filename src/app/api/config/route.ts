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
  /**
   * 요약 지시문 프리셋.
   *
   * **한 프리셋의 첫 줄이 이름이고, 전문이 지시문이다.** 이름과 지시문을
   * 각각 든 객체로 두지 않은 이유는 `AppConfigDTO.summaryPresets` 가 이미
   * `string[]` 이기 때문이다 — 모양을 바꾸면 화면·서버·설정 저장이 함께
   * 흔들리는데, 얻는 것은 칸 하나뿐이다.
   *
   * 이 규칙 덕분에 요약 실행 상자가 바라던 모양이 그냥 나온다. 접었을 때는
   * 첫 줄만 한 줄로 보이고, 펼치면 전문이 보인다.
   */
  summaryPresets: string[];
}

/**
 * 처음 켰을 때 쓸 지시문들.
 *
 * 프리셋이 하나도 없으면 요약 상자에 고를 것이 없고, 사람은 매번 지시문을
 * 손으로 적어야 한다. 그건 "에이전트에게 맡기기" 를 한 번도 안 누르게 되는
 * 가장 빠른 길이다. 그래서 저장된 것이 비어 있으면 이 목록으로 대신한다 —
 * 사람이 한 번이라도 고치면 그때부터는 고친 것이 이긴다.
 */
const DEFAULT_SUMMARY_PRESETS: string[] = [
  [
    "핵심만 다섯 줄",
    "이 논문의 핵심을 다섯 줄 안팎으로 정리해 주세요. 무엇을 풀려고 했는지,",
    "어떻게 풀었는지, 무엇이 새로운지, 결과가 어땠는지, 한계가 무엇인지를",
    "각각 한 줄씩 담아 주세요.",
  ].join("\n"),
  [
    "한 쪽 요약",
    "이 논문을 한 쪽 분량으로 요약해 주세요. 배경과 문제, 제안하는 방법,",
    "실험 설정과 결과, 저자가 인정한 한계 순서로 소제목을 달아 주세요.",
    "수치는 논문에 적힌 것만 쓰고, 없으면 없다고 적어 주세요.",
  ].join("\n"),
  [
    "방법과 실험 위주",
    "방법과 실험에 초점을 맞춰 정리해 주세요. 모델·알고리즘의 구조,",
    "학습·평가에 쓴 자료, 비교 대상, 측정 지표, 주요 수치를 담아 주세요.",
    "배경 설명과 관련 연구는 짧게 넘어가도 됩니다.",
  ].join("\n"),
  [
    "기존 연구와 무엇이 다른가",
    "이 논문이 기존 연구와 무엇이 다른지에 초점을 맞춰 정리해 주세요.",
    "저자가 어떤 선행 연구를 들고 있고, 그 한계를 무엇이라고 말하며,",
    "그것을 어떻게 넘어섰다고 주장하는지 적어 주세요. 그 주장이 실험으로",
    "뒷받침되는지도 함께 짚어 주세요.",
  ].join("\n"),
  [
    "내가 다시 만들 수 있게",
    "이 논문을 직접 구현해 보려는 사람에게 필요한 것을 정리해 주세요.",
    "입력과 출력, 핵심 수식이나 절차, 하이퍼파라미터, 필요한 자료와 계산량,",
    "논문에 안 적혀 있어 막힐 만한 자리를 짚어 주세요.",
  ].join("\n"),
];

const DEFAULTS: ConfigDTO = {
  agentSuggestDefault: false,
  summaryPresets: DEFAULT_SUMMARY_PRESETS,
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
    /*
     * 비어 있으면 기본 목록으로 대신한다.
     *
     * 그래서 **프리셋을 전부 지우면 기본값이 돌아온다.** 지운 상태를 그대로
     * 두는 길은 없다. 고를 것이 하나도 없는 요약 상자는 고장 난 것과 구별되지
     * 않고, 그런 화면을 남길 이유가 없다. 마음에 안 드는 프리셋은 지우는 것이
     * 아니라 고쳐 쓰는 것이다.
     */
    summaryPresets: presets.length > 0 ? presets : DEFAULT_SUMMARY_PRESETS,
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
