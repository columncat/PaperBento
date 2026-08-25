import { desc, lt } from "drizzle-orm";

import { db, schema } from "./db";

/**
 * 에이전트 활동 기록.
 *
 * MCP 로 들어온 변경만 남긴다. 사람이 화면에서 한 일은 화면에 보이지만, 에이전트가
 * 한 일은 결과만 남고 누가 왜 했는지가 사라진다.
 *
 * 판별은 요청 헤더 하나로 한다. 사람의 브라우저는 이 헤더를 붙이지 않으므로,
 * 헤더가 있으면 사람이 아닌 것이 부른 것이다. 이건 **감사 로그가 아니라 기록**이다 —
 * 헤더를 흉내낼 수 있는 쪽은 이미 API 를 통째로 쓸 수 있는 쪽이라, 위조를 막는
 * 것이 목적이 아니다.
 */

/** MCP 클라이언트가 붙이는 헤더. 값은 표시용 이름. */
export const AGENT_HEADER = "x-mb-agent";

/** 너무 오래된 기록은 지운다. 휴지통과 같은 30일. */
export const AGENT_LOG_DAYS = 30;

/** 한 번에 돌려주는 최대 줄 수. */
const PAGE = 200;

export function actorOf(req: Request): string | null {
  const raw = req.headers.get(AGENT_HEADER);
  if (!raw) return null;
  const name = raw.trim().slice(0, 40);
  return name || "agent";
}

/**
 * 한 줄 남긴다. 사람이 부른 것이면 아무 일도 하지 않는다.
 *
 * 기록에 실패해도 본래 작업은 그대로 간다 — 로그 때문에 메모 저장이 실패하면
 * 주객이 뒤바뀐다.
 */
export function logAgent(
  req: Request,
  action: string,
  target?: string | null,
  detail?: unknown,
): void {
  const actor = actorOf(req);
  if (!actor) return;
  try {
    db.insert(schema.agentLog)
      .values({
        at: new Date(),
        actor,
        action,
        target: target ?? null,
        detail: detail === undefined ? null : JSON.stringify(detail).slice(0, 2000),
      })
      .run();
  } catch {
    /* 기록 실패가 작업을 막지 않는다 */
  }
}

export interface AgentLogEntry {
  id: number;
  at: number;
  actor: string;
  action: string;
  target: string | null;
  detail: unknown;
}

export function listAgentLog(): AgentLogEntry[] {
  purgeOld();
  return db
    .select()
    .from(schema.agentLog)
    .orderBy(desc(schema.agentLog.at), desc(schema.agentLog.id))
    .limit(PAGE)
    .all()
    .map((r) => ({
      id: r.id,
      at: r.at.getTime(),
      actor: r.actor,
      action: r.action,
      target: r.target,
      detail: r.detail ? safeParse(r.detail) : null,
    }));
}

/**
 * 가장 마지막 기록 번호. **바뀌었는지만** 보려는 화면이 짧은 간격으로 부른다.
 *
 * `listAgentLog()` 를 대신 쓰면 안 된다. 그쪽은 200줄을 싣고 부를 때마다 오래된
 * 것을 지우므로, 4초마다 부르면 4초마다 DELETE 가 돈다.
 *
 * 기록을 비우면 이 값이 0 으로 **떨어진다**. 그래서 보는 쪽은 커졌는지가 아니라
 * 달라졌는지를 본다 — 그래야 한 번 헛도는 것으로 끝난다.
 */
export function latestAgentLogId(): number {
  try {
    const row = db
      .select({ id: schema.agentLog.id })
      .from(schema.agentLog)
      .orderBy(desc(schema.agentLog.id))
      .limit(1)
      .get();
    return row?.id ?? 0;
  } catch {
    return 0;
  }
}

export function clearAgentLog(): void {
  db.delete(schema.agentLog).run();
}

function purgeOld(): void {
  const cutoff = new Date(Date.now() - AGENT_LOG_DAYS * 86400000);
  db.delete(schema.agentLog).where(lt(schema.agentLog.at, cutoff)).run();
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
