"use client";

import {
  AlertCircle,
  FileSearch,
  FileText,
  FolderTree,
  ListFilter,
  Loader2,
  MessageSquare,
  Search,
  SearchX,
  X,
} from "lucide-react";
import { useRouter, useSearchParams, type ReadonlyURLSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";

import {
  DEEP_WHERE,
  api,
  clipQuery,
  type DeepWhere,
  type SearchHit,
  type SearchResponse,
} from "@/lib/client-api";
import { PAPER_MARKS, READ_STATES, type PaperMark, type ReadState } from "@/lib/db/schema";
import {
  EMPTY_CHIPS,
  FRONT_LABEL,
  chipCount,
  chipTagKeys,
  collectTags,
  flattenLibrary,
  frontFieldsOf,
  frontRank,
  hasTag,
  matchChips,
  matchFront,
  queryWords,
  toggleIn,
  toggleTag,
  type Chips,
  type FrontField,
} from "@/lib/filter-papers";
import { paperUrl, type GroupDTO, type PaperDTO } from "@/lib/types";
import { cn } from "@/lib/utils";

import { MARK_META, MarkIcon, READ_META } from "./paper-mark";
import { PaperRow, type PaperRowActions } from "./paper-row";

/**
 * 서재에서 찾기.
 *
 * **판정의 주인은 서버다.** `GET /api/search` 가 열한 자리 — 제목 · 저자 ·
 * 학회 · 연도 · DOI · arXiv · 태그 · 초록 · 요약 본문 · 메모 본문 · PDF
 * 앞부분 — 을 한꺼번에 보고, 낱말마다 "이 논문 **어딘가에** 있나" 를 따진다.
 * 낱말은 전부 있어야 하고(AND), 낱말 하나는 열한 자리 중 아무 데나 있으면 된다.
 *
 * 예전에는 앞 겹(브라우저의 여덟 칸)과 뒤 겹(서버의 셋)이 **각자** AND 를
 * 따지고 화면이 둘을 OR 로 합쳤다. 그러면 제목에만 있는 낱말과 메모에만 있는
 * 낱말을 함께 친 순간 양쪽 모두에서 떨어져 **0건**이 됐다 — 사람 눈에는 분명히
 * 둘 다 가진 논문인데. 겹을 가로지르는 AND 는 한쪽 겹만 고쳐서는 못 세운다.
 *
 * 브라우저의 즉시 거르기(`matchFront`)는 없애지 않았다. 왕복을 기다리지 않고
 * 바로 보여 주는 값이 크다. 다만 이제 그것은 서버 답의 **부분집합**이다 —
 * 여덟 칸은 열한 자리 안에 들어 있으니, 앞에서 맞은 논문은 서버 답에도 반드시
 * 있다. 그래서 **목록은 늘어나기만 하고, 떴던 줄이 답을 받고 사라지지 않는다.**
 * (서버가 상한에서 잘랐다고 말할 때만 예외가 필요한데, 그건 아래 `results` 에
 * 적었다.)
 *
 * 상태를 `Library` 가 아니라 여기 두는 이유: 이 상태는 **논문 데이터가 아니다.**
 * `library.tsx` 머리말이 못 박은 규칙("상태는 전부 여기 있다")은 같은 논문이
 * 두 곳에 그려질 때 갈라지는 것을 막으려는 것인데, 질의·칩·짚은 자리는 한
 * 곳에만 그려진다. 대신 **결과는 늘 `groups` 에서 파생시킨다** — 스냅샷을 따로
 * 들면 4초 폴링이 서재를 갈아 끼운 뒤에도 지워진 논문이 결과에 남는다.
 * 서버가 준 `paperId` 도 같은 이유로 `groups` 에 없으면 버린다.
 */

/** 한 번에 그리는 줄 수. 넘으면 아래에 몇 편이 더 있는지만 적는다. */
const MAX_ROWS = 200;

/**
 * 서버에 묻기를 미루는 시간.
 *
 * 즉시 거르기는 미루지 않는다 — 미루면 사람이 친 글자와 화면이 어긋난다.
 * 미루는 것은 왕복이 있는 요청뿐이고, 200ms 는 한글 한 글자를 조합해
 * 끝내는 시간보다 짧아 "치다 멈추면 곧 온다" 로 느껴진다.
 */
const DEEP_DELAY = 200;

/**
 * 주소에서 받아들일 태그 칩 수. 손으로 적은 주소가 칩 수백 개를 못 만들게.
 *
 * **넘치면 말한다** (`readChips` 가 몇 개를 버렸는지 함께 돌려주고 화면이
 * 알림 줄로 적는다). 서버의 상한들이 이미 `tooManyWords`·`truncated`·
 * `queryTruncated` 로 말하고 있는데 여기만 말없이 자르면, 주소를 주고받은 두
 * 사람이 서로 다른 목록을 보면서 그 사실을 모른다.
 *
 * 숫자는 20 그대로 둔다. 칩 패널이 한 번에 펼쳐 두는 것이 18개이고, 태그
 * 칩은 묶음 안에서 **OR** 이라 개수가 늘수록 거르개가 넓어진다 — 21번째
 * 태그가 필요한 사람보다 주소에 뭔가를 잘못 붙여 넣은 사람이 훨씬 많다.
 * 말하기 시작한 지금은 숫자 자체가 덜 중요해졌다: 잘렸다는 것을 알면
 * 태그를 줄이든 칩에서 다시 켜든 사람이 고를 수 있다.
 */
const MAX_URL_TAGS = 20;

const WHERE_META: Record<
  DeepWhere,
  { label: string; spoken: string; Icon: ComponentType<{ className?: string }> }
> = {
  summary: { label: "요약", spoken: "요약 본문에서 맞음", Icon: FileText },
  note: { label: "메모", spoken: "메모 본문에서 맞음", Icon: MessageSquare },
  pdf: { label: "PDF 본문", spoken: "PDF 앞부분에서 맞음", Icon: FileSearch },
};

/** 조각은 **하나만** 보인다. 자리 차례(`DEEP_WHERE`)대로 맨 앞의 것을 고른다. */
function firstSnippet(hit: SearchHit, deep: readonly DeepWhere[]): string | null {
  for (const w of deep) {
    const text = hit.snippets.find((s) => s.where === w)?.text.trim();
    if (text) return text;
  }
  return null;
}

export interface SearchResult {
  paper: PaperDTO;
  /** 어느 서가/칸의 것인가. 1칸(서가) 아니면 2칸(서가 › 칸). */
  path: string[];
  /** 앞 칸에서 맞은 자리. 칩만으로 걸러진 줄은 빈 배열이다. */
  fields: FrontField[];
  /** 깊은 자리에서 맞은 곳. `DEEP_WHERE` 차례(요약 → 메모 → PDF)로 담는다. */
  deep: DeepWhere[];
  /** 보여 줄 조각 하나. `deep` 의 맨 앞 자리 것이고, 없을 수도 있다. */
  snippet: string | null;
  rank: number;
}

// ─────────────────────────────────────────────────────────────
//   주소에 남기기
// ─────────────────────────────────────────────────────────────

/**
 * 주소에 싣는 칸 이름. 짧고 읽히는 것으로 골랐다 — 주소는 사람이 복사해
 * 남에게 보내는 것이라 `?q=attention&tag=강화학습` 정도는 읽혀야 한다.
 */
const PARAM = { q: "q", read: "read", mark: "mark", tag: "tag" } as const;

/**
 * 주소에서 칩을 읽는다. **모르는 값은 조용히 버리고, 넘친 태그는 세어서 말한다.**
 *
 * 주소는 사람이 손으로 고칠 수 있는 곳이다. `?read=졸림` 같은 값에 오류를
 * 띄우는 것은 과하고, 그대로 상태에 넣으면 아무 논문에도 안 맞는 거르개가
 * 켜진 채 남아 "찾기가 고장났다" 로 보인다. 아는 값만 받는다.
 *
 * 태그는 다르다. 아는 값이라는 것이 없어 **뜻은 멀쩡한데 개수만 넘치는**
 * 경우가 생기고, 그때 말없이 자르면 주소를 보낸 사람과 받은 사람이 서로 다른
 * 목록을 보면서 그 사실을 모른다. 그래서 몇 개를 못 받았는지 함께 돌려준다.
 * (`?read=졸림` 처럼 뜻을 모르는 값은 세지 않는다 — 그건 "잘렸다" 가 아니라
 * 애초에 이 앱의 칩이 아니다.)
 */
function readChips(params: ReadonlyURLSearchParams): { chips: Chips; droppedTags: number } {
  const pick = <T extends string>(name: string, allowed: readonly T[]): T[] => {
    const raw = params.get(name);
    if (!raw) return [];
    const ok = new Set<string>(allowed);
    const out: T[] = [];
    for (const v of raw.split(",")) {
      const t = v.trim();
      if (ok.has(t) && !out.includes(t as T)) out.push(t as T);
    }
    return out;
  };

  // 태그는 미리 정해 둔 목록이 없다 — 서재에 없는 태그도 켜진 칩으로 남긴다
  // (`collectTags` 가 0편으로 내놓는다). 대신 개수는 막는다.
  const tags: string[] = [];
  let droppedTags = 0;
  for (const v of (params.get(PARAM.tag) ?? "").split(",")) {
    const t = v.trim();
    if (!t || hasTag(tags, t)) continue; // 빈 칸과 같은 태그의 되풀이는 버린 것이 아니다
    if (tags.length < MAX_URL_TAGS) tags.push(t);
    else droppedTags += 1;
  }

  return {
    chips: {
      read: pick<ReadState>(PARAM.read, READ_STATES),
      marks: pick<PaperMark>(PARAM.mark, PAPER_MARKS),
      tags,
    },
    droppedTags,
  };
}

/**
 * 지금 상태를 주소 뒤에 붙일 글자로. 빈 것은 안 싣는다 — 주소가 짧아야 읽힌다.
 *
 * **질의는 `clipQuery` 로 자르고 싣는다.** 안 자르면 붙여 넣기 한 번으로
 * 주소가 통째로 못 쓰게 된다: 한글 한 글자가 `%XX` 세 벌(9자)이라 2,500자를
 * 붙여 넣으면 주소가 22KB 로 부풀고, 그 주소를 다시 열거나 남에게 보내는 순간
 * 요청 줄이 헤더 한도를 넘어 **페이지 자체가 431 로 죽는다** — 앱의 오류 줄도
 * 아니고 브라우저의 빈 화면이다. (`api.search` 가 API 주소를 자르는 것이 431 을
 * 막았는데, 주소창에 그대로 실으면 같은 431 이 한 겹 뒤에서 되살아난다.)
 *
 * 자르는 **함수**가 같은 것이 핵심이다(`clipQuery`). 서버가 실제로 찾아 본 것이
 * 그 함수를 지난 글자라, 여기서 같은 함수로 자르면 **되살아나는 질의가 곧 찾은
 * 질의**다. 길이만 맞추고 자르는 자리를 따로 정하면 그 성질이 깨진다 — 여기서
 * 글자 한가운데를 갈라 실으면, 그 주소를 다시 연 사람은 저장값 어디에도 없는
 * 반쪽 글자로 찾게 된다.
 *
 * 낱말 하나가 통째로 상한을 넘으면 `?q=` 가 아예 안 실린다. 그것도 같은
 * 성질이다 — 서버가 그 질의로는 아무것도 안 뒤졌으므로, 되살릴 질의도 없다.
 *
 * 칩은 안 자른다. 논문 한 편의 태그가 1,000자로 막혀 있고(`api/papers` 의 zod)
 * 주소에서 받아들이는 개수도 `MAX_URL_TAGS` 로 막혀 있어, 붙여 넣기 한 번으로
 * 끝없이 늘어날 수 있는 칸은 질의뿐이다.
 */
function chipsToQuery(applied: string, chips: Chips): string {
  const p = new URLSearchParams();
  const q = clipQuery(applied);
  if (q) p.set(PARAM.q, q);
  if (chips.read.length > 0) p.set(PARAM.read, chips.read.join(","));
  if (chips.marks.length > 0) p.set(PARAM.mark, chips.marks.join(","));
  if (chips.tags.length > 0) p.set(PARAM.tag, chips.tags.join(","));
  return p.toString();
}

// ─────────────────────────────────────────────────────────────
//   상태
// ─────────────────────────────────────────────────────────────

export function useLibrarySearch(groups: GroupDTO[]) {
  const router = useRouter();
  const params = useSearchParams();

  /*
   * 서재를 한 번만 눕혀 둔다.
   *
   * 초록은 한 편에 수 KB 이고 서재에는 수백 편이 온다. 키를 칠 때마다
   * `normalize("NFC").toLowerCase()` 를 500번 돌리면 그것만으로 한 프레임이
   * 날아간다. `groups` 가 바뀔 때만(=서재가 실제로 달라질 때만) 눕히고,
   * 이후 판정은 눕은 문자열에 `includes()` 하는 것뿐이다.
   */
  const flats = useMemo(() => flattenLibrary(groups), [groups]);

  /*
   * 입력칸에 보이는 글자(`raw`)와 실제로 거르는 데 쓰는 글자(`applied`)를
   * 나눈다. **한글 조합 중에는 `applied` 를 안 건드린다** — 안 그러면 "강화"
   * 를 치는 동안 ㄱ·가·갛·강… 마다 결과가 통째로 뒤집힌다. 낭독도 같이 튄다.
   *
   * 첫 값은 **주소에서** 읽는다. 결과를 한 편씩 열어 보는 것이 이 상자의 주
   * 쓰임인데, 논문을 열었다 뒤로 오면 질의와 칩이 통째로 사라져 매번 다시
   * 쳐야 했다. 주소에 실려 있으면 뒤로 오는 길에 그대로 되살아난다.
   * `useSearchParams()` 는 첫 그림에서만 읽는다(초기값 함수) — 이후의 상태
   * 주인은 여기이고 주소는 그것을 따라 적히는 자리다.
   */
  const [raw, setRaw] = useState(() => params.get(PARAM.q) ?? "");
  const [applied, setApplied] = useState(() => params.get(PARAM.q) ?? "");
  const composing = useRef(false);

  /*
   * 첫 칩은 주소에서 읽는다. 몇 개를 못 받았는지도 함께 들고 있다가 알림 줄로
   * 적는다 — 사람이 칩을 한 번이라도 건드리면(`chips` 가 갈리면) 그 알림은
   * 사라진다. 그때부터는 화면에 보이는 칩이 곧 지금의 거르개이고, 주소에서
   * 무엇이 잘렸는지는 더 이상 지금 목록을 설명하지 못하기 때문이다.
   */
  const [fromUrl] = useState(() => readChips(params));
  const [chips, setChips] = useState<Chips>(fromUrl.chips);

  /** 켜 둔 칩은 서재에서 사라져도 목록에 남는다 — 남기지 않으면 끌 수가 없다. */
  const tagOptions = useMemo(() => collectTags(flats, chips.tags), [flats, chips.tags]);

  /**
   * 상태가 바뀌면 **그 자리에서** 주소를 고쳐 쓴다.
   *
   * 예전에는 글자 입력을 500ms 미뤄 두고 `pendingUrl` 에 담아 뒀다가, 나가는
   * 길목마다 `flushUrl()` 을 불러 흘려보냈다. 그 모양이 **길목을 하나 빠뜨릴
   * 때마다 같은 결함을 되살렸다** — 논문을 여는 두 길(커서 · 결과 줄 클릭)과
   * `pagehide` 는 챙겼는데, 찾는 동안에도 머리말에 떠 있는 `/settings` 링크와
   * 자매 앱 단추는 못 챙겼다. `attention` 을 치고 500ms 안에 설정으로 나가면
   * `?q=attention` 이 안 남고, 뒤로 오면 찾기 상자가 빈 칸이었다.
   *
   * 흘려보내는 자리를 늘리는 길로 안 갔다. 문이 하나 늘 때마다 되살아나는
   * 결함이라, 고칠 것은 문이 아니라 **미룬다는 것 자체**다. 그래서 미뤄서
   * 무엇을 아끼는지부터 쟀다 — 아끼는 것이 없었다.
   *
   *   · `history.replaceState` 한 번에 **0.023ms** (논문 500편 서재를 띄운
   *     프로덕션 빌드에서 200번씩 다섯 판, 중앙값). 네트워크가 아니라
   *     주소창만 갈아 끼우는 일이다.
   *   · 글자 하나를 치는 동안 이 갈래가 하는 일 전체는 **55~60ms** 다(서재
   *     500편을 다시 훑고 결과 200줄을 다시 그린다). 주소를 적을 때와
   *     `replaceState` 를 빈 함수로 바꿔 아예 안 적을 때를 번갈아 재면
   *     74.78 / 74.74 · 79.68 / 78.23 ms — **가려낼 수 없다.**
   *
   * 미루기를 없애니 `pendingUrl` · `flushUrl` · `pagehide` 듣기 · 결과 목록의
   * `onClickCapture` 가 전부 함께 없어졌다.
   *
   * `router.replace` 가 아니라 `history.replaceState` 를 쓴다. 같은 길이라도
   * `router.replace` 는 서버 컴포넌트를 다시 받아 오는데, 이 화면의 서버
   * 컴포넌트는 **서재 전체를 읽어 내려보내는 곳**이다 (`page.tsx` 의
   * `listGroups()`, 초록까지 실린 수백 편). 질의를 고칠 때마다 그것을 다시
   * 받을 이유가 없다. Next 15 는 이 두 History 함수를 가로채 `useSearchParams`
   * 와 맞춰 주므로 주소만 갈아 끼우는 데는 이쪽이 맞다.
   *
   * `push` 가 아닌 것은 히스토리 때문이다 — 글자마다 한 칸씩 쌓이면 뒤로
   * 가기가 "지운 글자 되짚기" 가 되어 서재로 못 돌아간다.
   *
   * 붙이는 주소는 `?…` 하나뿐이고 앞의 경로는 손대지 않는다. basePath 는
   * 이미 `location.pathname` 에 들어 있어서, 여기서 뭔가 더 붙이면 `/paper`
   * 가 두 번 붙는다. 지울 때만 pathname 을 그대로 다시 쓴다.
   *
   * ── 브라우저의 빈도 제한을 실제로 재 보고 둔 것 ──
   *
   * 글자마다 부르므로 History API 의 빈도 제한이 걸리는지 크롬(148)에서 쟀다.
   *
   *   · 이 화면에서 **진짜로 치고 지우고 붙여 넣기**: 50자를 초당 10자로 치고,
   *     한 글자씩 지우고, 300자를 붙였다 지우기를 열 번 — 10초에 108번.
   *     경고 0 · 예외 0 · 한 번에 중앙값 0.4ms, 최악 1.9ms. 주소는 끝까지 따라왔다.
   *   · 손보다 빠른 속도: 초당 12번 20초(240번) — 경고 없음. 초당 30번 19초
   *     (600번) — 크롬이 "Throttling navigation" **경고**를 찍지만 마지막 주소는
   *     제대로 남았다.
   *   · 사람이 낼 수 없는 속도: 쉬지 않고 500번 넘게 — 경고가 뜨고 그 뒤 호출이
   *     **말없이 버려진다.** 예외가 아니다: `replaceState` 는 그냥 돌아오고
   *     `location.search` 만 옛 값 그대로다(400번을 몰아친 뒤 98번째 값에 멈춰
   *     있었다). 1초 쉬고 부르면 그 다음 호출은 바로 먹혔다.
   *
   * 즉 **크롬은 던지지 않는다 — 조용히 버린다.** 그래서 `try/catch` 만으로는
   * 못 막는다(사파리는 100회/30초에서 `SecurityError` 를 던진다고 알려져 있는데
   * 여기서 몰아 볼 수 없었다). 두 갈래를 한 번에 막는 방법은 **적고 나서
   * 확인하는 것**이다: 주소가 안 바뀌었으면 잠시 뒤 한 번 더 적는다.
   *
   * **미뤄 두는 것과 다르다.** 적기는 늘 그 자리에서 하고, 다시 적기는 브라우저가
   * 거절했을 때만 생긴다. 그러니 "나가는 문마다 흘려보내기" 로 돌아가지 않는다 —
   * 문은 하나도 안 늘었고, 다시 적는 타이머는 이 효과가 쥐고 있어 상태가 바뀌면
   * 정리되고 새 값이 그 자리에서 다시 적힌다. 거절당한 동안 나가 버리면 주소는
   * 안 남지만, 그건 다시 적기가 없었어도 마찬가지다(애초에 못 적는 상태였다).
   *
   * 횟수를 막아 두는 것은 주소를 우리 말고 다른 것이 쥐고 있을 때 영영 도는 것을
   * 막기 위해서다. 열 번쯤 시도하면 위에서 잰 회복 시간(1초)을 한참 덮는다.
   */
  useEffect(() => {
    const next = chipsToQuery(applied, chips);
    const target = next ? `?${next}` : window.location.pathname;
    const landed = () => window.location.search.replace(/^\?/, "") === next;
    if (landed()) return;

    let timer = 0;
    let wait = 250;
    let left = 10;
    const write = () => {
      try {
        window.history.replaceState(null, "", target);
      } catch {
        /* 사파리의 `SecurityError`. 아래에서 다시 잰다. */
      }
      if (landed() || left-- <= 0) return;
      timer = window.setTimeout(write, wait);
      wait = Math.min(wait * 2, 4000);
    };
    write();
    return () => window.clearTimeout(timer);
  }, [applied, chips]);

  /**
   * 서버에 보낼 질의. **사람이 친 그대로 보낸다.**
   *
   * 예전에는 `queryWords()` 가 눕힌(NFC + 소문자) 낱말을 이어 붙여 보냈다.
   * 그러면 서버는 사람이 실제로 친 글자를 **영영 못 본다** — 잘랐다·너무 많다
   * 같은 말을 사람이 친 글자 기준으로 하고 있어서, 그 정보를 버릴 이유가 없다.
   *
   * **미리 접어 보내면 서버가 한 번 더 접는다는 것도 문제다.** `normalizeForSearch`
   * 는 멱등이 아니다 — 유니코드 전체를 훑어 보면 두 번 접은 값이 달라지는 자리가
   * 여섯 있다(`Α` + U+0342 같은 그리스 결합 꼴). 지금 안전한 것은 화면과 서버가
   * **저마다 원본을 딱 한 번씩** 접기 때문이지, 두 번 접어도 같아서가 아니다.
   *
   * **앞뒤 공백만 뗀다.** 예전에는 가운데 공백도 하나로 접었는데(`\s+` → `" "`),
   * 그 한 줄이 접기 규칙과 어긋났다 — `\s` 에는 U+FEFF 같은 **안 보이는 글자가
   * 들어 있고**, 접기는 그것을 지운다. 접으면 `mo<U+FEFF>del` 이 한 낱말인데
   * 여기서 먼저 공백으로 바꿔 버리면 두 낱말이 되어, 화면과 서버가 다른 낱말을
   * 세게 된다. 접기 앞에 손을 한 겹이라도 덜 대는 편이 안전하다.
   *
   * 잃는 것은 "가운데 공백만 고쳤을 때 다시 안 부른다" 뿐이다 — 꼬리 공백은
   * `trim()` 이 그대로 흡수하고, 낱말 사이에 빈칸을 하나 더 넣는 일은 드물다.
   */
  const deepQuery = useMemo(() => applied.trim(), [applied]);

  /**
   * 즉시 거르기가 쓰는 낱말. **보내는 글자(`deepQuery`)에서 뽑는다.**
   *
   * `applied` 에서 뽑으면 앞뒤 공백 하나 차이지만, **화면과 서버가 같은
   * 문자열에서 낱말을 세는 것**이 규칙이다. 접기가 줄 끝 하이픈을 잇고 안
   * 보이는 글자를 지우게 된 뒤로 "그 글자가 있느냐" 가 낱말 개수를 바꾼다
   * (`trans-\nformer` 는 한 낱말, `trans- former` 는 두 낱말). 두 곳이 다른
   * 문자열을 보면 그 차이가 곧 부분집합이 깨지는 자리다.
   *
   * 자른 것(`clipQuery`)이 아니라 **자르기 전**을 쓰는 것도 뜻이 있다. 낱말이
   * 줄면 판정이 넓어지므로, 화면이 자르기 전 낱말 전부를 요구해야 화면 쪽이
   * 서버의 부분집합으로 남는다.
   */
  const words = useMemo(() => queryWords(deepQuery), [deepQuery]);
  const nChips = chipCount(chips);
  const active = words.length > 0 || nChips > 0;

  const [answer, setAnswer] = useState<{ q: string; res: SearchResponse } | null>(null);
  const [deepBusy, setDeepBusy] = useState(false);
  const [deepError, setDeepError] = useState<string | null>(null);

  /*
   * 서버에 묻는다.
   *
   * **늦게 온 답이 화면을 뒤집으면 안 된다.** 질의가 바뀔 때마다 앞의
   * `AbortController` 를 끊는데, 끊긴 요청의 콜백은 `signal.aborted` 로
   * 걸러 낸다 — 순번을 따로 세지 않아도 이 하나로 "취소" 와 "늦게 도착"
   * 둘 다 막힌다. 답을 질의와 함께 담아 두는 것도 같은 이유다: 다음 글자를
   * 친 순간 옛 질의의 조각이 새 줄에 붙는 일이 없어야 한다.
   *
   * 실패하면 답을 **비운다.** 빈 답을 담아 두면 그것이 "0건" 이라는 판정으로
   * 읽혀 목록이 통째로 사라진다. 답이 없으면 화면은 즉시 거르기로 그리고
   * (그 줄들은 전부 진짜로 맞은 줄이다), 못 찾은 자리가 있다는 것만 한 줄로
   * 말한다 — 조용히 삼키면 "왜 요약이 안 걸리지" 를 사람이 알아낼 길이 없다.
   */
  useEffect(() => {
    if (!deepQuery) {
      setAnswer(null);
      setDeepBusy(false);
      setDeepError(null);
      return;
    }
    const ac = new AbortController();
    setDeepBusy(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await api.search(deepQuery, { signal: ac.signal });
          if (ac.signal.aborted) return;
          setAnswer({ q: deepQuery, res });
          setDeepError(null);
        } catch (e) {
          if (ac.signal.aborted) return;
          setAnswer(null);
          setDeepError(
            e instanceof Error
              ? `찾기 서버가 답하지 않아 목록에 실린 칸만으로 걸렀습니다 — 요약 · 메모 · PDF 본문은 빠져 있습니다 (${e.message})`
              : "찾기 서버가 답하지 않아 목록에 실린 칸만으로 걸렀습니다 — 요약 · 메모 · PDF 본문은 빠져 있습니다",
          );
        } finally {
          if (!ac.signal.aborted) setDeepBusy(false);
        }
      })();
    }, DEEP_DELAY);

    return () => {
      clearTimeout(timer);
      ac.abort();
    };
  }, [deepQuery]);

  /**
   * 지금 질의에 대한 답인가. 아니면(기다리는 중 · 실패 · 낱말 초과) `null` 이고,
   * 그동안 화면은 즉시 거르기로 그린다.
   *
   * `tooManyWords` 는 "안 찾았다" 는 뜻이라 답으로 치지 않는다. 그때 빈 답을
   * 판정으로 삼으면 낱말을 하나 더 쳤다는 이유로 이미 보이던 줄이 몽땅
   * 사라지는데, 사람은 그것을 "0건" 으로 읽는다. 안 찾았으면 안 찾았다고
   * 말하고(`notes`) 보이던 것은 그대로 둔다.
   */
  const served = answer !== null && answer.q === deepQuery && answer.res.tooManyWords !== true;

  /** 논문 하나에 하나. 서버가 자리를 한 배열(`where`)에 모아 보낸다. */
  const hitById = useMemo(() => {
    const map = new Map<string, SearchHit>();
    if (!served || !answer) return map;
    for (const h of answer.res.hits) map.set(h.paperId, h);
    return map;
  }, [served, answer]);

  /**
   * 서버 답이 **완전하지 않은가.** 그러면 즉시 거르기의 줄을 바닥에 깐다.
   *
   * 갈래가 둘이다. 하나는 결과가 상한(200)에서 잘린 것(`truncated`), 다른
   * 하나는 **질의가 잘린 것**(`queryTruncated`)이다. 뒤엣것을 안 보다가 결함이
   * 났다: 질의가 잘리면 서버는 사람이 친 것보다 **적은 낱말**로 찾은 것이라
   * 그 답을 "판정의 전부" 로 삼을 수 없는데, 그러면 화면이 즉시 띄운 줄을
   * 지워 버린다. 낱말이 통째로 상한을 넘어 서버가 아무것도 안 뒤진 경우
   * (`clipQuery` 가 빈 글자를 낸다)에는 **보이던 줄이 전부 사라진다.**
   *
   * 둘 다 뜻이 같다 — "이 답에 없다고 없는 것은 아니다".
   */
  const cut =
    served && (answer?.res.truncated === true || answer?.res.queryTruncated === true);

  const results = useMemo<SearchResult[]>(() => {
    if (!active) return [];
    // 켜 둔 칩은 여기서 한 번만 눕힌다. 논문마다 다시 눕히면 500편 × 칩 수다.
    const tagKeys = chipTagKeys(chips);
    const out: SearchResult[] = [];

    for (const flat of flats) {
      if (!matchChips(flat, chips, tagKeys)) continue;

      // 질의가 없으면(칩만 켠 상태) 칩을 통과한 것이 곧 결과다.
      if (words.length === 0) {
        out.push({ paper: flat.paper, path: flat.path, fields: [], deep: [], snippet: null, rank: 0 });
        continue;
      }

      const hit = hitById.get(flat.paper.id);
      if (hit) {
        const deep = DEEP_WHERE.filter((w) => hit.where.includes(w));
        const fields = frontFieldsOf(hit.where);
        out.push({
          paper: flat.paper,
          path: flat.path,
          fields,
          deep,
          snippet: firstSnippet(hit, deep),
          // 앞 칸이 섞여 있으면 그 등수, 깊은 자리뿐이면 맨 뒤(`frontRank([])`).
          rank: frontRank(fields),
        });
        continue;
      }

      /*
       * 서버 답에 없는 논문.
       *
       * 답을 받았고 잘리지도 않았으면 **없는 것이 맞다** — 판정의 주인은
       * 서버다. 아직 못 받았거나(기다리는 중 · 실패 · 낱말 초과) 서버가
       * 잘랐다고 말했을 때만 즉시 거르기로 남긴다. 남겨도 거짓 양성이 아닌
       * 것은 여덟 칸이 열한 자리의 부분집합이기 때문이다 — 여기서 맞았다면
       * 서버 눈으로도 맞은 논문이다. 그래서 **줄은 늘어나기만 하고, 떴던
       * 줄이 답을 받고 사라지지 않는다.**
       */
      if (served && !cut) continue;
      const fields = matchFront(flat, words);
      if (!fields) continue;
      out.push({
        paper: flat.paper,
        path: flat.path,
        fields,
        deep: [],
        snippet: null,
        rank: frontRank(fields),
      });
    }

    // 안정 정렬이라 같은 등수끼리는 서재 차례가 그대로 남는다. 서버가 준
    // 차례가 아니라 `flats` 를 도는 것도 그래서다 — 결과의 차례는 늘 서재의
    // 차례에서 나오고, `groups` 에 없는 `paperId` 는 자연히 떨어진다.
    out.sort((a, b) => a.rank - b.rank);
    return out;
  }, [active, flats, chips, words, hitById, served, cut]);

  /**
   * 결과가 왜 이 모양인지 화면이 스스로 말한다.
   *
   * 서버가 낱말을 버리거나 목록을 자르고도 아무 말이 없으면, 사람은 "이 서재에
   * 그 논문이 없구나" 라고 **틀린 결론**을 내린다. 결함이 안 보이는 자리에서
   * 조용히 사는 것이 가장 나쁘다.
   *
   * **서버의** 상한 숫자(낱말 몇 개까지, 몇 건까지)는 여기 안 적는다. 그건
   * 서버의 값이고, 베껴 두면 서버가 바꿔도 안 따라가 조용히 거짓말이 된다.
   * 주소의 태그 상한은 다르다 — `MAX_URL_TAGS` 는 이 파일의 값이라 베끼는
   * 것이 아니라 그 상수를 그대로 읽는다.
   */
  const notes = useMemo<string[]>(() => {
    const out: string[] = [];
    /*
     * 주소에서 태그를 잘랐으면 맨 먼저 말한다. 서버 알림보다 앞인 것은 이것이
     * **거르개 자체**에 대한 말이기 때문이다 — 아래 셋은 "이 질의를 어떻게
     * 찾았나" 이고, 이건 "지금 켜진 칩이 주소에 적힌 것과 다르다" 이다.
     */
    if (fromUrl.droppedTags > 0 && chips === fromUrl.chips) {
      out.push(
        `주소에 실린 태그가 너무 많아 앞의 ${MAX_URL_TAGS}개만 켰습니다 — ${fromUrl.droppedTags}개는 빠져 있어 목록이 주소를 보낸 쪽과 다를 수 있습니다`,
      );
    }
    const res = answer && answer.q === deepQuery ? answer.res : null;
    if (!res) return out;
    if (res.tooManyWords) {
      out.push(
        "낱말이 너무 많아 서버가 찾지 않았습니다 — 지금 보이는 것은 목록에 실린 칸만으로 거른 결과입니다. 낱말을 줄이면 다시 찾습니다",
      );
    }
    if (res.truncated) {
      out.push("맞는 논문이 너무 많아 서버가 앞쪽만 보냈습니다 — 낱말을 더하거나 칩으로 좁혀 보세요");
    }
    /*
     * 자르는 자리가 낱말 사이로 바뀌면서 이 말도 바뀌어야 했다. 예전에는
     * "앞부분" 이 앞 200자였는데, 지금은 **앞쪽 낱말 몇 개**다. 그리고 낱말
     * 하나가 통째로 상한을 넘으면 그 낱말은 서버에 아예 안 간다(`clipQuery`) —
     * 그때 보이는 줄은 목록에 실린 칸만으로 거른 것이므로, 요약·메모·PDF
     * 본문은 그 낱말로 못 뒤졌다는 말을 해 줘야 한다.
     */
    if (res.queryTruncated) {
      out.push(
        "질의가 길어 앞쪽 낱말로만 찾았습니다 — 200자를 넘는 낱말은 통째로 빠집니다." +
          " 빠진 낱말은 목록에 실린 칸으로만 걸렀습니다(요약 · 메모 · PDF 본문은 못 뒤졌습니다)",
      );
    }
    return out;
  }, [answer, deepQuery, fromUrl, chips]);

  const shown = results.length > MAX_ROWS ? results.slice(0, MAX_ROWS) : results;

  /*
   * ─ 짚은 자리 ─
   *
   * **번호가 아니라 논문 id 로 든다.** 번호로 들면 목록이 바뀌는 순간 짚은
   * 논문이 저절로 바뀐다. 이 화면에서 목록은 늘 한 번 바뀐다 — 즉시 거르기로
   * 그려 놓고 서버 답이 오면 등수가 앞선 논문이 위로 끼어들기 때문이다.
   * 치자마자 Enter 를 누르면 왕복이 끝나기 전이냐 뒤냐에 따라 **다른 논문이
   * 열렸다.** 낭독도 어긋났다: `aria-activedescendant` 가 가리키는 id 는
   * 그대론데 그 줄의 내용만 바뀌니, 짚었다고 읽어 준 논문과 열리는 논문이
   * 달랐다.
   *
   * `null` 은 "아직 아무 데도 안 짚었다" 이고 맨 위로 읽힌다. 짚어 둔 논문이
   * 목록에서 사라졌을 때도 맨 위다 — 그 논문 자리에 무엇이 왔는지는 아무도
   * 모르지만 맨 위가 무엇인지는 사람이 보고 있고, Enter 로 열릴 것을 눈으로
   * 확인할 수 있는 자리는 그곳뿐이다.
   */
  const [cursorId, setCursorId] = useState<string | null>(null);
  // 질의나 칩이 바뀌면 맨 위로. 결과가 통째로 달라지는 자리라, 짚어 둔 논문이
  // 우연히 새 목록에도 있다는 이유로 가운데를 짚고 있으면 오히려 놀랍다.
  useEffect(() => {
    setCursorId(null);
  }, [deepQuery, chips]);

  /** 짚은 논문이 지금 목록 어디에 있나. 없으면(또는 안 짚었으면) 맨 위. */
  const cursorAt = useMemo(() => {
    if (shown.length === 0) return -1;
    if (cursorId === null) return 0;
    const i = shown.findIndex((r) => r.paper.id === cursorId);
    return i < 0 ? 0 : i;
  }, [shown, cursorId]);

  const move = useCallback(
    (delta: number) => {
      /*
       * **앞 값에서 계산한다** (`setCursorId(prev => …)`). 밖에서 읽은
       * `cursorAt` 으로 계산하면 한 번에 처리되는 키 두 개가 **같은** 앞 값을
       * 보고 같은 자리를 짚어, ↓↓ 를 빨리 눌렀을 때 한 칸만 움직인다.
       */
      setCursorId((prev) => {
        const n = shown.length;
        if (n === 0) return prev;
        // 지금 자리를 목록에서 다시 찾는다. 짚어 둔 논문이 사라졌거나 아직
        // 아무 데도 안 짚었으면 맨 위에서 센다.
        const i = prev === null ? -1 : shown.findIndex((r) => r.paper.id === prev);
        const from = i < 0 ? 0 : i;
        // 끝에서 한 번 더 누르면 처음으로 돈다 — 목록이 길 때 맨 위로 가려고
        // ↑ 를 200번 누르게 두지 않는다.
        return shown[(from + delta + n) % n].paper.id;
      });
    },
    [shown],
  );

  const openCursor = useCallback(() => {
    const r = shown[cursorAt];
    if (!r) return;
    // `paperUrl()` 은 basePath 가 안 붙은 주소다. `location.href` 에 넣으면
    // `/paper` 하위 배포에서 404 가 된다 — router 를 거쳐야 Next 가 붙인다.
    router.push(paperUrl(r.paper.id));
  }, [shown, cursorAt, router]);

  /**
   * 화면 글자를 고치고, 조합 중이 아니면 거르는 글자까지 함께 고친다.
   *
   * **조합 중인지는 이벤트가 스스로 안다** (`InputEvent.isComposing`). 걸어 둔
   * 깃발만 믿으면 안 된다 — `compositionend` 를 **한 번** 놓치는 순간 깃발이 선
   * 채로 남고, 그 뒤로는 `applied` 가 영영 안 움직인다. 입력칸에는 친 글자가
   * 그대로 보이는데 결과는 옛 질의에 얼어붙고, 개수 낭독까지 거짓말을 한다.
   * 조합 한 번 어긋난 값으로 찾기 상자가 통째로 먹통이 되는 셈이다.
   * (실제로 그렇게 만들어 확인했다 — 조합을 시작만 하고 끝내지 않으면
   * "bert" 를 쳐도 결과는 "attention" 에 멈춰 있었다.)
   *
   * 이벤트가 조합 여부를 안 실어 줄 때만 깃발을 본다. 이벤트마다 새로 오는
   * 값이라 깃발과 달리 걸린 채로 남을 수가 없다.
   */
  const setQuery = useCallback((v: string, composingNow?: boolean) => {
    setRaw(v);
    const isComposing = composingNow ?? composing.current;
    composing.current = isComposing;
    if (!isComposing) setApplied(v);
  }, []);

  /**
   * 조합을 끝내고 화면 글자를 그대로 적용한다.
   *
   * `compositionend` 와 **blur** 가 둘 다 여기로 온다. 조합 도중에 입력칸을
   * 떠나는 길에서 `compositionend` 가 안 오는 경우가 있어, 떠날 때 한 번 더
   * 풀어 준다. 이미 풀려 있으면 같은 값을 다시 넣는 것이라 아무 일도 안 난다.
   */
  const commitComposition = useCallback((v: string) => {
    composing.current = false;
    setRaw(v);
    setApplied(v);
  }, []);

  const clearAll = useCallback(() => {
    // 조합 중에 지웠을 수 있다. 깃발을 남기면 그 뒤 타이핑이 통째로 안 먹는다.
    composing.current = false;
    setRaw("");
    setApplied("");
    setChips(EMPTY_CHIPS);
  }, []);

  const inputRef = useRef<HTMLInputElement | null>(null);

  /*
   * `/` 로 찾기 상자에 간다.
   *
   * 이 앱의 첫 전역 단축키다. 지금까지의 `keydown` 은 전부 "열려 있는 동안만
   * 붙는 Esc" 였다. 입력칸·textarea·contenteditable 안에서는 안 먹어야 한다 —
   * 서가 이름을 고치다가 `/` 를 치면 글자 대신 포커스가 날아가 버린다.
   * **열린 시트 안에서도 안 먹어야 한다** — 자세한 것은 `canGrabSlash`.
   * (Esc 는 여기 안 단다. 시트·에이전트 채팅이 저마다 document 에 Esc 를
   * 달아 두고 아무도 stopPropagation 을 안 하므로, 전역에 하나 더 얹으면 시트를
   * 닫는 Esc 가 찾기까지 함께 지운다. 찾기의 Esc 는 입력칸에만 단다.)
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const box = inputRef.current;
      if (!box || !canGrabSlash(e.target, box)) return;
      e.preventDefault();
      box.focus();
      // 머리말은 sticky 가 아니라 화면 밖일 수 있다. 이미 보이면 아무 일도
      // 안 하는 `nearest` 라 굴러갈 이유가 없을 때는 안 굴러간다.
      box.scrollIntoView({ block: "nearest" });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return {
    inputRef,
    raw,
    setQuery,
    onCompositionStart: () => {
      composing.current = true;
    },
    /**
     * 지금 조합 중인가. **키 처리의 보조 신호다.**
     *
     * 주 신호는 이벤트가 실어 오는 `isComposing` 이고, 그 값을 안 실어 주는
     * 판에서만 이 깃발이 답한다. 함수로 내놓는 것은 ref 를 그대로 넘기면
     * 부르는 쪽이 `.current` 를 그리기 중에 읽어도 되는 값으로 오해하기
     * 때문이다 — 이 값은 **이벤트가 일어난 순간에만** 뜻이 있다.
     */
    isComposing: () => composing.current,
    commitComposition,
    chips,
    setChips,
    nChips,
    tagOptions,
    active,
    hasQuery: words.length > 0,
    results,
    shown,
    total: results.length,
    truncated: results.length > MAX_ROWS,
    cursorAt,
    move,
    openCursor,
    clearAll,
    deepBusy,
    deepError,
    /**
     * 지금 화면이 **깊은 자리까지 본 답**으로 그려지고 있는가.
     *
     * 빈 결과에 무슨 안내를 붙일지가 여기에 걸린다. 거짓이면 본 것은 목록에
     * 실린 여덟 칸뿐인데(기다리는 중 · 서버가 죽음 · 낱말이 너무 많음),
     * 그때 "열한 자리를 다 찾아봤다" 고 적으면 바로 위의 오류 줄이나 알림 줄과
     * 맞선다 — 같은 화면에서 두 문장이 서로를 부정하면 사람은 둘 다 안 믿는다.
     */
    deepServed: served,
    notes,
  };
}

/**
 * `/` 가 찾기 상자를 낚아채도 되는가.
 *
 * 두 가지를 본다.
 *
 * 1. **글자를 받는 자리인가** — 입력칸·textarea·contenteditable, 그리고 열린
 *    모달이나 메뉴 안. 서가 이름을 고치다가, 혹은 시트의 단추에 포커스를 둔
 *    채 `/` 를 치면 글자 대신 포커스가 뒤로 날아가 버린다.
 * 2. **찾기 상자가 지금 사람 눈에 닿는 자리인가** — 시트가 열려 있는데 뒤의
 *    상자로 포커스가 가면, 사람은 시트를 보면서 안 보이는 곳에 글자를 친다.
 *
 * 표시(`role="dialog"` · `aria-modal`)가 붙은 모달은 `paper-sheet.tsx` 뿐이다.
 * **에이전트 대화창에는 그 표시가 없다** (`agent-chat.tsx` 는 `fixed inset-0`
 * 안의 맨 `<section>` 이다). 그래서 표시만 보면 대화창이 열린 채로 `/` 가
 * 뒤로 새는 구멍이 남는다. 표시를 붙이는 것이 옳지만 그 파일은 이번 일의
 * 것이 아니라, 표시가 없어도 걸리는 신호를 하나 더 둔다 — **화면 한가운데를
 * 덮은 `position: fixed` 겹.** 모달은 예외 없이 화면을 덮는 겹으로 뜨고,
 * 덮이지 않은 자리(업로드 큐 · 오류 토스트 같은 구석 패널)는 안 걸린다.
 */
function canGrabSlash(target: EventTarget | null, box: HTMLElement): boolean {
  const t = target instanceof HTMLElement ? target : null;
  if (t) {
    if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return false;
    if (t.closest('[role="dialog"],[aria-modal="true"],[role="menu"]')) return false;
  }
  if (document.querySelector('[role="dialog"],[aria-modal="true"]')) return false;

  /*
   * 한가운데에 무엇이 있는지 묻는다. 상자를 직접 짚어 보지 않는 것은 머리말이
   * 화면 밖으로 굴러가 있으면 짚을 자리 자체가 없기 때문이다. 한가운데에서
   * 위로 올라가며 보다가 **상자를 품은 조상**을 먼저 만나면 덮인 것이 아니고,
   * `fixed` 를 먼저 만나면 그 위에 무언가 떠 있는 것이다.
   */
  const top = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
  for (let el: Element | null = top; el; el = el.parentElement) {
    if (el.contains(box)) return true;
    if (getComputedStyle(el).position === "fixed") return false;
  }
  return true;
}

export type LibrarySearch = ReturnType<typeof useLibrarySearch>;

// ─────────────────────────────────────────────────────────────
//   찾기 상자
// ─────────────────────────────────────────────────────────────

/**
 * 입력칸과 결과 목록을 잇는 id.
 *
 * 목록은 `library.tsx` 가 머리말 **바깥에** 그린다. DOM 으로는 멀리 떨어져
 * 있어서, 짚은 줄이 낭독되려면 `aria-controls`/`aria-activedescendant` 로
 * 이어 주는 수밖에 없다. 한 화면에 찾기 상자가 하나뿐이라 고정 id 로 둔다.
 */
const LIST_ID = "library-search-results";

const optionId = (index: number) => `library-search-result-${index}`;

export function SearchBar({ search, className }: { search: LibrarySearch; className?: string }) {
  const [chipsOpen, setChipsOpen] = useState(false);
  const { active, nChips, total, cursorAt, shown } = search;
  /** 목록이 실제로 떠 있을 때만 잇는다 — 없는 id 를 가리키면 낭독이 헛돈다. */
  const listed = active && shown.length > 0;

  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg bg-(--color-bg-2) px-3 py-2 ring-1 ring-(--color-border-soft) transition focus-within:ring-(--color-accent)/60">
          <Search className="h-3.5 w-3.5 shrink-0 text-(--color-fg-4)" aria-hidden />
          <input
            ref={search.inputRef}
            type="text"
            value={search.raw}
            autoComplete="off"
            spellCheck={false}
            aria-label="서재에서 찾기"
            placeholder="서재에서 찾기  (/)"
            /*
              입력칸과 결과 목록을 combobox/listbox 로 잇는다.

              전에는 짚은 줄이 **눈에만** 보였다 — 왼쪽 띠와 바닥색뿐이고,
              낭독되는 것은 "12건" 이라는 개수 하나였다. 화살표를 아무리
              눌러도 어디를 짚었는지 소리로는 알 수 없으니, 보조기기로는
              Enter 를 누르기 전까지 무엇이 열릴지 모르는 상자였다.

              포커스는 입력칸에 그대로 두고 `aria-activedescendant` 로 짚은
              줄만 가리킨다(줄로 포커스를 옮기지 않는다). 화살표로 목록을
              훑는 동안에도 치던 글자를 계속 고칠 수 있어야 하기 때문이다.
            */
            role="combobox"
            aria-expanded={listed}
            aria-controls={listed ? LIST_ID : undefined}
            aria-activedescendant={listed && cursorAt >= 0 ? optionId(cursorAt) : undefined}
            aria-autocomplete="list"
            /*
              조합 여부를 이벤트에서 그대로 넘긴다. 훅이 든 깃발보다 이쪽이
              믿을 만하다 — 깃발은 `compositionend` 를 놓치면 선 채로 남는다.
            */
            onChange={(e) =>
              search.setQuery(e.target.value, (e.nativeEvent as InputEvent).isComposing)
            }
            onCompositionStart={search.onCompositionStart}
            onCompositionEnd={(e) => search.commitComposition(e.currentTarget.value)}
            // 조합 중에 떠나면 `compositionend` 가 안 오는 길이 있다. 여기서 푼다.
            onBlur={(e) => search.commitComposition(e.currentTarget.value)}
            onKeyDown={(e) => {
              /*
               * 조합 중에는 아무것도 안 한다. **그 키들은 IME 의 것이다.**
               *
               * 한자·한글 후보를 고르는 동안 ↑↓ 는 후보를 넘기는 키이고
               * Enter 는 확정하는 키다. 여기서 가로채면 후보를 고르는 사이
               * 짚은 자리가 함께 움직이고, 확정 Enter 가 **이전 질의**의 첫
               * 줄을 열어 버린다 — 조합 중에는 `applied` 가 안 바뀌므로 화면의
               * 결과가 아직 옛 질의의 것이기 때문이다. 사람은 글자를 확정했을
               * 뿐인데 엉뚱한 논문이 열린다.
               *
               * 이벤트가 스스로 아는 값을 먼저 본다. 그 값을 안 실어 주는 판이
               * 있어 훅의 깃발과 `keyCode 229`(IME 가 삼킨 키를 뜻하는 옛
               * 신호)를 보조로 함께 본다. 깃발이 걸린 채 남아도 Enter 가 영영
               * 막히지는 않는다 — 다음 입력 한 번이면 `setQuery` 가 이벤트
               * 값으로 덮어써 풀린다.
               */
              if (e.nativeEvent.isComposing || e.keyCode === 229 || search.isComposing()) return;

              if (e.key === "ArrowDown") {
                e.preventDefault();
                search.move(1);
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                search.move(-1);
              } else if (e.key === "Enter") {
                e.preventDefault();
                search.openCursor();
              } else if (e.key === "Escape") {
                /*
                 * 한 번에 다 지우지 않는다. 칩을 켜 두고 낱말만 바꿔 가며
                 * 찾는 것이 이 상자의 보통 쓰임이라, 첫 Esc 로 칩까지
                 * 날리면 다시 켜야 한다. 질의 → 칩 → 포커스 차례로 뺀다.
                 */
                e.preventDefault();
                if (search.raw) search.setQuery("");
                else if (nChips > 0) search.setChips({ ...EMPTY_CHIPS });
                else e.currentTarget.blur();
              }
            }}
            className="min-w-0 flex-1 bg-transparent text-sm text-(--color-fg) outline-none placeholder:text-(--color-fg-4)"
          />

          {search.deepBusy && (
            <Loader2 className="h-3 w-3 shrink-0 animate-spin text-(--color-fg-4)" aria-hidden />
          )}

          {/*
            눈에 보이는 개수 자리가 곧 낭독 자리다. 따로 숨긴 문구를 두면
            화면과 소리가 갈라진다. 조합 중에는 `applied` 가 안 바뀌므로
            이 숫자도 안 바뀐다 — 낭독이 튀지 않는 것도 그래서다.
          */}
          <span
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="shrink-0 text-[11px] tabular-nums text-(--color-fg-4)"
          >
            {active ? `${total}건` : ""}
          </span>

          {active && (
            <button
              type="button"
              onClick={() => {
                search.clearAll();
                search.inputRef.current?.focus();
              }}
              title="찾기 지우기"
              aria-label="찾기 지우기 (Esc)"
              className="grid h-5 w-5 shrink-0 place-items-center rounded text-(--color-fg-4) transition hover:bg-(--color-surface-hi) hover:text-(--color-fg-2)"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => setChipsOpen((v) => !v)}
          aria-expanded={chipsOpen}
          title="읽기 상태 · 표시 · 태그로 거르기"
          aria-label={nChips > 0 ? `거르기 (${nChips}개 켜짐)` : "거르기"}
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs ring-1 transition",
            nChips > 0
              ? "bg-(--color-accent-soft) text-(--color-accent-strong) ring-(--color-accent)/40"
              : "bg-(--color-surface) text-(--color-fg-3) ring-(--color-border-soft) hover:bg-(--color-surface-hi) hover:text-(--color-fg-2)",
          )}
        >
          <ListFilter className="h-3.5 w-3.5" />
          {nChips > 0 && (
            <span className="font-mono text-[10px] tabular-nums">{nChips}</span>
          )}
        </button>
      </div>

      {chipsOpen && <ChipPanel search={search} />}
    </div>
  );
}

/** 태그 칩을 한 번에 몇 개까지 펼쳐 둘지. 서재에 태그가 많으면 접어 둔다. */
const TAG_PREVIEW = 18;

function ChipPanel({ search }: { search: LibrarySearch }) {
  const [allTags, setAllTags] = useState(false);
  const { chips, setChips, tagOptions } = search;

  /*
   * **켜 둔 칩은 접힌 자리에 숨지 않는다.**
   *
   * 태그 목록은 많이 쓰인 차례라, 서재에서 사라진 태그(0편)는 자연히 맨 뒤로
   * 밀린다. 그대로 18개에서 자르면 켜져 있는데 화면에 없는 칩이 생기고,
   * 그러면 끌 수가 없다 — 결함이 모양만 바뀐 채 남는 셈이다. 켜진 것을 앞으로
   * 끌어와 자르기 전에 넣는다. 켜진 것이 앞에 서는 차례는 거르개를 볼 때
   * 사람이 기대하는 차례이기도 하다.
   */
  const tags = useMemo(() => {
    if (allTags) return tagOptions;
    const on = tagOptions.filter((t) => hasTag(chips.tags, t.tag));
    const off = tagOptions.filter((t) => !hasTag(chips.tags, t.tag));
    return [...on, ...off.slice(0, Math.max(0, TAG_PREVIEW - on.length))];
  }, [allTags, tagOptions, chips.tags]);

  const hasGone = tags.some((t) => t.count === 0);

  return (
    <div className="flex flex-col gap-2 rounded-lg bg-(--color-surface) p-2.5 ring-1 ring-(--color-border-soft)">
      <ChipRow label="읽기 상태">
        {READ_STATES.map((s) => {
          const meta = READ_META[s];
          const on = chips.read.includes(s);
          return (
            <Chip
              key={s}
              on={on}
              label={meta.label}
              spoken={`읽기 상태 ${meta.label}${on ? " 켜짐" : ""}`}
              onClick={() => setChips({ ...chips, read: toggleIn(chips.read, s) })}
            >
              <meta.Icon className="h-3 w-3" />
            </Chip>
          );
        })}
      </ChipRow>

      <ChipRow label="표시">
        {PAPER_MARKS.map((m) => {
          const on = chips.marks.includes(m);
          return (
            <Chip
              key={m}
              on={on}
              label={MARK_META[m].label}
              spoken={`표시 ${MARK_META[m].label}${on ? " 켜짐" : ""}`}
              onClick={() => setChips({ ...chips, marks: toggleIn(chips.marks, m) })}
            >
              <MarkIcon mark={m} className="h-3 w-3" />
            </Chip>
          );
        })}
      </ChipRow>

      <ChipRow label="태그">
        {tagOptions.length === 0 ? (
          // 왜 비었는지는 한 줄 남긴다. 빈 자리는 고장으로 보인다.
          <span className="text-[11px] break-keep text-(--color-fg-4)">
            서재에 태그가 아직 없습니다 — 서지정보 편집에서 붙일 수 있습니다
          </span>
        ) : (
          <>
            {tags.map(({ tag, key, count }) => {
              // 켜졌는지는 **눕힌 키로** 본다. 서재의 표기가 `RL` 에서 `rl` 로
              // 바뀌어도 켜 둔 칩은 켜진 채로 보이고, 눌러 끌 수 있다.
              const on = hasTag(chips.tags, tag);
              return (
                <Chip
                  key={key}
                  on={on}
                  label={tag}
                  spoken={`태그 ${tag}, ${count === 0 ? "지금 서재에 없음" : `${count}편`}${on ? ", 켜짐" : ""}`}
                  onClick={() => setChips({ ...chips, tags: toggleTag(chips.tags, tag) })}
                >
                  <span className="font-mono text-[9px] tabular-nums opacity-70">{count}</span>
                </Chip>
              );
            })}
            {!allTags && tagOptions.length > tags.length && (
              <button
                type="button"
                onClick={() => setAllTags(true)}
                className="rounded-full px-2 py-0.5 text-[11px] text-(--color-fg-4) transition hover:bg-(--color-surface-hi) hover:text-(--color-fg-2)"
              >
                모두 보기 ({tagOptions.length})
              </button>
            )}
          </>
        )}
      </ChipRow>

      {/* 0 이라는 숫자만으로는 왜 남아 있는지 알 수 없다. 한 줄로 적어 둔다. */}
      {hasGone && (
        <p className="pl-16 text-[10.5px] break-keep text-(--color-fg-4)">
          0편인 칩은 지금 서재에 없는 태그입니다 — 눌러서 끌 수 있습니다
        </p>
      )}
    </div>
  );
}

function ChipRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="w-14 shrink-0 pt-0.5 text-[10px] tracking-wider text-(--color-fg-4)">
        {label}
      </span>
      <div className="flex min-w-0 flex-wrap items-center gap-1">{children}</div>
    </div>
  );
}

/**
 * 켜고 끄는 칩.
 *
 * 켜진 것을 **색만으로 말하지 않는다.** accent-soft 바닥은 트랙 대비가 낮아
 * 어느 쪽이 켜졌는지 알아보기 어렵다 (MemoBento 의 보기 토글이 같은 이유로
 * 테두리를 두 번째 신호로 뒀다). 그래서 켜지면 테두리도 accent 로 간다.
 */
function Chip({
  on,
  label,
  spoken,
  onClick,
  children,
}: {
  on: boolean;
  label: string;
  spoken: string;
  onClick: () => void;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      title={label}
      aria-label={spoken}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ring-1 transition",
        on
          ? "bg-(--color-accent-soft) text-(--color-accent-strong) ring-(--color-accent)/40"
          : "bg-(--color-bg-2) text-(--color-fg-3) ring-(--color-border-soft) hover:bg-(--color-surface-hi) hover:text-(--color-fg-2)",
      )}
    >
      {children}
      {label}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
//   결과
// ─────────────────────────────────────────────────────────────

export function SearchResults({
  search,
  actions,
}: {
  search: LibrarySearch;
  actions: PaperRowActions;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const { cursorAt, shown, total, deepBusy, deepError, notes } = search;

  /*
   * 짚은 줄을 화면 안으로.
   *
   * 결과 줄에는 ref 도 `data-*` 도 없었다 (`PaperRow` 는 그런 걸 안 받는다).
   * 줄마다 ref 를 배열로 들고 다니는 대신 감싸개에 번호를 적어 두고 그때그때
   * 찾는다 — 줄 수가 200으로 묶여 있어 비용이 없고, 목록이 바뀔 때 ref
   * 배열이 어긋나는 사고도 없다.
   */
  useEffect(() => {
    if (cursorAt < 0) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-result-index="${cursorAt}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [cursorAt, shown]);

  return (
    <section className="overflow-hidden rounded-[var(--radius-card)] bg-(--color-surface) ring-1 ring-(--color-border-soft)">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-(--color-border-soft) bg-(--color-bg-2)/60 px-4 py-2 text-[11px] text-(--color-fg-4)">
        <span className="text-(--color-fg-2)">
          찾은 논문 <span className="font-mono tabular-nums">{total}</span>편
        </span>

        {deepBusy && (
          <span className="inline-flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            요약 · 메모 · PDF 본문까지 찾는 중
          </span>
        )}
        {deepError && (
          // 색만으로 말하지 않는다 — 아이콘이 두 번째 신호다.
          <span className="inline-flex items-start gap-1 break-keep text-(--color-danger)">
            <AlertCircle className="mt-px h-3 w-3 shrink-0" aria-hidden />
            {deepError}
          </span>
        )}

        {/*
          `hidden sm:inline` 이었다. 좁은 화면에서 통째로 사라지니, 키보드만
          쓰는 사람이 폭을 줄인 창에서는 ↑↓ 로 옮길 수 있다는 것을 알 길이
          없었다. 이제 넓으면 오른쪽 끝에 붙고 좁으면 제 줄로 내려간다
          (머리말이 `flex-wrap` 이다).
        */}
        <span className="break-keep sm:ml-auto">↑↓ 옮기기 · Enter 열기 · Esc 지우기</span>
      </header>

      {notes.length > 0 && (
        <ul className="flex flex-col gap-1 border-b border-(--color-border-soft) bg-(--color-bg-2)/40 px-4 py-2">
          {notes.map((n) => (
            <li
              key={n}
              className="flex items-start gap-1.5 text-[11px] break-keep text-(--color-fg-3)"
            >
              <AlertCircle className="mt-px h-3 w-3 shrink-0 text-(--color-fg-4)" aria-hidden />
              {n}
            </li>
          ))}
        </ul>
      )}

      {shown.length === 0 ? (
        <EmptyResult search={search} />
      ) : (
        <div
          ref={listRef}
          id={LIST_ID}
          role="listbox"
          aria-label="찾은 논문"
          className="divide-y divide-(--color-border-soft)"
        >
          {shown.map((r, i) => (
            <ResultRow
              key={r.paper.id}
              result={r}
              index={i}
              total={shown.length}
              active={i === cursorAt}
              actions={actions}
            />
          ))}
        </div>
      )}

      {search.truncated && (
        <p className="border-t border-(--color-border-soft) px-4 py-2 text-[11px] break-keep text-(--color-fg-4)">
          앞의 {MAX_ROWS}편만 보입니다 — 낱말을 더하거나 칩을 켜서 좁혀 보세요
        </p>
      )}
    </section>
  );
}

function ResultRow({
  result,
  index,
  total,
  active,
  actions,
}: {
  result: SearchResult;
  index: number;
  total: number;
  active: boolean;
  actions: PaperRowActions;
}) {
  /*
   * 조각은 **하나만** 보인다. 자리마다 한 줄씩 붙이면 줄 하나가 화면 반쪽을
   * 먹어 목록을 훑을 수가 없다. 어디어디서 맞았는지는 딱지가 전부 말하고,
   * 조각은 맨 앞의 것(요약 → 메모 → PDF 차례)으로 맛만 보인다.
   */
  const snippet = result.snippet;

  /*
   * 낭독될 한 줄.
   *
   * 줄 안에는 표식·읽기 상태 단추가 들어 있어서, 이름을 안 적어 두면 짚을
   * 때마다 그 단추 이름들까지 죽 읽힌다. 사람이 목록을 훑을 때 듣고 싶은
   * 것은 제목 · 어느 서가 · 어디서 맞았나 · 몇 번째인가, 이 넷뿐이다.
   * (단추는 Tab 으로 갈 때 제 이름을 따로 말한다.)
   */
  const where = [
    ...result.fields.map((f) => FRONT_LABEL[f]),
    ...result.deep.map((w) => WHERE_META[w].label),
  ];
  const spoken = [
    result.paper.title,
    result.path.join(" "),
    where.length > 0 ? `${where.join(" · ")}에서 맞음` : null,
    `${index + 1} / ${total}`,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div
      data-result-index={index}
      /*
       * 짚은 줄이 **소리로도** 짚힌다. 포커스는 입력칸에 있으므로
       * (`aria-activedescendant`), 여기 걸린 id 와 `aria-selected` 가 짚은
       * 자리를 말하는 유일한 길이다.
       */
      id={optionId(index)}
      role="option"
      aria-selected={active}
      aria-label={spoken}
      /*
       * 짚은 줄을 바닥색만으로 말하지 않는다. 왼쪽 띠가 두 번째 신호다 —
       * `PaperRow` 가 제 hover 바닥(surface-hi)을 따로 칠하기 때문에, 마우스가
       * 얹힌 줄과 키보드가 짚은 줄이 색만으로는 헷갈린다.
       */
      className={cn(
        "border-l-2 transition-colors",
        active ? "border-(--color-accent) bg-(--color-surface-2)" : "border-transparent",
      )}
    >
      {/* dragHandleProps 를 안 넘긴다 — 표지가 그냥 표지가 된다.
          결과는 서가를 가로지르는 납작한 목록이라 순서라는 것이 없고,
          `reorderPapers` 는 한 서가의 온전한 차례만 받는 API 다. 걸러진
          부분집합으로 차례를 보내면 안 보이던 논문이 조용히 뒤로 밀린다. */}
      <PaperRow paper={result.paper} actions={actions} />

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 pb-2 text-[10.5px] text-(--color-fg-4)">
        <span
          className="inline-flex min-w-0 items-center gap-1"
          title={`서가: ${result.path.join(" › ")}`}
        >
          <FolderTree className="h-3 w-3 shrink-0" aria-hidden />
          <span className="truncate">{result.path.join(" › ")}</span>
        </span>

        {/* 목록에 실려 온 칸에서 맞은 자리 — 꽉 찬 딱지. */}
        {result.fields.map((f) => (
          <span
            key={f}
            className="rounded-full bg-(--color-bg-2) px-1.5 py-px ring-1 ring-(--color-border-soft)"
          >
            {FRONT_LABEL[f]}
          </span>
        ))}

        {/*
          목록에 없는 자리(요약·메모·PDF 본문)에서 걸린 것 — 점선 딱지 + 아이콘.
          색만 바꾸지 않는 것은 색을 못 가리는 눈이 있어서이고, 점선을 고른
          것은 "목록에 실려 있지 않아 서버가 열어 본 것" 이라는 뜻이 모양에
          담기기 때문이다 (`paper-sheet` 의 추측 딱지와 같은 결).
        */}
        {result.deep.map((w) => {
          const meta = WHERE_META[w];
          return (
            <span
              key={w}
              title={meta.spoken}
              className="inline-flex items-center gap-0.5 rounded-full border border-dashed border-(--color-fg-4)/60 px-1.5 py-px"
            >
              <meta.Icon className="h-2.5 w-2.5" />
              {meta.label}
            </span>
          );
        })}
      </div>

      {snippet && (
        // fg-4 는 본문 대비에 못 미친다 — 읽으라고 내놓은 글자는 fg-3 부터다.
        <p className="line-clamp-2 px-4 pb-2.5 text-[11px] leading-relaxed break-keep text-(--color-fg-3)">
          {snippet}
        </p>
      )}
    </div>
  );
}

/**
 * 아무것도 안 걸렸을 때.
 *
 * "없습니다" 만 두지 않는다 — 무엇 때문에 비었는지, 무엇을 해 볼 수 있는지
 * 까지 적어야 사람이 다음 걸음을 옮긴다. 아직 뒤(깊은 찾기)가 돌고 있으면
 * 아예 "없다" 고 말하지 않는다. 그때 없다고 했다가 곧 결과가 생기면, 그
 * 한 번으로 이 상자를 못 믿게 된다.
 */
function EmptyResult({ search }: { search: LibrarySearch }) {
  if (search.deepBusy) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center text-(--color-fg-4)">
        <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
        <p className="text-xs break-keep">
          요약 · 메모 · PDF 본문까지 찾는 중입니다
        </p>
      </div>
    );
  }

  const hints = [
    search.hasQuery
      ? "낱말을 줄이거나 짧게 잘라 보세요 — 낱말은 하나도 빠짐없이 들어 있어야 맞습니다"
      : null,
    search.nChips > 0 ? "켜 둔 칩을 꺼 보세요 — 칩은 질의와 함께 걸립니다" : null,
    /*
     * 어디를 찾아봤는지는 **실제로 찾아본 만큼만** 적는다.
     *
     * 열한 자리를 다 본 것은 서버가 이 질의에 답했을 때뿐이다. 서버가 죽었거나
     * 낱말이 너무 많아 아예 안 찾았을 때는 목록에 실린 여덟 칸이 전부인데, 그때도
     * "열한 자리를 이미 찾아봤습니다" 라고 적으면 바로 위에 뜬 오류 줄("요약 ·
     * 메모 · PDF 본문은 빠져 있습니다")이나 알림 줄("서버가 찾지 않았습니다")과
     * 정면으로 맞선다. 한 화면에서 두 문장이 서로를 부정하면 사람은 어느 쪽도
     * 안 믿게 되고, "없다" 는 결론까지 함께 못 믿게 된다.
     */
    search.hasQuery
      ? search.deepServed
        ? "제목 · 저자 · 학회 · 연도 · DOI · arXiv · 태그 · 초록 · 요약 · 메모 · PDF 앞부분, 열한 자리를 이미 찾아봤습니다 (낱말 하나가 어느 자리에 있든 맞습니다)"
        : "지금 찾아본 것은 목록에 실린 여덟 칸(제목 · 저자 · 학회 · 연도 · DOI · arXiv · 태그 · 초록)뿐입니다 — 요약 · 메모 · PDF 앞부분은 아직 못 봤습니다"
      : null,
  ].filter(Boolean) as string[];

  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center text-(--color-fg-4)">
      <SearchX className="h-6 w-6" aria-hidden />
      <p className="text-xs break-keep text-(--color-fg-3)">맞는 논문이 없습니다</p>
      <ul className="flex flex-col gap-0.5">
        {hints.map((h) => (
          <li key={h} className="text-[11px] break-keep">
            {h}
          </li>
        ))}
      </ul>
    </div>
  );
}
