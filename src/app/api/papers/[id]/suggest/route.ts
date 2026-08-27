import { NextResponse } from "next/server";
import { z } from "zod";

import { logAgent } from "@/lib/agent-log";
import { getPaperRow } from "@/lib/paper-server";
import {
  advance,
  agentReady,
  latestSuggestion,
  markApplied,
  readSuggestion,
  startBiblio,
  type BiblioClue,
} from "@/lib/suggest";

/**
 * 에이전트가 낸 서지정보 **제안**.
 *
 * ## 여기서 논문이 바뀌지 않는다
 *
 * 이 라우트가 하는 일은 제안을 만들고, 보여 주고, "적용했다" 고 표시하는 것뿐
 * 이다. `papers` 를 쓰는 코드가 한 줄도 없다. 논문이 바뀌는 것은 사람이 화면에서
 * 값을 확인하고 누른 뒤 평소의 `PATCH /api/papers/:id` 로 가는 그 요청이다.
 *
 * **일부러 두 요청으로 갈라 두었다.** 하나로 묶으면 "제안 적용" 이라는 이름의
 * 논문 쓰기 API 가 생기고, 그러면 언젠가 누군가 그걸 에이전트에게 열어 준다.
 * 그 순간 논문 PDF 안에 심어진 문장이 곧 DB 쓰기가 된다. 갈라 두면 그럴 자리가
 * 애초에 없다.
 *
 * ## 오래 걸리는 일이라 시작과 끝이 다른 요청이다
 *
 * POST 로 시작만 시키고 번호를 받는다. GET 으로 몇 초마다 물어본다. 답을
 * 기다리며 요청을 붙들면 앞의 Cloudflare 터널이 100초에서 끊는다 — MemoBento
 * 채팅창이 그렇게 겪었고, 화면에는 "failed to fetch" 만 떴다.
 *
 * **GET 이 진행을 민다.** 순수한 읽기가 아닌 것은 알고 쓴다. 서버 타이머에만
 * 맡기면 프로세스가 다시 뜰 때 진행 중이던 것이 영영 `running` 으로 남는다.
 *
 * ## 찾아오기가 먼저다
 *
 * POST 는 `clue` 를 함께 받는다 — 화면이 doi.org·arXiv·Crossref 에서 **먼저**
 * 받아 온 서지정보다. 등록기관이 준 값은 정확한 것이고 모델이 PDF 를 읽어
 * 내놓는 것은 추측이라, 순서를 뒤집으면 같은 칸에 두 값이 앉고 어느 쪽이
 * 맞는지 사람이 가려야 한다. 단서를 함께 넘겨 **남은 빈 칸만** 메우게 한다.
 *
 * 찾아오기를 여기서 돌지 않는 이유는 제목 검색이 후보를 여럿 내놓기 때문이다.
 * 무엇을 단서로 삼을지는 사람이 화면에서 보고 정한 것이어야 한다.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 찾아오기가 먼저 받아 온 값 — 에이전트에게 함께 넘길 **단서**.
 *
 * 화면이 실어 보내는 것이라 그대로 믿지 않는다. **여기가 허용목록의 자리다** —
 * 아는 칸만 취하고(zod 는 모르는 키를 말없이 버린다) 길이도 여기서 자른다.
 * 이 덩어리는 결국 프롬프트에 실리므로, 아무 모양이나 통과시키면 브라우저에서
 * 프롬프트를 쓸 수 있게 된다. 값이 다 널이면 단서가 없는 것으로 친다.
 *
 * CSL 원본을 통째로 받지 않는 것도 같은 이유다. 우리가 프롬프트에 넣고 싶은
 * 것은 여덟 칸뿐이고, 그 이상을 받으면 그 이상이 언젠가 프롬프트로 흘러간다.
 */
const clueSchema = z.object({
  source: z.enum(["doi", "arxiv", "crossref"]).optional(),
  title: z.string().max(500).nullish(),
  authors: z.string().max(1000).nullish(),
  venue: z.string().max(300).nullish(),
  year: z.number().int().min(1000).max(3000).nullish(),
  doi: z.string().max(200).nullish(),
  arxivId: z.string().max(60).nullish(),
  abstract: z.string().max(4000).nullish(),
  url: z.string().max(500).nullish(),
});

const postSchema = z.object({
  kind: z.literal("biblio").default("biblio"),
  clue: clueSchema.nullish(),
});

const patchSchema = z.object({
  /** 사람이 적용을 누른 제안. 이 표시는 논문을 바꾸지 않는다. */
  id: z.string().min(1).max(64),
  applied: z.literal(true),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const paper = getPaperRow(id);
  if (!paper) {
    return NextResponse.json({ error: "논문을 찾을 수 없습니다" }, { status: 404 });
  }

  const parsed = postSchema.safeParse((await req.json().catch(() => null)) ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  /*
   * 부를 수 없으면 **줄을 만들지 않고** 여기서 돌아선다.
   *
   * `startBiblio` 에 맡겨도 실패로 끝나기는 한다. 다만 그때는 실패한 제안
   * 행이 하나 남고, 그게 이 논문의 "가장 최근 제안" 이 되어 다음에 시트를 열
   * 때마다 옛 실패가 먼저 보인다. 설정이 안 된 것은 이 논문의 문제가 아니다.
   */
  const ready = agentReady();
  if (!ready.ready) {
    return NextResponse.json({ error: ready.reason, agent: ready }, { status: 503 });
  }

  const clue = (parsed.data.clue ?? null) as BiblioClue | null;
  const suggestion = await startBiblio(id, clue);
  logAgent(req, "서지정보 제안 요청", paper.title, {
    suggestionId: suggestion.id,
    // 무엇을 단서로 줬는지 남긴다. 값 자체가 아니라 출처만 — 기록은 되짚는
    // 자리이지 서지정보를 한 벌 더 두는 자리가 아니다.
    clue: clue ? (clue.source ?? "lookup") : null,
  });

  /*
   * 시작 자리에서 이미 실패했으면 그대로 알린다 (스캔본이라 글자가 없거나,
   * 에이전트에 닿지 못했거나). 202 로 돌려주고 폴링하게 두면 사람은 몇 초를
   * 기다린 뒤에야 같은 소식을 듣는다.
   */
  return NextResponse.json({ suggestion }, { status: suggestion.state === "failed" ? 502 : 202 });
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getPaperRow(id)) {
    return NextResponse.json({ error: "논문을 찾을 수 없습니다" }, { status: 404 });
  }

  /*
   * 부를 수 있는지도 함께 내려보낸다.
   *
   * 시트는 열릴 때 이 한 번의 요청으로 **토글을 켤지**와 **이미 받아 둔 제안이
   * 있는지**를 같이 안다. 못 부르는데 켜 두고 누를 때 실패하는 것은 없느니만
   * 못하다 — 사람은 PDF 를 의심하고, 진짜 이유(환경변수)는 화면 어디에도
   * 안 나온다.
   */
  const agent = agentReady();

  const wanted = new URL(req.url).searchParams.get("id");
  const row = wanted ? readSuggestion(wanted) : latestSuggestion(id, "biblio");
  if (!row) return NextResponse.json({ suggestion: null, agent });
  // 남의 논문 제안을 번호만 알면 읽을 수 있게 두지 않는다.
  if (row.paperId !== id) return NextResponse.json({ suggestion: null, agent });

  // 아직 도는 중이면 한 걸음 민다. 이 요청이 진행의 주된 힘이다.
  const fresh = row.state === "running" ? ((await advance(row.id)) ?? row) : row;
  return NextResponse.json({ suggestion: fresh, agent });
}

/**
 * "이 제안을 봤고 적용했다" 는 표시.
 *
 * 논문을 바꾸는 것은 이 요청이 아니다. 화면은 먼저 `PATCH /api/papers/:id` 로
 * 사람이 확인한 값을 저장하고, 그다음에 여기로 표시만 남긴다. 순서가 그래야
 * 저장이 실패했는데 "적용됨" 으로 남는 일이 없다.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const paper = getPaperRow(id);
  if (!paper) {
    return NextResponse.json({ error: "논문을 찾을 수 없습니다" }, { status: 404 });
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const row = readSuggestion(parsed.data.id);
  if (!row || row.paperId !== id) {
    return NextResponse.json({ error: "제안을 찾을 수 없습니다" }, { status: 404 });
  }

  markApplied(row.id);
  logAgent(req, "서지정보 제안 적용 표시", paper.title, { suggestionId: row.id });
  return NextResponse.json({ suggestion: readSuggestion(row.id) });
}
