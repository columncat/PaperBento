/*
 * SQLite 연결 한 개와 그 위의 drizzle 한 개.
 *
 * 앱 어디서든 `import { db } from "@/lib/db"` 로만 닿는다. 연결을 여기저기서
 * 열면 WAL 설정과 마이그레이션이 여러 번 돌고, 그중 하나만 pragma 를 빼먹는
 * 날이 온다.
 */
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import Database from "better-sqlite3";
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { env } from "../env";
import * as schema from "./schema";

type DB = BetterSQLite3Database<typeof schema>;

/**
 * 지연 초기화 — DB 연결/마이그레이션은 첫 쿼리(런타임) 때 1회만 수행한다.
 * `next build` 의 page-data 수집 단계에서 모듈이 import 되어도 DB 파일을 열지 않으므로,
 * 병렬 빌드 워커가 WAL 설정(쓰기)으로 충돌해 "database is locked" 가 나던 문제를 막는다.
 */
let _db: DB | null = null;

function init(): DB {
  const dbPath = resolve(env.DATABASE_PATH);
  mkdirSync(dirname(dbPath), { recursive: true });

  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000"); // 동시 접근 시 즉시 실패 대신 대기
  /*
   * 외래키 강제. **끄면 안 된다.**
   *
   * SQLite 는 이 pragma 가 연결마다 꺼진 채로 시작한다. 다른 앱에서는 켜 두는
   * 것이 "그래도 켜는 편이 낫다" 정도지만, 여기서는 스키마가 여기에 기대고 있다 —
   * 그룹의 두 단 제한이 `(parent_id, parent_depth) → (id, depth)` 복합 외래키로
   * 걸려 있어서, 이걸 끄면 3단 그룹이 DB 를 그대로 통과한다.
   * 지우기가 딸려 지워지는 것(cascade)도 함께 죽는다.
   */
  sqlite.pragma("foreign_keys = ON");

  const drizzleDb = drizzle(sqlite, { schema });

  try {
    const migrationsFolder =
      process.env.MIGRATIONS_DIR ?? resolve(process.cwd(), "drizzle");
    migrate(drizzleDb, { migrationsFolder });
  } catch (err) {
    console.error("[paperbento] migration failed:", err);
  }

  return drizzleDb;
}

function getDb(): DB {
  // Node 는 단일 스레드 + init() 은 동기이므로 경쟁 조건 없음.
  if (!_db) _db = init();
  return _db;
}

/** import 시점엔 연결하지 않고, 실제 사용(프로퍼티 접근) 때 초기화하는 프록시. */
export const db = new Proxy({} as DB, {
  get(_target, prop) {
    const real = getDb() as unknown as Record<string | symbol, unknown>;
    const value = real[prop];
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(real)
      : value;
  },
}) as DB;

export { schema };
