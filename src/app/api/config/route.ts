import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { logAgent } from "@/lib/agent-log";
import { db, schema } from "@/lib/db";
import {
  DEFAULT_BIBLIO_PROMPT,
  DEFAULT_SUMMARY_PRESETS,
  newPresetId,
  type AppConfigDTO,
  type SummaryPreset,
} from "@/lib/types";

/**
 * 한 줄짜리 앱 설정. 늘 `id = 1` 한 행이다.
 *
 * `paper-server` 를 거치지 않고 여기서 바로 DB 를 만지는 유일한 도메인 라우트다.
 * 그 층은 "그룹·논문·요약·메모" 를 지키는 자리이고, 설정은 그 규칙과 아무
 * 관계가 없다 — 거기 끼워 넣으면 층이 무엇을 지키는 곳인지 흐려진다.
 *
 * DB 에 저장되는 모양과 화면이 받는 모양이 다르다. SQLite 에는 불리언도
 * 배열도 없어서 정수와 JSON 문자열로 눕혀 두고, 여기서 세워 내려보낸다.
 *
 * ## `summary_presets` 칸은 이제 설정 한 덩어리를 담는다
 *
 * 이름은 `summary_presets` 지만 안에 든 것은 `{ v, presets, biblioPrompt }` 다.
 * 칸을 새로 파지 않은 이유는 마이그레이션이다 — 이 칸은 애초에 "JSON 문자열
 * 자루" 이고 세우고 눕히는 코드가 전부 이 파일 안에 있어서, 안에 든 모양을
 * 넓히는 데는 스키마도 마이그레이션 번호도 필요 없다. 칸을 파면 번호를 하나
 * 잡아야 하고, 같은 번호를 다른 변경이 함께 잡으면 배포한 DB 가 갈라진다.
 * 나중에 여유가 생기면 `biblio_prompt` 칸으로 옮기면 되고, 그때도 아래
 * `readStored` 한 곳만 갈래를 하나 더 타면 된다.
 *
 * ## 옛 모양을 읽는 자리는 `toPresets()` 한 곳이다
 *
 * 프리셋은 예전에 **문자열 배열**이었고 "첫 줄이 이름, 전문이 지시문" 이라는
 * 규칙을 달고 있었다. 이미 저장해 둔 사람의 프리셋이 갑자기 사라지면 안 되므로
 * 읽을 때 갈라 읽는다. 변환을 화면에 두지 않은 것은 일부러다 — 화면에 두면
 * MCP 로 들어오는 PUT 이 그 길을 안 지나고, 옛 모양이 조용히 다시 저장된다.
 */

export const dynamic = "force-dynamic";

/** 화면이 받는 모양. `AppConfigDTO` 와 같은 것이다 — 두 벌로 적으면 갈라진다. */
export type ConfigDTO = AppConfigDTO;

/** 프리셋 개수 상한. 목록으로 훑을 수 있는 선. */
const MAX_PRESETS = 50;

const DEFAULTS: ConfigDTO = {
  agentSuggestDefault: false,
  summaryPresets: [...DEFAULT_SUMMARY_PRESETS],
  biblioPrompt: DEFAULT_BIBLIO_PROMPT,
};

/**
 * 아무 모양이나 받아 프리셋 목록으로 세운다.
 *
 * 읽을 때(옛 문자열 배열)와 쓸 때(화면·MCP 가 보낸 것) 둘 다 이 문을 지난다.
 * `id` 가 없거나 겹치면 여기서 새로 붙인다 — 화면이 그걸 열쇠로 쓰기 때문에
 * 겹친 id 하나가 "다른 줄을 고쳤는데 이 줄이 바뀌는" 사고가 된다.
 */
function toPresets(value: unknown): SummaryPreset[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const out: SummaryPreset[] = [];

  for (const [i, raw] of value.slice(0, MAX_PRESETS).entries()) {
    const one = toPreset(raw);
    if (!one) continue;
    const want = one.id || derivedPresetId(one, i);
    const id = seen.has(want) ? newPresetId() : want;
    seen.add(id);
    out.push({ ...one, id });
  }
  return out;
}

/**
 * id 가 없는 줄에 붙일 손잡이. **같은 입력에는 같은 값이 나와야 한다.**
 *
 * 옛 문자열 배열에는 id 가 없다. 여기서 `newPresetId()` 로 아무 값이나 붙이면
 * 읽을 때마다 다른 id 가 나온다 — 그 DB 는 아직 새 모양으로 저장된 적이 없어서
 * GET 이 매번 다시 세우기 때문이다. 그러면 설정 화면이 "서버가 아는 마지막
 * 모습" 과 지금 화면을 견주는 자리에서 id 만 달라져도 다르다고 보고, 아무것도
 * 안 고쳤는데 저장 안 된 것이 있다며 창을 닫을 때 붙잡는다. 자리와 글에서
 * 값을 끌어내면 그 왕복이 조용해진다.
 *
 * 겹치면 부르는 쪽이 `newPresetId()` 로 물러난다 — 손잡이가 겹치는 것보다는
 * 흔들리는 편이 낫다.
 */
function derivedPresetId(one: SummaryPreset, i: number): string {
  let h = 2166136261;
  for (const ch of `${i}\u0000${one.name}\u0000${one.prompt}`) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 16777619);
  }
  return `p-d${(h >>> 0).toString(36)}`;
}

function toPreset(raw: unknown): SummaryPreset | null {
  /*
   * 옛 모양. 첫 줄이 이름이었고 전문이 지시문이었다.
   *
   * 한 줄짜리였다면 그 한 줄이 이름이자 지시문이다. 이름만 남기고 지시문을
   * 비우면 요약 상자에서 실행 단추가 안 눌린다 — 되살리려던 것을 되살리다가
   * 못 쓰게 만드는 셈이라, 그때는 같은 글을 양쪽에 둔다.
   */
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return null;
    const nl = text.indexOf("\n");
    const name = (nl === -1 ? text : text.slice(0, nl)).trim();
    const prompt = (nl === -1 ? text : text.slice(nl + 1)).trim();
    return { id: "", name: name || "이름 없는 지시문", prompt: prompt || text };
  }

  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.trim() : "";
    const prompt = typeof o.prompt === "string" ? o.prompt.trim() : "";
    // 둘 다 비었으면 줄이 아니다. 빈 줄이 목록에 쌓이면 지우기만 늘어난다.
    if (!name && !prompt) return null;
    return {
      id: typeof o.id === "string" ? o.id.trim() : "",
      name: name || "이름 없는 지시문",
      prompt: prompt || name,
    };
  }

  return null;
}

/** 칸에 든 JSON 을 갈래 타서 읽는다. 깨져 있어도 설정 화면 전체가 죽으면 안 된다. */
function readStored(raw: string | null): { presets: SummaryPreset[]; biblioPrompt: string } {
  if (!raw) return { presets: [], biblioPrompt: "" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { presets: [], biblioPrompt: "" };
  }

  // 옛 모양: 문자열 배열이 통째로 들어 있었다.
  if (Array.isArray(parsed)) return { presets: toPresets(parsed), biblioPrompt: "" };

  if (parsed && typeof parsed === "object") {
    const o = parsed as Record<string, unknown>;
    return {
      presets: toPresets(o.presets),
      biblioPrompt: typeof o.biblioPrompt === "string" ? o.biblioPrompt.trim() : "",
    };
  }

  return { presets: [], biblioPrompt: "" };
}

function readConfig(): ConfigDTO {
  const row = db.select().from(schema.appConfig).where(eq(schema.appConfig.id, 1)).get();
  if (!row) return DEFAULTS;

  const stored = readStored(row.summaryPresets);

  return {
    agentSuggestDefault: row.agentSuggestDefault === 1,
    /*
     * 비어 있으면 기본 목록으로 대신한다.
     *
     * 그래서 **프리셋을 전부 지우면 기본값이 돌아온다.** 지운 상태를 그대로
     * 두는 길은 없다. 고를 것이 하나도 없는 요약 상자는 고장 난 것과 구별되지
     * 않고, 그런 화면을 남길 이유가 없다. 설정 화면이 마지막 하나의 지우기를
     * 막지만 그건 앞문일 뿐이고, MCP 로 빈 배열이 들어오는 뒷문은 여기서 막는다.
     */
    summaryPresets: stored.presets.length > 0 ? stored.presets : [...DEFAULT_SUMMARY_PRESETS],
    biblioPrompt: stored.biblioPrompt || DEFAULT_BIBLIO_PROMPT,
  };
}

export async function GET() {
  return NextResponse.json({ config: readConfig() });
}

const presetSchema = z.object({
  id: z.string().trim().max(64).optional(),
  name: z.string().trim().max(120),
  prompt: z.string().trim().max(4000),
});

const putSchema = z.object({
  agentSuggestDefault: z.boolean().optional(),
  /*
   * 옛 문자열도 계속 받는다. 밖에 나가 있는 스크립트나 MCP 호출이 아직 그
   * 모양으로 보낼 수 있고, 400 으로 되받으면 그쪽에서는 "설정 저장이 깨졌다"
   * 로만 보인다. 어느 쪽으로 들어오든 `toPresets()` 가 같은 모양으로 세운다.
   */
  summaryPresets: z
    .array(z.union([z.string().trim().max(4200), presetSchema]))
    .max(MAX_PRESETS)
    .optional(),
  biblioPrompt: z.string().trim().max(4000).optional(),
});

export async function PUT(req: Request) {
  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const current = readConfig();
  /*
   * 펼치기(`{...current, ...parsed.data}`)로 합치지 않는다. 프리셋은 그냥
   * 갈아 끼우면 안 되고 `toPresets()` 를 지나야 하는데, 펼치기는 그 문을
   * 조용히 건너뛴다.
   */
  const next: ConfigDTO = {
    agentSuggestDefault: parsed.data.agentSuggestDefault ?? current.agentSuggestDefault,
    summaryPresets: parsed.data.summaryPresets
      ? toPresets(parsed.data.summaryPresets)
      : current.summaryPresets,
    biblioPrompt: parsed.data.biblioPrompt ?? current.biblioPrompt,
  };

  const blob = JSON.stringify({
    v: 2,
    presets: next.summaryPresets,
    biblioPrompt: next.biblioPrompt,
  });

  /*
   * 넣기와 고치기를 한 문장으로 한다. 행이 없을 때 INSERT, 있을 때 UPDATE 를
   * 갈라 쓰면 첫 저장이 두 번 겹쳤을 때 한쪽이 유일 제약에 걸려 죽는다.
   */
  db.insert(schema.appConfig)
    .values({
      id: 1,
      agentSuggestDefault: next.agentSuggestDefault ? 1 : 0,
      summaryPresets: blob,
    })
    .onConflictDoUpdate({
      target: schema.appConfig.id,
      set: {
        agentSuggestDefault: next.agentSuggestDefault ? 1 : 0,
        summaryPresets: blob,
        updatedAt: new Date(),
      },
    })
    .run();

  logAgent(req, "설정 고치기", null, parsed.data);
  return NextResponse.json({ config: readConfig() });
}
