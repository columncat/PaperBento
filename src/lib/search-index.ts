import { db } from "./db";
import { FRONT_FIELDS, normalizeForSearch, type FrontField } from "./filter-papers";

/**
 * 접어 둔 서재 — **찾기가 실제로 뒤지는 글자.**
 *
 * `search.ts` 는 여기서 받은 접힌 글자에 `includes` 를 할 뿐이다. 브라우저의
 * 즉시 거르기(`filter-papers.ts` 의 `matchFront`)도 같은 함수로 접은 글자에
 * 같은 `includes` 를 한다. **접기가 한 벌이고 견주는 방법까지 같으므로**
 * "즉시 거르기는 서버 답의 부분집합" 이 지켜야 할 규율이 아니라 정의가 된다.
 *
 * ── 왜 SQL 이 아니라 여기인가 ──
 *
 * 예전에는 낱말마다 "이건 SQLite `LIKE` 로 견줘도 되나" 를 `needsUnicodeFold`
 * 가 정했다. 되면 빠른 LIKE, 안 되면 SQLite 에 얹은 JS 함수(`ufind`)로 그
 * 자리에서 접어 견줬다. **그 갈림길이 두 판 연속 틀렸다.** 갈림길은 질의만
 * 보고 정하는데 어긋남은 저장값에서 온다 — 질의가 순수 아스키여도 저장값에
 * NFC 가 바꿔 버리는 글자(호환 한자 U+F900~U+FA6D 등 1,098자)가 있으면 LIKE 는
 * 영영 못 찾고 화면은 찾는다. 질의만 보고는 맞힐 수 없다. 그래서 맞히려 들지
 * 않고 갈림길을 없앴다.
 *
 * 갈림길을 없애면 모든 낱말이 접힌 글자 위에서 견줘진다. 그런데 `ufind` 는
 * 불릴 때마다 그 칸 값을 통째로 다시 접었다 — 낱말 16개면 한 논문의
 * `head_text` 6,000자를 16번 접는 셈이라, 악센트 16낱말 질의가 173ms(최악
 * 303ms)까지 갔다. 화면의 미루기 200ms 를 넘으면 요청이 밀린다.
 *
 * 그래서 **접기를 한 번만 치르고 들고 있는다.** 서재가 바뀌지 않는 한 접힌
 * 글자는 그대로이므로, 서재 전체를 한 번 접어 두고 질의마다 그 위를 훑는다.
 * `ufind` 를 남겨 둔 채 접기만 기억하는 길도 재 봤지만, 그 길은 **행마다 칸
 * 값을 JS 로 건네는 값**이 그대로 남는다 (이 서재에서 한 바퀴에 23.8ms —
 * 낱말 16개면 380ms). 건네는 일 자체를 없애려면 훑는 자리가 JS 여야 한다.
 *
 * ── 언제 다시 접는가 ──
 *
 * 두 정수만 보고 정한다. `total_changes()` 는 이 연결이 바꾼 행 수라 앱 안의
 * 모든 쓰기를 잡고, `pragma data_version` 은 **다른 연결**이 커밋하면 바뀐다
 * (MCP 가 딴 프로세스로 붙는 길이 있다). 둘 중 하나라도 달라지면 통째로 다시
 * 접는다. 행마다 `updated_at` 을 견주는 길은 안 골랐다 — 그 값이 초 단위라
 * 같은 초에 두 번 고치면 뒤엣것을 놓치고, 그 순간 화면은 새 글자로 찾고
 * 서버는 옛 글자로 못 찾아 **바로 이 결함이 되살아난다.**
 */

// ─────────────────────────────────────────────────────────────
//   접힌 자리 → 원문 자리
// ─────────────────────────────────────────────────────────────

/**
 * 접으면 글자 자리가 밀린다. 그 자리표.
 *
 * **왜 필요한가.** 맞은 자리는 접힌 글자에서 나오는데, 사람에게 보여 줄 조각은
 * 원문에서 떠야 한다. 예전에는 `uat` 이 **줄어든 비율로 곱해서** 원문 자리를
 * 짐작했다. 비율이 본문 안에서 고르지 않으면(앞은 NFD 한글이라 줄고 뒤는
 * 아스키라 안 줄면) 짐작이 수천 자 어긋난다 — 실제로 접힌 자리 5268 → 원문
 * 7468 인데 8492 를 냈다(1,024자 어긋남). 그러면 딱지는 "요약에서 맞음" 이라는데
 * 인용문에는 찾은 낱말이 없다.
 *
 * 그래서 짐작하지 않는다. 접을 때 **덩이로 끊어 접으면서** 덩이마다 (원문 자리,
 * 접힌 자리)를 적어 둔다. 자리를 물으면 그 덩이의 머리를 돌려준다 — 참값보다
 * 늘 앞이고 어긋남이 덩이 하나를 안 넘으므로, 창을 그만큼 넉넉히 잡아 두면
 * 맞은 낱말이 반드시 창 안에 든다 (`CHUNK` 와 `search.ts` 의 `WINDOW` 를 보라).
 */
export interface FoldMap {
  /** 덩이의 원문 시작 자리. **JS 자리다 — UTF-16 칸으로 센다.** */
  raw: Int32Array;
  /** 같은 덩이의 접힌 시작 자리. `raw` 와 길이가 같다. */
  fold: Int32Array;
  /**
   * 같은 덩이의 원문 시작 자리를 **SQLite 가 세는 방식**으로 적은 것.
   *
   * 왜 자리를 두 벌 드는가. JS 문자열은 UTF-16 칸이라 이모지 하나가 두 칸이고,
   * SQLite 의 `substr`·`length` 는 **코드포인트**라 그 이모지가 한 글자다.
   * 조각 창은 `substr` 로 뜨는데(`search.ts` 의 `windowOf`) 거기에 JS 자리를
   * 그대로 넘기면, 맞은 자리 **앞에** 있는 BMP 밖 글자 수만큼 창이 뒤로 밀린다.
   * 밀림이 창의 뒷자락(600)을 넘는 순간 낱말이 창 밖으로 나가고, 그러면 딱지는
   * "요약에서 맞음" 인데 인용문에는 그 낱말이 없다 — 결함 B 가 다른 옷을 입고
   * 되살아나는 자리다. 실제로 이모지 600개를 앞에 깔면 요약·메모·PDF 세 자리
   * 모두에서 조각이 낱말을 잃었고, 2,000개에서는 창이 본문 끝을 넘어가 조각이
   * 아예 안 나왔다.
   *
   * 그래서 짐작해서 고치지 않고(빼기·나누기로 어림하면 또 어긋난다) 접을 때
   * 코드포인트도 함께 세어 둔다. 값은 덩이마다 정수 하나다.
   */
  sql: Int32Array;
}

/**
 * 덩이 하나의 목표 길이.
 *
 * **조각 창(`search.ts` 의 `WINDOW`)과 짝지어 정한 값이다.** 자리표는 덩이
 * 머리를 돌려주므로 참값이 그보다 최대 한 덩이 뒤에 있을 수 있고, 창은 그
 * 뒤까지 덮어야 한다 — `창 - 앞자락 ≥ 덩이 + 낱말이 가질 수 있는 최대 길이`
 * (낱말은 질의 상한 200자를 못 넘는다).
 *
 * **이건 목표 길이일 뿐 실제 길이가 아니다.** 아래 `skipStart` 가 덩이 끝을
 * 빈칸 뭉치 너머로 밀기 때문에, 빈칸이 길면 덩이도 그만큼 길어진다. 그래서
 * 창은 이 상수가 아니라 **덩이의 실제 길이**(`chunkSqlSpan`)를 보고 잡는다.
 *
 * 잘게 끊을수록 창이 작아도 되고(=질의마다 무는 값이 준다) 대신 서재를 접는
 * 값이 는다. 이 서재(575만 자)에서 512자면 접기가 25 → 56ms, 256자면
 * 25 → 63ms 다. 7ms 는 서재가 바뀔 때 한 번이고, 창이 800 대신 1024 가 되면
 * 그 값은 질의마다 든다(200줄이면 조각이 600개다). 그래서 256 이다.
 */
const CHUNK = 256;

/** 덩이 끝을 밀어 볼 횟수. 아래 `foldWithMap` 을 보라. */
const NUDGE = 8;

/**
 * 그리스 대문자 시그마.
 *
 * `toLowerCase()` 가 **앞뒤를 보고** 정하는 글자는 유니코드 전체에서 이것
 * 하나다 (SpecialCasing 의 `Final_Sigma`; 나머지 조건부 규칙은 터키어처럼
 * 지역을 지정해야 도는 것이라 지역 없는 `toLowerCase()` 는 안 쓴다).
 * 앞에 대소문자 있는 글자가 있고 뒤에 없으면 `ς`, 아니면 `σ` 다.
 *
 * 그래서 **덩이를 시그마 바로 앞에서 끊으면 안 된다.** 끊으면 그 덩이는
 * 시그마로 시작하고, 앞 문맥을 잃어 `ΟΔΥΣΣΕΥΣ` 의 마지막 시그마를 `σ` 로
 * 접는다(정본은 `ς`). 이건 덩이 끝을 밀어서 못 고친다 — 나쁜 것이 시작
 * 자리이기 때문이다. 실제로 이 자리에서 자리표가 끊겨 인용문에 낱말이
 * 안 보였다.
 */
const SIGMA = 0x03a3;

/**
 * 흰 공백. **덩이가 여기서 시작해도 안 된다.**
 *
 * 접기가 줄 끝 하이픈을 잇게 되면서(`normalizeForSearch` 의 `HYPHEN_BREAK`)
 * 지워지는 덩어리가 `-` 부터 줄바꿈 뒤 빈칸까지로 늘었다. 그 한가운데서
 * 끊으면 뒤 덩이는 정본이 이미 지워 버린 빈칸으로 시작하고, 시그마와 같은
 * 이유로 **끝을 밀어서는 못 고친다.**
 *
 * 그래서 덩이 끝을 빈칸 뭉치 **너머로** 민다. 그러면 지워질 덩어리가 통째로
 * 앞 덩이에 들어가고 뒤 덩이는 늘 글자에서 시작한다. 밀린 만큼 덩이가
 * 길어지지만, 그 꼬리는 전부 빈칸이라 조각 창(`search.ts` 의 `WINDOW`)이
 * 덮어야 할 거리는 그대로다 — 낱말은 빈칸에서 시작할 수 없다.
 */
const isSpace = (c: number) =>
  c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0x0b || c === 0x0c;

/** 접힌 글자와 자리표. */
export interface Folded {
  text: string;
  map: FoldMap;
}

/**
 * 한 칸을 접고 자리표를 함께 만든다.
 *
 * 접힌 글자 자체는 **통째로** 한 번에 접는다(`normalizeForSearch`). 덩이로
 * 접어 이어 붙인 것을 쓰면 브라우저가 통째로 접은 것과 한 글자라도 갈릴 수
 * 있고, 갈리는 순간 부분집합 성질이 깨지기 때문이다. 덩이 접기는 오직 자리표를
 * 만들기 위한 것이고, **정본과 맞는 데까지만** 적는다.
 */
export function foldWithMap(raw: string, chunk = CHUNK): Folded {
  const text = normalizeForSearch(raw);
  const rawAt: number[] = [];
  const foldAt: number[] = [];
  const sqlAt: number[] = [];
  /**
   * 덩이가 **앞을 봐야 정해지는 글자로 시작하지 않게** 자리를 민다.
   * 시그마(뒤가 아니라 앞뒤 문맥)와 빈칸(하이픈 줄바꿈으로 지워질 수 있다)
   * 둘뿐이다. 위 `SIGMA` · `isSpace` 를 보라.
   */
  const skipStart = (at: number) => {
    let e = Math.min(raw.length, at);
    while (e < raw.length) {
      const c = raw.charCodeAt(e);
      if (c !== SIGMA && !isSpace(c)) break;
      e++;
    }
    return e;
  };
  let i = 0;
  let pos = 0;
  /** 여기까지 지나온 코드포인트 수 = SQLite 가 세는 자리. 위 `FoldMap.sql`. */
  let cp = 0;
  while (i < raw.length) {
    /*
     * 목표 길이에서 끊고 **맞춰 본다.** 끊은 자리가 나빠(합쳐질 글자 사이를
     * 갈랐거나) 이어 붙인 것이 정본과 갈리면 한 글자씩 밀어 본다 — 결합
     * 기호는 몇 개 안 붙으므로 금세 안전한 자리가 나온다. 어디가 안전한지
     * 표로 적어 두지 않는 것이 요점이다: 유니코드 표를 베끼면 다음 판에 또
     * 틀린다. 표에 기대는 것은 밀어서 못 고치는 둘 — 시그마와 빈칸뿐이다.
     */
    let end = skipStart(i + chunk);
    let piece = normalizeForSearch(raw.slice(i, end));
    for (let k = 0; k < NUDGE && !text.startsWith(piece, pos) && end < raw.length; k++) {
      end = skipStart(end + 1);
      piece = normalizeForSearch(raw.slice(i, end));
    }
    // 그래도 안 맞으면 자리표를 여기서 멈춘다. 뒤쪽은 마지막 덩이 머리로 물러선다.
    if (!text.startsWith(piece, pos)) break;
    rawAt.push(i);
    foldAt.push(pos);
    sqlAt.push(cp);
    /*
     * 이 덩이가 지나간 코드포인트를 센다. 서로게이트 쌍은 SQLite 에서 한 글자다.
     * 쌍이 덩이 경계에서 갈릴 걱정은 없다 — 반쪽만 남으면 `toWellFormed()` 가
     * U+FFFD 로 바꿔 버려 위의 맞추기가 어긋나고, 그러면 끝을 밀어 쌍을 온전히
     * 품게 된다. 짝 잃은 반쪽 자체는 SQLite 가 넣을 때 이미 U+FFFD 라 여기 없다.
     */
    for (let k = i; k < end; k++) {
      const c = raw.charCodeAt(k);
      if (c >= 0xd800 && c <= 0xdbff && k + 1 < end) {
        const lo = raw.charCodeAt(k + 1);
        if (lo >= 0xdc00 && lo <= 0xdfff) k++;
      }
      cp++;
    }
    pos += piece.length;
    i = end;
  }
  /*
   * 끝까지 갔으면 **끝 자리를 하나 더 적어 둔다.** 자리표를 읽는 쪽은 대개
   * "이 덩이가 어디까지인가" 를 알아야 하는데(창을 그만큼 덮어야 하니까),
   * 마지막 덩이만 그 답이 없으면 부르는 쪽이 갈래를 하나 더 태워야 한다.
   * 진짜 맞은 자리는 `text.length` 보다 앞이므로 이 항목이 덩이 머리로
   * 뽑히는 일은 없다. 중간에 끊겼으면(`break`) 안 적는다 — 그때는 정말로 모른다.
   */
  if (i >= raw.length) {
    rawAt.push(raw.length);
    foldAt.push(pos);
    sqlAt.push(cp);
  }
  return {
    text,
    map: {
      raw: Int32Array.from(rawAt),
      fold: Int32Array.from(foldAt),
      sql: Int32Array.from(sqlAt),
    },
  };
}

/**
 * 접힌 자리를 **SQLite 가 세는 원문 자리**(코드포인트)로. `substr` 에 넘길 값이다.
 *
 * **덩이 머리로 내려 준다** — 늘 참값 이하이고 어긋남은 덩이 하나를 넘지 않는다.
 *
 * JS 자리(`map.raw`)를 안 돌려주는 것이 요점이다. 이 값을 받는 곳은 SQL 뿐이고,
 * SQL 은 코드포인트로 센다. 두 셈이 다르다는 것을 부르는 쪽이 기억하게 두면
 * 언젠가 잊는다 — 그래서 아예 SQL 이 쓰는 셈만 내놓는다 (`FoldMap.sql`).
 */
export function sqlIndexOf(f: Folded, foldIdx: number): number {
  return f.map.sql[chunkAt(f, foldIdx)] ?? 0;
}

/**
 * 그 자리가 든 덩이가 원문에서 몇 글자인가(SQLite 셈). 모르면 `-1`.
 *
 * **조각 창이 이만큼은 덮어야 한다.** 자리표는 덩이 머리를 돌려주므로, 맞은
 * 낱말은 그 머리부터 덩이 끝 사이 어딘가에 있다. 덩이가 목표 길이(`CHUNK`)면
 * 창의 상수(`search.ts` 의 `WINDOW`)로 넉넉하지만, 덩이는 늘 그 길이가 아니다 —
 * 빈칸 뭉치를 만나면 그 너머까지 밀리기 때문이다(`isSpace`). 밀린 만큼 창도
 * 늘려야 한다. 상수를 키우는 대신 **실제 덩이 길이를 묻게** 두는 것이 요점이다:
 * 그래야 "창이 덩이를 덮는다" 가 지켜야 할 부등식이 아니라 계산이 된다.
 */
export function chunkSqlSpan(f: Folded, foldIdx: number): number {
  const k = chunkAt(f, foldIdx);
  const { sql } = f.map;
  return k + 1 < sql.length ? sql[k + 1] - sql[k] : -1;
}

/**
 * 그 자리가 든 덩이의 머리 — `[원문 자리, 접힌 자리]`.
 *
 * 이 한 쌍에서 시작하면 **접기의 앞 문맥이 온전하다.** `foldWithMap` 이
 * 여기서 끊어도 정본과 같다는 것을 확인해 두었기 때문이다. 조각을 자르는
 * 쪽(`search.ts` 의 `locate`)이 이 자리부터 한 글자씩 걸어 나가며 낱말의
 * 정확한 원문 자리를 짚는다 — 그리스 말미 시그마처럼 앞뒤를 봐야 정해지는
 * 글자가 있어서, 아무 데서나 한 글자만 떼어 접으면 정본과 다른 답이 나온다.
 */
export function chunkStart(f: Folded, foldIdx: number): [number, number] {
  const k = chunkAt(f, foldIdx);
  return [f.map.raw[k] ?? 0, f.map.fold[k] ?? 0];
}

/**
 * 접힌 자리 `foldEnd` 까지가 원문에서 **아무리 길어야 여기까지**인 자리.
 * 자리표가 거기까지 안 닿으면 `-1`.
 *
 * 조각을 짚는 쪽(`search.ts` 의 `locate`)이 원문을 한 글자씩 늘려 가며 접어
 * 볼 때 어디서 포기할지를 정하는 값이다. 예전에는 `낱말 길이 × 3` 으로
 * 어림했다 — "접힌 글자 하나가 원문에서 셋을 안 넘는다(조합형 한글)" 는
 * 표에 기댄 값이다. **접기가 글자를 지우게 되면서 그 표가 깨졌다**: 낱말
 * 사이사이에 안 보이는 글자가 끼면 원문이 접힌 것의 몇 배로도 늘어난다.
 *
 * 그래서 어림하지 않고 자리표에게 묻는다. `foldEnd` 를 넘어서는 첫 덩이의
 * 원문 머리가 곧 상한이다 — 접기는 자리를 앞으로만 옮기므로 낱말의 원문 끝은
 * 반드시 그 앞이다. 표가 필요 없고 값도 정확하다.
 */
export function rawLimitOf(f: Folded, foldEnd: number): number {
  const { fold, raw } = f.map;
  let lo = 0;
  let hi = fold.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (fold[mid] >= foldEnd) hi = mid;
    else lo = mid + 1;
  }
  return lo < raw.length ? raw[lo] : -1;
}

/** 접힌 자리가 몇 번째 덩이에 드는가. 자리표가 비었으면 0. */
function chunkAt(f: Folded, foldIdx: number): number {
  const { fold } = f.map;
  if (fold.length === 0) return 0;
  let lo = 0;
  let hi = fold.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (fold[mid] <= foldIdx) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// ─────────────────────────────────────────────────────────────
//   접어 둔 서재
// ─────────────────────────────────────────────────────────────

/**
 * `head_text` 에 섞인 쪽 표시(`--- p.7 ---`, `pdf-text.ts:379`).
 *
 * 우리가 넣은 표시이지 논문의 글자가 아니다. 그래서 **찾기에서도 조각에서도
 * 뺀다** — 안 빼면 `2` 한 글자에 PDF 를 가진 논문이 죄다 걸리고, 그렇게 걸린
 * 논문의 인용문에는 `cut()` 이 표시를 지운 뒤라 찾은 낱말이 없다.
 *
 * 갈래가 셋인 이유: 글자가 없는 쪽은 본문이 빈 채로 표시만 남아
 * `--- p.3 --- p.4 ---` 처럼 **표시가 맞붙는다.** 앞엣것을 떼고 나면 뒤엣것은
 * 앞 대시를 잃은 `p.4 ---` 가 되어 첫 갈래로는 안 잡힌다.
 *
 * 한쪽 대시만 있는 갈래에 셋을 요구하는 것은 본문을 잘못 먹지 않으려는
 * 것이다. `pdf-text.ts` 는 늘 셋을 적지만 사람 글의 "p.12 -- 를 보라" 는
 * 둘이라, 이 구분이 없으면 멀쩡한 문장에서 쪽 번호가 사라진다.
 */
export const PAGE_MARK = /-{1,3}\s*p\.\d+\s*-{1,3}|---\s*p\.\d+|p\.\d+\s*---/g;

/**
 * 쪽 표시를 **같은 길이의 빈칸으로** 갈아 끼운다.
 *
 * 지우지 않고 빈칸으로 두는 것이 요점이다. 접힌 자리를 원문 자리로 되돌리는
 * 자리표가 원문 길이에 기대고 있고, 조각 창은 `substr` 로 **원래 칸**에서 뜬다 —
 * 여기서 길이가 한 글자라도 달라지면 그 뒤 자리가 통째로 밀린다.
 */
function blankPageMarks(s: string): string {
  return s.replace(PAGE_MARK, (m) => " ".repeat(m.length));
}

/** 조각을 뜰 수 있는 깊은 자리 한 덩이. */
export interface DeepText extends Folded {
  /** 원문을 다시 짚을 열쇠 — 요약·PDF 는 논문 id, 메모는 메모 id. */
  key: string;
}

export interface IndexedPaper {
  id: string;
  /** `FRONT_FIELDS` 차례로 접어 둔 앞 칸 여덟. */
  front: string[];
  /** PDF 앞부분. 아직 안 뽑았으면 `null`. */
  head: DeepText | null;
  summary: DeepText | null;
  /** 쪽 차례. 맞은 것 중 가장 앞 쪽 하나만 조각이 된다. */
  notes: DeepText[];
}

interface LibraryIndex {
  papers: IndexedPaper[];
  /** 접어 들고 있는 글자 수. 상한을 넘는지 보는 데 쓴다. */
  chars: number;
}

/*
 * 접힌 사본을 들고 있을 상한.
 *
 * 넘으면 이번 요청에만 쓰고 버린다 — 답은 그대로 옳고 값만 매번 다시 든다.
 * 논문 한 편이 `head_text` 6,000자 + 초록 몇 KB 이므로 4,000만 자는 논문 수천
 * 편에 요약·메모가 붙은 서재다. 그 위에서 접힌 사본(UTF-16)이 80MB 가 되는데,
 * 개인이 쓰는 앱에서 찾기 하나가 그만큼을 늘 붙들고 있을 이유는 없다.
 */
const KEEP_MAX_CHARS = 40_000_000;

let cached: LibraryIndex | null = null;
let cachedStamp = "";

/** 서재가 바뀌었는지 가리는 두 정수. 값이 거의 안 든다. */
function stamp(): string {
  const conn = db.$client;
  const changes = conn.prepare("select total_changes() as c").get() as { c: number };
  const version = conn.pragma("data_version", { simple: true });
  return `${changes.c}:${String(version)}`;
}

interface PaperRow {
  id: string;
  title: string;
  authors: string | null;
  venue: string | null;
  year: number | null;
  doi: string | null;
  arxiv_id: string | null;
  tags: string | null;
  abstract: string | null;
  head_text: string | null;
}

/**
 * 서재를 통째로 접는다.
 *
 * 세 번 물어보고 끝낸다 — 논문 · 요약 · 메모. 논문마다 따로 묻지 않는 것은
 * 500편이면 왕복이 1,500번이 되기 때문이다. 차례는 `rowid` 그대로 둔다:
 * 상한(`RESULT_LIMIT`)에서 잘릴 때 무엇이 남는지가 예전 SQL 풀스캔과 같아야
 * 한다.
 */
function build(): LibraryIndex {
  const conn = db.$client;
  const rows = conn
    .prepare(
      `select id, title, authors, venue, year, doi, arxiv_id, tags, abstract, head_text
         from papers order by rowid`,
    )
    .all() as PaperRow[];

  const byId = new Map<string, IndexedPaper>();
  const papers: IndexedPaper[] = [];
  let chars = 0;

  for (const r of rows) {
    /*
     * 앞 칸 여덟은 브라우저가 접는 것과 **같은 값**이어야 한다
     * (`filter-papers.ts` 의 `flatOne`). 태그를 쉼표로 갈라 빈칸으로 다시 잇는
     * 것도, 빈 칸을 `""` 로 두는 것도 거기와 같다 — 한쪽만 고치면 그 칸에서만
     * 화면과 답이 갈린다.
     */
    const raw: Record<FrontField, string> = {
      title: r.title,
      authors: r.authors ?? "",
      venue: r.venue ?? "",
      year: r.year != null ? String(r.year) : "",
      doi: r.doi ?? "",
      arxiv: r.arxiv_id ?? "",
      tags: (r.tags ?? "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .join(" "),
      abstract: r.abstract ?? "",
    };
    const front = FRONT_FIELDS.map((f) => normalizeForSearch(raw[f]));
    for (const s of front) chars += s.length;

    let head: DeepText | null = null;
    if (r.head_text) {
      head = { key: r.id, ...foldWithMap(blankPageMarks(r.head_text)) };
      chars += head.text.length;
    }
    const p: IndexedPaper = { id: r.id, front, head, summary: null, notes: [] };
    byId.set(r.id, p);
    papers.push(p);
  }

  const sums = conn.prepare("select paper_id, body from paper_summaries").all() as {
    paper_id: string;
    body: string;
  }[];
  for (const s of sums) {
    const p = byId.get(s.paper_id);
    if (!p || !s.body) continue;
    p.summary = { key: s.paper_id, ...foldWithMap(s.body) };
    chars += p.summary.text.length;
  }

  const notes = conn
    .prepare("select id, paper_id, body from paper_notes order by paper_id, page, rowid")
    .all() as { id: string; paper_id: string; body: string }[];
  for (const n of notes) {
    const p = byId.get(n.paper_id);
    if (!p || !n.body) continue;
    const d: DeepText = { key: n.id, ...foldWithMap(n.body) };
    p.notes.push(d);
    chars += d.text.length;
  }

  return { papers, chars };
}

/**
 * 지금 서재의 접힌 사본. 서재가 안 바뀌었으면 접어 둔 것을 그대로 준다.
 *
 * 처음 부르거나 서재가 바뀐 뒤 첫 찾기는 통째로 접는 값을 치른다(논문 500 ·
 * 요약 300 · 메모 2000, 훑을 글자 765만 자에서 중앙값 254ms · 최악 442ms).
 * 그 뒤로는 두 정수를 견주는 것이 전부다.
 *
 * **이 앱에서 100ms 를 넘는 자리는 여기뿐이다.** 값이 가는 곳은 끌어오기 56 ·
 * 자리표까지 접기 152 · 나머지다. 미루는 길을 재 보고 안 간 이유는 `search.ts`
 * 의 잰 값에 적어 뒀다 — 한 번 무는 값을 질의마다 무는 값으로 바꾸게 된다.
 */
export function libraryIndex(): IndexedPaper[] {
  const now = stamp();
  if (cached && cachedStamp === now) return cached.papers;
  const built = build();
  if (built.chars <= KEEP_MAX_CHARS) {
    cached = built;
    cachedStamp = now;
  } else {
    cached = null;
    cachedStamp = "";
  }
  return built.papers;
}
