"use client";

import { AlertTriangle, Check, FileText, Loader2, Search, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  api,
  type BiblioClue,
  type BiblioGuess,
  type PaperInput,
} from "@/lib/client-api";
import {
  coverUrl,
  formatBytes,
  paperUrl,
  type GroupDTO,
  type LookupReport,
  type LookupResult,
  type LookupSource,
  type PaperDTO,
} from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * 논문 등록·편집 시트.
 *
 * PDF 를 올린 **직후에 곧바로 열린다.** 파일 이름이 곧 논문 제목인 경우가
 * 거의 없기 때문이다 — `2310.06825v3.pdf` 를 그대로 서재에 꽂아 두면 나중에
 * 그게 무엇이었는지 알 길이 없고, 서지정보를 나중에 채우겠다는 다짐은
 * 지켜지지 않는다. 그래서 올린 자리에서 한 번 묻는다.
 *
 * 그때 시트는 **고치는 중**이지 만드는 중이 아니다. 논문 행은 업로드를 확정한
 * 서버가 이미 세웠다. 여기서 또 만들면 같은 PDF 를 가리키는 논문이 둘이 된다.
 * 다만 사람에게는 "등록" 으로 보여야 하므로 문구만 `fresh` 로 가른다.
 *
 * DOI·arXiv 번호를 적으면 이미 있는 논문인지 알려 주되 **막지는 않는다.**
 * 같은 논문을 두 서가에 두고 싶은 날이 오고, 에이전트가 틀린 DOI 를 제안하는
 * 날도 온다. 저장이 "제약 위반" 으로 죽는 것보다 알려 주고 맡기는 편이 낫다.
 *
 * ## 빈 칸은 두 곳에서 온다 — 그리고 순서가 있다
 *
 * 1. **찾아오기** — doi.org·arXiv·Crossref 가 준 값. 정확한 것이다.
 * 2. **에이전트** — 모델이 PDF 앞부분을 읽고 짐작한 값. 추측이다.
 *
 * 늘 1이 먼저 돌고, 찾은 것을 **단서로 넘겨** 2가 남은 빈 칸만 메운다. 순서를
 * 뒤집으면 같은 칸에 두 값이 서로 다르게 앉고, 그때부터는 어느 쪽이 맞는지
 * 사람이 가려야 한다. 넘기지 않아도 될 일을 넘기는 것이다.
 *
 * 그래서 **화면에서도 둘이 같아 보이면 안 된다.** 이름표 옆 딱지(`OriginBadge`)와
 * 칸 밑 줄(`SuggestRow`)이 출처를 말하고, 추측 쪽은 점선으로 눌러 그린다. 한
 * 칸을 둘 다 들고 있으면 등록기관 쪽만 보여 준다 — 둘 중 하나를 고르는 일을
 * 없애려고 찾아오기를 먼저 돌린 것이니, 화면에서 그 일을 다시 만들면 안 된다.
 *
 * 적용 규칙은 두 출처가 같다. **이미 적어 둔 칸은 안 덮고**, 저장과 "전부 적용"
 * 이 같은 함수(`mergeSuggestions`)를 쓴다.
 */

export interface SheetTarget {
  /** 새로 만드는가(PDF 없이 서지정보만), 이미 있는 것을 고치는가. */
  mode: "create" | "edit";
  /** 고칠 논문 (mode === "edit"). */
  paper?: PaperDTO;
  /** 처음 놓일 서가. */
  groupId: string;
  /** 방금 올라온 것인가. 문구만 "등록" 으로 바꾼다. */
  fresh?: boolean;
}

/** 시트가 다루는 칸들. `PaperInput` 에서 화면이 안 건드리는 것을 뺀 것. */
type Fields = Required<
  Pick<
    PaperInput,
    "title" | "authors" | "venue" | "year" | "doi" | "arxivId" | "abstract" | "tags" | "url"
  >
> & {
  /**
   * 찾아온 서지정보의 **원본**(CSL-JSON 문자열).
   *
   * 다른 칸과 달리 `Required` 밖에 둔다 — 있을 때만 실려 나가야 하기 때문이다.
   * 서재 목록도 상세도 csl 본문은 안 받아 오므로(한 편에 1~2KB 라 무겁다) 시트가
   * 열릴 때 이 값은 **늘 비어 있다.** 이걸 다른 칸처럼 늘 실어 보내면 제목만
   * 고쳐 저장하는 순간 서버가 `csl: null` 을 받아 애써 받아 둔 원본을 지운다.
   * 그래서 찾아온 후보를 적용했을 때만 채운다.
   */
  csl?: string;
};

/** 찾아오기가 제안할 수 있는 칸. 태그는 바깥에서 오지 않는다. */
const SUGGEST_KEYS = [
  "title",
  "authors",
  "venue",
  "year",
  "doi",
  "arxivId",
  "url",
  "abstract",
] as const;
type SuggestKey = (typeof SUGGEST_KEYS)[number];

const SOURCE_LABEL: Record<LookupSource, string> = {
  doi: "DOI",
  arxiv: "arXiv",
  crossref: "제목 검색",
};

/**
 * 제안이 어디서 왔는가. **화면에서 이 둘은 절대 같아 보이면 안 된다.**
 *
 * `lookup` 은 등록기관(doi.org·arXiv·Crossref)이 준 값이고 `agent` 는 모델이
 * PDF 를 읽고 짐작한 값이다. 한쪽은 확인된 것이고 다른 쪽은 추측인데, 같은
 * 회색 글씨로 나란히 두면 사람은 둘 다 "어디선가 찾아온 값" 으로 읽는다.
 * 그러면 틀린 저자 이름이 확인 없이 저장된다.
 */
type Origin = "lookup" | "agent";

/**
 * 에이전트가 채울 수 있는 칸.
 *
 * `url` 이 없는 것은 일부러다. 원문 주소는 눌러서 열리는 값이라 틀리면 엉뚱한
 * 곳으로 가는데, 모델이 논문 첫 쪽을 보고 지어낼 만한 것이기도 하다. 주소는
 * 등록기관이 준 것만 받는다.
 */
const AGENT_KEYS = [
  "title",
  "authors",
  "venue",
  "year",
  "doi",
  "arxivId",
  "abstract",
] as const;
type AgentKey = (typeof AGENT_KEYS)[number];

/** 찾아오기가 쓸 재료가 있는가. 없으면 부를 것도 없다. */
function lookupable(f: Fields): boolean {
  return (
    Boolean(f.doi?.trim()) ||
    Boolean(f.arxivId?.trim()) ||
    (f.title?.trim().length ?? 0) >= 4
  );
}

/** 채울 빈 칸이 하나라도 있는가. 없으면 에이전트를 부르지 않는다. */
function hasBlank(f: Fields): boolean {
  return SUGGEST_KEYS.some((k) => {
    const v = f[k];
    return v === null || v === undefined || String(v).trim() === "";
  });
}

/** 찾아온 후보를 에이전트에게 넘길 단서로 눕힌다. */
function clueOf(r: LookupResult): BiblioClue {
  return { source: r.source, ...r.fields };
}

/** 폴링 간격. 더 짧게 물어봐도 답이 빨리 나오지는 않는다. */
const POLL_MS = 2500;
/** 이만큼 물어보고도 안 끝나면 접는다. 서버도 6분에서 실패로 접는다. */
const MAX_POLLS = 160;

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const EMPTY: Fields = {
  title: "",
  authors: null,
  venue: null,
  year: null,
  doi: null,
  arxivId: null,
  abstract: null,
  tags: null,
  url: null,
};

function fieldsOf(target: SheetTarget): Fields {
  const p = target.paper;
  if (!p) return EMPTY;
  return {
    title: p.title,
    authors: p.authors,
    venue: p.venue,
    year: p.year,
    doi: p.doi,
    arxivId: p.arxivId,
    abstract: p.abstract,
    tags: p.tags,
    url: p.url,
  };
}

export function PaperSheet({
  target,
  groups,
  onSubmit,
  onClose,
}: {
  target: SheetTarget | null;
  groups: GroupDTO[];
  onSubmit: (groupId: string, fields: Fields) => Promise<void>;
  onClose: () => void;
}) {
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [groupId, setGroupId] = useState("");
  const [busy, setBusy] = useState(false);
  const [dups, setDups] = useState<{ id: string; title: string }[]>([]);
  const titleRef = useRef<HTMLInputElement | null>(null);

  /*
   * 찾아오기 상태.
   *
   * `report` 는 거쳐 온 길까지 담고 있어서 실패했을 때도 버리지 않는다.
   * `picked` 는 사람이 고른 후보 — 제목으로 찾으면 후보가 여럿이라 우리가
   * 고르면 안 된다. 하나뿐이면 고를 것이 없으므로 저절로 정해진다.
   */
  const [lookupBusy, setLookupBusy] = useState(false);
  const [report, setReport] = useState<LookupReport | null>(null);
  const [picked, setPicked] = useState<LookupResult | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);

  /*
   * 에이전트 상태.
   *
   * `agent` 는 **부를 수 있는가**다. 열 때 한 번 서버에 묻는다 — 못 부르는데
   * 토글을 켜 두고 누를 때 실패하는 것은 없느니만 못하다.
   *
   * `guess` 는 모델이 짐작한 값이고 `picked.fields` 와 **끝까지 갈라 둔다.**
   * 한 자루에 담으면 화면에서도 저장에서도 어느 쪽이 정확한 값이었는지가
   * 사라진다.
   *
   * `pendingPick` 은 "찾아오기가 후보를 여럿 내놔서 멈춰 있다" 는 뜻이다.
   * 무엇을 단서로 줄지는 사람이 고른 뒤여야 한다 — 우리가 1등을 골라 단서로
   * 주면 틀린 논문의 서지정보를 확정된 값이라고 모델에게 알려 주는 셈이다.
   */
  const [agent, setAgent] = useState<{ ready: boolean; reason: string | null } | null>(null);
  const [agentOn, setAgentOn] = useState(false);
  const [agentBusy, setAgentBusy] = useState<null | "lookup" | "agent">(null);
  const [pendingPick, setPendingPick] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [guess, setGuess] = useState<BiblioGuess | null>(null);
  const [guessId, setGuessId] = useState<string | null>(null);

  /**
   * 지금 돌고 있는 것의 번호.
   *
   * 시트는 닫혀도 **언마운트되지 않는다** (`target` 이 null 이면 null 을 그릴
   * 뿐이다). 그래서 폴링이 늦게 돌아오면 이미 다른 논문을 열어 둔 화면에
   * 앞 논문의 추측을 꽂아 넣을 수 있다. 열 때마다 번호를 올리고, 돌아온 답은
   * 번호가 같을 때만 받는다.
   */
  const runSeq = useRef(0);
  useEffect(() => () => void runSeq.current++, []);

  const paperId = target?.paper?.id ?? null;
  const hasPdf = Boolean(target?.paper?.file);

  // 열릴 때마다 값을 새로 심는다. 앞서 열었던 논문의 저자가 남아 있으면
  // 그걸 그대로 저장해 버리는 사고가 난다.
  useEffect(() => {
    if (!target) return;
    setFields(fieldsOf(target));
    setGroupId(target.groupId);
    setDups([]);
    // 앞 논문의 후보가 남아 있으면 남의 서지정보를 제안하게 된다.
    setReport(null);
    setPicked(null);
    setLookupError(null);
    setLookupBusy(false);
    // 앞 논문의 추측이 남으면 남의 제목이 회색으로 들어가 있게 된다.
    setAgent(null);
    setAgentOn(false);
    setAgentBusy(null);
    setPendingPick(false);
    setAgentError(null);
    setGuess(null);
    setGuessId(null);
    // 방금 올린 것의 제목은 파일 이름에서 딴 짐작이라 거의 늘 고쳐야 한다.
    // 열자마자 통째로 골라 둔다 — 바로 덮어쓸 수 있게.
    queueMicrotask(() => titleRef.current?.select());
  }, [target]);

  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [target, onClose]);

  /*
   * 중복 찾기는 타이핑이 멎은 뒤에 한 번만 한다.
   *
   * DOI 는 30글자가 넘는다. 한 글자마다 물어보면 요청이 서른 번 나가고,
   * 그중 앞선 것이 늦게 도착해 "없음" 으로 덮는 일까지 생긴다.
   */
  const dupKey = `${fields.doi ?? ""}|${fields.arxivId ?? ""}`;
  useEffect(() => {
    if (!target) return;
    let alive = true;
    const timer = setTimeout(() => {
      void api
        .findDuplicates({
          doi: fields.doi,
          arxivId: fields.arxivId,
          // 고치는 중이라면 자기를 뺀다. 안 그러면 자기 DOI 를 자기가 겹친
          // 것으로 잡아 늘 경고가 뜬다.
          exceptId: target.paper?.id,
        })
        .then((hits) => alive && setDups(hits))
        .catch(() => undefined);
    }, 450);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // dupKey 하나만 본다 — 제목을 고칠 때마다 다시 물어볼 이유가 없다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dupKey, target]);

  /** 서가와 그 안의 칸을 한 줄로 편다. 고르는 자리에서는 두 단이면 충분하다. */
  const options = useMemo(
    () =>
      groups.flatMap((g) => [
        { id: g.id, label: g.name, depth: 0 },
        ...g.children.map((c) => ({ id: c.id, label: c.name, depth: 1 })),
      ]),
    [groups],
  );

  // ── 찾아오기 → 에이전트 ────────────────────────────────────

  /**
   * 세 칸을 **함께** 보낸다. 무엇으로 찾을지는 서버가 정한다 (DOI → arXiv → 제목).
   *
   * 사람에게 "어느 것으로 찾을까요" 를 묻지 않는 이유는, 물어봤자 답이 늘
   * "있는 것으로" 이기 때문이다.
   *
   * 보고서를 그대로 돌려주는 것은 이어서 에이전트가 쓰기 때문이다. 상태에서
   * 다시 읽으면 그 시점에는 아직 옛 값이다.
   */
  const doLookup = useCallback(async (base: Fields): Promise<LookupReport | null> => {
    setLookupBusy(true);
    setLookupError(null);
    setReport(null);
    setPicked(null);
    try {
      const r = await api.lookup({
        doi: base.doi,
        arxiv: base.arxivId,
        title: base.title,
      });
      setReport(r);
      // 후보가 하나뿐이면 고를 것이 없다. 바로 제안으로 편다.
      if (r.candidates.length === 1) setPicked(r.candidates[0]);
      return r;
    } catch (e) {
      setLookupError(e instanceof Error ? e.message : "찾아오기에 실패했습니다");
      return null;
    } finally {
      setLookupBusy(false);
    }
  }, []);

  /**
   * 에이전트에게 남은 빈 칸을 맡긴다.
   *
   * `clue` 는 방금 찾아온 것이다. 없으면(아무것도 못 찾았을 때) PDF 글자만으로
   * 간다 — 그때는 추측밖에 없으니 추측이라도 있는 편이 낫다.
   *
   * 시작만 시키고 몇 초마다 물어본다. 답까지 1분이 넘는 일이 흔한데, 요청을
   * 붙들면 앞의 터널이 100초에서 끊는다.
   */
  const runAgent = useCallback(
    async (clue: BiblioClue | null) => {
      if (!paperId) return;
      const seq = runSeq.current;
      setPendingPick(false);
      setAgentError(null);
      setAgentBusy("agent");
      try {
        let row = await api.biblio.start(paperId, clue);
        for (let i = 0; row && row.state === "running" && i < MAX_POLLS; i++) {
          await wait(POLL_MS);
          if (runSeq.current !== seq) return;
          row = (await api.biblio.status(paperId, row.id)).suggestion;
        }
        if (runSeq.current !== seq) return;
        if (!row || row.state === "running") {
          setAgentError("에이전트가 제 시간에 끝내지 못했습니다");
          return;
        }
        if (row.state === "failed") {
          setAgentError(row.error ?? "에이전트가 서지정보를 뽑지 못했습니다");
          return;
        }
        setGuess(row.fields);
        setGuessId(row.id);
      } catch (e) {
        if (runSeq.current !== seq) return;
        setAgentError(e instanceof Error ? e.message : "에이전트를 부르지 못했습니다");
      } finally {
        if (runSeq.current === seq) setAgentBusy(null);
      }
    },
    [paperId],
  );

  /**
   * **찾아오기가 먼저, 에이전트가 나중.** 이 순서가 이 기능의 전부다.
   *
   * 등록기관에서 받은 서지정보는 정확한 것이고, 모델이 PDF 를 읽어 짐작한 것은
   * 추측이다. 정확한 것이 있는데 추측부터 시키면 같은 칸에 두 값이 서로 다르게
   * 앉고, 그때부터는 어느 쪽이 맞는지 **사람이 가려야 한다.** 그건 넘기지
   * 않아도 될 일을 넘기는 것이다.
   *
   * 그래서 찾아온 것을 단서로 함께 넘겨 남은 빈 칸만 메우게 한다.
   *
   * 후보가 여럿이면 **여기서 멈춘다.** 제목 검색은 1등이 맞다는 보장이 없는데,
   * 우리가 골라 단서로 주면 틀린 논문의 서지정보를 "확정된 값" 이라고 모델에게
   * 알려 주는 셈이 된다. 사람이 고르면 그때 이어서 돈다.
   */
  const startChain = useCallback(
    async (base: Fields) => {
      const seq = runSeq.current;
      setAgentError(null);
      setGuess(null);
      setGuessId(null);
      setPendingPick(false);

      let clue: BiblioClue | null = null;
      if (lookupable(base)) {
        setAgentBusy("lookup");
        const r = await doLookup(base);
        if (runSeq.current !== seq) return;
        setAgentBusy(null);
        if (r && r.candidates.length > 1) {
          setPendingPick(true);
          return;
        }
        if (r && r.candidates.length === 1) clue = clueOf(r.candidates[0]);
      }
      await runAgent(clue);
    },
    [doLookup, runAgent],
  );

  /**
   * 시트가 열릴 때 한 번.
   *
   * 한 번의 요청으로 **부를 수 있는가**와 **이미 받아 둔 제안이 있는가**를 함께
   * 안다. 받아 둔 것이 있으면 그것을 쓴다 — 시트를 열 때마다 다시 부르면
   * 값도 시간도 그냥 버리는 것이고, 같은 PDF 에서 다른 답이 나와 사람만
   * 헷갈린다.
   */
  useEffect(() => {
    if (!target) {
      // 닫히면 돌고 있던 것을 놓는다. 답이 늦게 와도 받을 화면이 없는데,
      // 번호를 안 올리면 폴링이 몇 분을 더 돈다.
      runSeq.current++;
      return;
    }
    const seq = ++runSeq.current;

    if (!paperId || !hasPdf) {
      // 읽을 PDF 가 없으면 에이전트가 할 일이 없다. 켜 두면 눌렀을 때
      // "글자를 뽑지 못했습니다" 만 나온다.
      setAgent({
        ready: false,
        reason: "PDF 가 붙은 논문에서만 됩니다. 파일을 올린 뒤에 켤 수 있습니다.",
      });
      return;
    }

    const openFields = fieldsOf(target);
    void (async () => {
      const [state, config] = await Promise.all([
        api.biblio.status(paperId).catch(() => null),
        api.getConfig().catch(() => null),
      ]);
      if (runSeq.current !== seq) return;

      if (!state) {
        setAgent({ ready: false, reason: "에이전트를 부를 수 있는지 확인하지 못했습니다" });
        return;
      }
      setAgent(state.agent);

      const done = state.suggestion;
      if (done?.state === "done" && done.fields) {
        setGuess(done.fields);
        setGuessId(done.id);
        setAgentOn(true);
        /*
         * 받아 둔 추측은 그때 **단서를 받고** 만들어진 것이다. 등록기관이 들고
         * 있던 칸은 비워 두고 나머지만 채워져 있다. 그래서 찾아오기를 한 번 더
         * 돌려 정확한 쪽을 되살린다 — 안 그러면 제목 칸이 통째로 비어 보이고,
         * 화면에 남는 것은 추측뿐이라 이 기능의 순서가 거꾸로 보인다.
         *
         * 에이전트는 다시 부르지 않는다. 값도 시간도 드는 쪽은 그쪽이다.
         */
        if (hasBlank(openFields) && lookupable(openFields)) void doLookup(openFields);
        return;
      }

      // 못 부르면 **켜지 않는다.** 켜 놓고 누를 때 실패하는 것보다,
      // 왜 못 쓰는지 적힌 꺼진 토글이 낫다.
      if (!state.agent.ready) return;
      if (!config?.agentSuggestDefault) return;
      // 채울 칸이 하나도 없으면 부를 이유가 없다. 에이전트는 빈 칸만 메운다.
      if (!hasBlank(openFields)) return;

      setAgentOn(true);
      await startChain(openFields);
    })();
  }, [target, paperId, hasPdf, startChain, doLookup]);

  if (!target) return null;

  const set = <K extends keyof Fields>(k: K, v: Fields[K]) =>
    setFields((f) => ({ ...f, [k]: v }));

  const canLookup = lookupable(fields);

  /** 머리의 "찾아오기" 단추. 손으로 누를 때는 에이전트까지 끌고 가지 않는다. */
  const runLookup = async () => {
    if (lookupBusy || !canLookup) return;
    await doLookup(fields);
  };

  /**
   * 토글.
   *
   * 끄면 추측을 **치운다.** 회색으로 남겨 두면 저장할 때 그대로 딸려 들어가는데,
   * 사람은 방금 "쓰지 않겠다" 고 말한 것이다.
   */
  const toggleAgent = (on: boolean) => {
    setAgentOn(on);
    if (!on) {
      // 번호를 올려 돌고 있던 것의 답을 버린다.
      runSeq.current++;
      setAgentBusy(null);
      setPendingPick(false);
      setAgentError(null);
      setGuess(null);
      setGuessId(null);
      return;
    }
    if (guess || agentBusy || pendingPick) return;
    void startChain(fields);
  };

  /** 후보를 고르면 멈춰 있던 에이전트가 그 후보를 단서로 이어 돈다. */
  const pick = (c: LookupResult) => {
    setPicked(c);
    if (pendingPick) void runAgent(clueOf(c));
  };

  const isBlank = (k: SuggestKey): boolean => {
    const v = fields[k];
    return v === null || v === undefined || String(v).trim() === "";
  };

  /** 찾아온 값. 없으면 undefined. */
  const foundAt = (k: SuggestKey): string | number | undefined => {
    const v = picked?.fields[k];
    return v === null || v === undefined || String(v).trim() === "" ? undefined : v;
  };

  /**
   * 에이전트가 짐작한 값. 없으면 undefined.
   *
   * `url` 은 여기서 늘 없다 — `AGENT_KEYS` 를 보라. 주소는 등록기관이 준 것만 받는다.
   */
  const guessAt = (k: SuggestKey): string | number | undefined => {
    if (!guess) return undefined;
    // 목록에 없는 칸은 없는 것으로 둔다. 서버도 허용목록으로 거르지만, 화면이
    // 그걸 믿고 아무 키나 꺼내 쓰면 목록을 넓힐 때 여기가 조용히 따라 넓어진다.
    const key: AgentKey | undefined = AGENT_KEYS.find((a) => a === k);
    if (!key) return undefined;
    const v = guess[key];
    return v === null || v === undefined || String(v).trim() === "" ? undefined : v;
  };

  /**
   * 그 칸에 회색으로 비쳐 보일 값과 그 **출처**.
   *
   * 등록기관이 먼저다. 정확한 것이 있는데 추측을 보여 줄 이유가 없다.
   */
  const ghostAt = (k: SuggestKey): { value: string; origin: Origin } | null => {
    if (!isBlank(k)) return null;
    const found = foundAt(k);
    if (found !== undefined) return { value: String(found), origin: "lookup" };
    const g = guessAt(k);
    if (g !== undefined) return { value: String(g), origin: "agent" };
    return null;
  };

  /**
   * 한 칸에 값을 넣는다.
   *
   * 찾아온 값이면 **csl 원본도 함께 붙인다.** 원본은 마지막으로 무언가를 가져온
   * 후보의 것이 된다. 두 후보에서 한 칸씩 집어 오면 원본과 우리 칸이 어긋날 수
   * 있는데, 그래도 원본을 안 붙이는 것보다 낫다 — 내보낼 때 `toCSL` 이 사람이
   * 고친 우리 칸을 위에 덮기 때문에, 어긋난 자리는 사람이 보고 있는 값으로
   * 정리된다.
   *
   * **추측에는 원본을 붙이지 않는다.** 뒤에 원본이 없는 값이 원본이 있는 척하면
   * BibTeX 내보내기가 근거 없는 레코드를 낸다.
   */
  const applyOne = (k: SuggestKey, origin: Origin) => {
    if (origin === "lookup") {
      if (!picked) return;
      const v = foundAt(k);
      if (v === undefined) return;
      setFields((f) => ({ ...f, [k]: v, csl: JSON.stringify(picked.csl) }) as Fields);
      return;
    }
    const v = guessAt(k);
    if (v === undefined) return;
    setFields((f) => ({ ...f, [k]: v }) as Fields);
  };

  /**
   * 빈 칸에 제안을 채워 넣은 것을 돌려준다. **이미 적힌 칸은 건드리지 않는다.**
   *
   * "전부 적용" 과 저장이 **같은 함수를 쓴다.** 회색으로 보이던 값이 저장하면
   * 사라지는 일이 없어야 하는데, 규칙을 두 벌로 적어 두면 한쪽만 고치는 날이 온다.
   *
   * 두 출처의 순서도 여기 한 곳에만 적혀 있다 — **등록기관이 먼저, 추측이 나중.**
   * 화면이 회색으로 보여 주는 것(`ghostAt`)과 같은 순서라, 보이는 것과 저장되는
   * 것이 갈라지지 않는다.
   *
   * `usedGuess` 는 추측이 실제로 한 칸이라도 쓰였는가다. 그때만 "적용했다" 는
   * 표시를 남긴다 — 켜 두고 아무것도 안 쓴 것까지 적용으로 세면 기록이 거짓말을
   * 한다.
   */
  const mergeSuggestions = (f: Fields): { next: Fields; usedGuess: boolean } => {
    const next: Record<string, unknown> = { ...f };
    if (picked) next.csl = JSON.stringify(picked.csl);
    let usedGuess = false;

    for (const k of SUGGEST_KEYS) {
      const cur = f[k];
      if (cur !== null && cur !== undefined && String(cur).trim() !== "") continue;
      const found = foundAt(k);
      if (found !== undefined) {
        next[k] = found;
        continue;
      }
      const g = guessAt(k);
      if (g !== undefined) {
        next[k] = g;
        usedGuess = true;
      }
    }
    return { next: next as Fields, usedGuess };
  };

  const withSuggestions = (f: Fields): Fields => mergeSuggestions(f).next;

  /** 머리의 "전부 적용". */
  const applyAll = () => setFields(withSuggestions);

  /** 빈 칸이면 제안을 회색 글씨(플레이스홀더)로 미리 보여 준다. */
  const ph = (k: SuggestKey, fallback: string): string => ghostAt(k)?.value ?? fallback;

  /**
   * 칸 밑에 붙는 적용 줄. 이미 같은 값이면 아무것도 안 띄운다.
   *
   * **등록기관이 그 칸을 들고 있으면 추측은 아예 안 보여 준다.** 둘을 나란히
   * 늘어놓으면 사람이 둘 중 하나를 고르는 일이 생기는데, 그 일을 없애려고
   * 찾아오기를 먼저 돌린 것이다. 어긋난 것이 있으면 에이전트 상자의
   * `mismatch` 한 줄이 대신 말해 준다.
   */
  const sug = (k: SuggestKey) => {
    const cur = String(fields[k] ?? "").trim();
    const found = foundAt(k);
    if (found !== undefined) {
      if (String(found).trim() === cur) return null;
      return (
        <SuggestRow
          origin="lookup"
          sourceLabel={picked ? SOURCE_LABEL[picked.source] : "등록기관"}
          blank={isBlank(k)}
          value={String(found)}
          onApply={() => applyOne(k, "lookup")}
        />
      );
    }
    const g = guessAt(k);
    if (g === undefined || String(g).trim() === cur) return null;
    return (
      <SuggestRow
        origin="agent"
        sourceLabel="에이전트 추측"
        blank={isBlank(k)}
        value={String(g)}
        onApply={() => applyOne(k, "agent")}
      />
    );
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      /*
       * 회색으로 보이던 제안을 그대로 저장한다.
       *
       * 예전에는 "전부 적용" 을 눌러야만 들어갔다. 화면에는 값이 보이는데
       * 저장하면 빈 칸이 되는 셈이라, 눌렀는지 안 눌렀는지를 사람이 기억해야
       * 했다. 보이는 것이 저장되는 것과 같아야 한다.
       *
       * 이미 적어 둔 칸은 여전히 안 덮는다 — 그건 사람이 고른 값이다.
       */
      const merged = mergeSuggestions(fields);
      await onSubmit(groupId, merged.next);
      /*
       * 저장이 끝난 **뒤에** "적용했다" 를 표시한다.
       *
       * 순서가 반대면 저장이 실패했는데 제안만 적용됨으로 남는다. 이 표시가
       * 논문을 바꾸지 않는다는 것도 그 순서를 지켜야 사실이 된다. 실패해도
       * 되받지 않는 것은, 표시가 안 남는 것보다 저장이 성공한 것이 훨씬
       * 중요하기 때문이다.
       */
      if (merged.usedGuess && guessId && paperId) {
        void api.biblio.markApplied(paperId, guessId).catch(() => undefined);
      }
      onClose();
    } catch {
      // 실패하면 시트를 닫지 않는다. 닫아 버리면 적어 둔 저자와 초록이
      // 통째로 사라지고, 다시 적으라고 할 수도 없다.
    } finally {
      setBusy(false);
    }
  };

  const registering = target.mode === "create" || target.fresh;
  const file = target.paper?.file ?? null;
  const cover = file ? coverUrl(file) : null;

  return (
    <div className="fixed inset-0 z-[70] flex justify-end">
      {/* 뒤를 눌러 닫는다. */}
      <button
        type="button"
        aria-label="닫기"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />

      <section
        role="dialog"
        aria-modal="true"
        aria-label={registering ? "논문 등록" : "서지정보 편집"}
        className="scrollbar-thin relative flex h-full w-[min(520px,100vw)] flex-col overflow-y-auto bg-(--color-surface) shadow-2xl ring-1 ring-(--color-border)"
        onKeyDown={(e) => {
          // 긴 초록을 적다가 Enter 로 저장되면 안 되므로 Ctrl+Enter 로만 확정한다.
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") void submit();
        }}
      >
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-(--color-border-soft) bg-(--color-surface) px-5 py-4">
          <h2 className="text-base font-medium text-(--color-fg)">
            {registering ? "논문 등록" : "서지정보 편집"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="grid h-7 w-7 place-items-center rounded-md text-(--color-fg-4) hover:bg-(--color-surface-hi) hover:text-(--color-fg-2)"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex flex-col gap-4 px-5 py-5">
          {/* 붙은 파일 */}
          {file && (
            <div className="flex items-center gap-3 rounded-lg bg-(--color-bg-2) p-3 ring-1 ring-(--color-border-soft)">
              <div className="thumb-checker grid h-[58px] w-[41px] shrink-0 place-items-center overflow-hidden rounded ring-1 ring-(--color-border-soft)">
                {cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={cover} alt="" className="h-full w-full object-cover" />
                ) : (
                  <FileText className="h-4 w-4 text-(--color-fg-4)" />
                )}
              </div>
              <div className="min-w-0">
                <div className="truncate text-xs text-(--color-fg-2)" title={file.name}>
                  {file.name}
                </div>
                <div className="font-mono text-[10.5px] text-(--color-fg-4)">
                  {formatBytes(file.size)}
                </div>
              </div>
            </div>
          )}

          <Field
            label="제목"
            required
            suggestion={sug("title")}
            origin={ghostAt("title")?.origin ?? null}
          >
            <input
              ref={titleRef}
              value={fields.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder={ph("title", "논문 제목")}
              className={INPUT}
            />
          </Field>

          <Field
            label="저자"
            hint="사람이 읽는 한 줄로 적습니다. 쉼표로 나누면 보기 좋습니다"
            suggestion={sug("authors")} origin={ghostAt("authors")?.origin ?? null}
          >
            <input
              value={fields.authors ?? ""}
              onChange={(e) => set("authors", e.target.value || null)}
              placeholder={ph("authors", "Vaswani, Shazeer, Parmar…")}
              className={INPUT}
            />
          </Field>

          <div className="grid grid-cols-[1fr_110px] gap-3">
            <Field
              label="학회 · 저널"
              suggestion={sug("venue")}
              origin={ghostAt("venue")?.origin ?? null}
            >
              <input
                value={fields.venue ?? ""}
                onChange={(e) => set("venue", e.target.value || null)}
                placeholder={ph("venue", "NeurIPS")}
                className={INPUT}
              />
            </Field>
            <Field
              label="연도"
              suggestion={sug("year")}
              origin={ghostAt("year")?.origin ?? null}
            >
              <input
                value={fields.year ?? ""}
                inputMode="numeric"
                onChange={(e) => {
                  // 서버가 1000~3000 만 받는다. 네 자리로 잘라 두면 "20177"
                  // 같은 오타가 저장 단계까지 가지 않는다.
                  const raw = e.target.value.replace(/[^0-9]/g, "").slice(0, 4);
                  set("year", raw ? Number(raw) : null);
                }}
                placeholder={ph("year", "2017")}
                className={INPUT}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="DOI" suggestion={sug("doi")} origin={ghostAt("doi")?.origin ?? null}>
              <input
                value={fields.doi ?? ""}
                onChange={(e) => set("doi", e.target.value.trim() || null)}
                placeholder={ph("doi", "10.1145/3292500")}
                className={INPUT}
              />
            </Field>
            <Field
              label="arXiv"
              suggestion={sug("arxivId")}
              origin={ghostAt("arxivId")?.origin ?? null}
            >
              <input
                value={fields.arxivId ?? ""}
                onChange={(e) => set("arxivId", e.target.value.trim() || null)}
                placeholder={ph("arxivId", "1706.03762")}
                className={INPUT}
              />
            </Field>
          </div>

          {/*
            찾아오기.
            DOI·arXiv 칸 바로 밑에 둔다 — 그 두 칸이 이 단추의 재료이고,
            누른 결과가 바로 위 칸들로 흘러 들어가는 것이 눈에 보여야 한다.
          */}
          <div className="flex flex-col gap-2.5 rounded-lg bg-(--color-bg-2) px-3 py-3 ring-1 ring-(--color-border-soft)">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void runLookup()}
                disabled={lookupBusy || !canLookup}
                className="flex shrink-0 items-center gap-1.5 rounded-full bg-(--color-surface-hi) px-3 py-1.5 text-xs font-medium text-(--color-fg-2) ring-1 ring-(--color-border-soft) transition hover:bg-(--color-surface) disabled:opacity-40"
              >
                {lookupBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Search className="h-3.5 w-3.5" />
                )}
                찾아오기
              </button>
              <p className="min-w-0 flex-1 text-[10.5px] leading-snug break-keep text-(--color-fg-4)">
                DOI → arXiv → 제목 차례로 바깥에서 찾습니다.
              </p>
              {(picked || guess) && (
                <button
                  type="button"
                  onClick={applyAll}
                  className="flex shrink-0 items-center gap-1 rounded-full bg-(--color-accent)/15 px-2.5 py-1 text-[11px] font-medium text-(--color-accent) transition hover:bg-(--color-accent)/25"
                >
                  <Check className="h-3 w-3" />
                  전부 적용
                </button>
              )}
            </div>

            {/*
              후보가 여럿일 때는 **우리가 고르지 않는다.**
              제목 검색은 1등이 맞다는 보장이 없고, 틀린 것을 조용히 채워 넣으면
              사람은 그게 자기가 적은 값인 줄 안다.
            */}
            {report && report.candidates.length > 1 && (
              <div className="flex flex-col gap-1.5">
                <div className="text-[10.5px] break-keep text-(--color-fg-4)">
                  후보 {report.candidates.length}개 — 맞는 것을 고르세요
                  {/* 에이전트가 이 선택을 기다리고 있다는 것을 그 자리에서 말한다.
                      아래 상자에만 적어 두면 왜 멈춰 있는지 보이지 않는다. */}
                  {pendingPick && " (고르면 남은 빈 칸을 에이전트가 이어서 채웁니다)"}
                </div>
                {report.candidates.map((c, i) => (
                  <button
                    key={`${c.fields.doi ?? c.fields.title ?? i}`}
                    type="button"
                    onClick={() => pick(c)}
                    aria-pressed={picked === c}
                    className={cn(
                      "flex flex-col gap-0.5 rounded-md px-2.5 py-2 text-left ring-1 transition",
                      picked === c
                        ? "bg-(--color-accent)/10 ring-(--color-accent)/50"
                        : "bg-(--color-surface) ring-(--color-border-soft) hover:bg-(--color-surface-hi)",
                    )}
                  >
                    <span className="line-clamp-2 text-[11.5px] leading-snug text-(--color-fg-2)">
                      {c.fields.title ?? "제목 없음"}
                    </span>
                    <span className="truncate text-[10.5px] text-(--color-fg-4)">
                      {[c.fields.authors, c.fields.venue, c.fields.year]
                        .filter(Boolean)
                        .join(" · ") || SOURCE_LABEL[c.source]}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {picked && (
              <p className="text-[10.5px] leading-snug break-keep text-(--color-fg-4)">
                빈 칸에 회색으로 미리 들어가 있습니다. 이미 적어 둔 칸은 그대로 두고,
                덮으려면 그 칸의 단추를 누르세요. 적용하면 받아 온 <b>원본</b>도 함께
                저장되어 BibTeX 내보내기가 온전해집니다.
              </p>
            )}

            {/*
              어디서 넘어졌는지 그대로 보여 준다.
              "찾지 못했습니다" 한 줄이면 DOI 를 잘못 적은 것인지, 저쪽이 느려
              끊긴 것인지, 등록기관이 CSL 을 안 주는 것인지 알 수가 없다.
            */}
            {(report?.steps.length || lookupError) && (
              <ul className="flex flex-col gap-0.5">
                {report?.steps.map((s, i) => (
                  <li
                    key={`${s.source}-${i}`}
                    className={cn(
                      "text-[10.5px] leading-snug break-keep",
                      s.ok ? "text-(--color-fg-4)" : "text-(--color-warn)",
                    )}
                  >
                    {SOURCE_LABEL[s.source]} · {s.note}
                  </li>
                ))}
                {lookupError && (
                  <li className="text-[10.5px] leading-snug break-keep text-(--color-danger)">
                    {lookupError}
                  </li>
                )}
              </ul>
            )}
          </div>

          {dups.length > 0 && (
            <div className="flex flex-col gap-1 rounded-lg bg-(--color-warn)/10 px-3 py-2.5 ring-1 ring-(--color-warn)/40">
              <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-(--color-warn)">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                같은 번호의 논문이 이미 있습니다
              </div>
              {dups.map((d) => (
                <Link
                  key={d.id}
                  href={paperUrl(d.id)}
                  className="truncate pl-5 text-[11.5px] text-(--color-fg-3) underline decoration-dotted hover:text-(--color-fg)"
                  title={d.title}
                >
                  {d.title}
                </Link>
              ))}
              <p className="pl-5 text-[10.5px] text-(--color-fg-4)">
                그래도 등록할 수 있습니다 — 같은 논문을 여러 서가에 둘 수 있습니다.
              </p>
            </div>
          )}

          <Field
            label="원문 주소"
            suggestion={sug("url")}
            origin={ghostAt("url")?.origin ?? null}
          >
            <input
              value={fields.url ?? ""}
              onChange={(e) => set("url", e.target.value.trim() || null)}
              placeholder={ph("url", "https://arxiv.org/abs/1706.03762")}
              className={INPUT}
            />
          </Field>

          <Field label="태그" hint="쉼표로 나눕니다">
            <input
              value={fields.tags ?? ""}
              onChange={(e) => set("tags", e.target.value || null)}
              placeholder="transformer, attention"
              className={INPUT}
            />
          </Field>

          <Field
            label="초록"
            suggestion={sug("abstract")}
            origin={ghostAt("abstract")?.origin ?? null}
          >
            <textarea
              value={fields.abstract ?? ""}
              onChange={(e) => set("abstract", e.target.value || null)}
              rows={5}
              placeholder={ph("abstract", "붙여 넣어 두면 나중에 찾기 쉽습니다")}
              className={cn(INPUT, "scrollbar-thin resize-y leading-relaxed")}
            />
          </Field>

          <Field label="꽂을 자리">
            <select
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              className={INPUT}
            >
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.depth === 1 ? `  └ ${o.label}` : o.label}
                </option>
              ))}
            </select>
          </Field>

          {/*
            에이전트에게 남은 빈 칸을 맡기는 자리.

            찾아오기 상자 **아래**에 둔다. 도는 순서가 그렇기 때문이다 —
            바깥에서 찾아온 것이 먼저 위 칸들에 앉고, 거기서 안 채워진 것만
            여기로 내려온다. 위아래를 바꾸면 화면이 순서를 거꾸로 말한다.
          */}
          <div
            className={cn(
              "flex flex-col gap-2 rounded-lg bg-(--color-bg-2) px-3 py-3 ring-1 ring-(--color-border-soft)",
              !agent?.ready && "opacity-70",
            )}
          >
            <div className="flex items-start gap-3">
              <Sparkles
                className={cn(
                  "mt-0.5 h-4 w-4 shrink-0",
                  agentOn ? "text-(--color-accent-strong)" : "text-(--color-fg-4)",
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="text-xs text-(--color-fg-3)">에이전트가 서지정보 채우기</div>
                <p className="mt-0.5 text-[10.5px] break-keep text-(--color-fg-4)">
                  먼저 바깥에서 찾아오고, 거기서 못 채운 칸만 PDF 앞부분을 읽어
                  짐작합니다. 짐작한 값은 <b className="text-(--color-fg-3)">점선</b>으로
                  따로 표시됩니다.
                </p>
              </div>
              <input
                type="checkbox"
                checked={agentOn}
                disabled={!agent?.ready}
                onChange={(e) => toggleAgent(e.target.checked)}
                aria-label="에이전트가 서지정보 채우기"
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-(--color-border) bg-(--color-bg-2) disabled:cursor-not-allowed"
              />
            </div>

            {/*
              못 쓰는 이유를 그 자리에 적는다.
              꺼진 토글만 있으면 사람은 자기가 뭘 잘못한 줄 안다.
            */}
            {agent && !agent.ready && agent.reason && (
              <p className="text-[10.5px] leading-snug break-keep text-(--color-fg-4)">
                {agent.reason}
              </p>
            )}

            {/* 어느 단계에 있는지 말한다. 둘은 걸리는 시간도 원인도 다르다. */}
            {agentBusy && (
              <p className="flex items-center gap-1.5 text-[10.5px] text-(--color-fg-4)">
                <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                {agentBusy === "lookup"
                  ? "먼저 바깥에서 서지정보를 찾는 중"
                  : "PDF 앞부분을 읽는 중 (1분 넘게 걸릴 수 있습니다)"}
              </p>
            )}

            {pendingPick && !agentBusy && (
              <p className="text-[10.5px] leading-snug break-keep text-(--color-warn)">
                후보가 여럿이라 멈춰 있습니다. 위에서 맞는 것을 고르면 그것을 단서로
                남은 빈 칸을 채웁니다.
              </p>
            )}

            {agentError && (
              <p className="flex items-start gap-1.5 text-[10.5px] leading-snug break-keep text-(--color-danger)">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                <span className="min-w-0">{agentError}</span>
              </p>
            )}

            {/*
              어긋난 자리는 **고치지 않고 알려만 준다.**
              등록기관과 논문이 다르게 말할 때 어느 쪽이 맞는지는 사람이 정한다.
            */}
            {guess?.mismatch && (
              <p className="flex items-start gap-1.5 text-[10.5px] leading-snug break-keep text-(--color-warn)">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                <span className="min-w-0">찾아온 값과 논문이 어긋납니다 — {guess.mismatch}</span>
              </p>
            )}

            {guess && !agentBusy && (
              <p className="text-[10.5px] leading-snug break-keep text-(--color-fg-4)">
                추측한 값에는 받아 온 원본이 없습니다. 저장할 때 빈 칸에만 들어가고,
                이미 적어 둔 칸은 그대로 둡니다.
              </p>
            )}
          </div>
        </div>

        <footer className="sticky bottom-0 mt-auto flex items-center justify-end gap-2 border-t border-(--color-border-soft) bg-(--color-surface) px-5 py-4">
          <span className="mr-auto text-[10.5px] text-(--color-fg-4)">Ctrl+Enter 로 저장</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-(--color-bg-2) px-4 py-2 text-sm text-(--color-fg-3) ring-1 ring-(--color-border-soft) transition hover:bg-(--color-surface-hi)"
          >
            {/* 방금 올린 것은 이미 서재에 있다. "취소" 라고 하면 올린 것이
                없던 일이 되는 줄 안다. */}
            {target.fresh ? "나중에" : "취소"}
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            className="flex items-center gap-2 rounded-full bg-(--color-accent) px-5 py-2 text-sm font-medium text-(--color-bg) transition hover:bg-(--color-accent-strong) disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {registering ? "서재에 꽂기" : "저장"}
          </button>
        </footer>
      </section>
    </div>
  );
}

const INPUT =
  "w-full rounded-lg bg-(--color-bg-2) px-3 py-2 text-sm text-(--color-fg) ring-1 ring-(--color-border-soft) outline-none placeholder:text-(--color-fg-4) focus:ring-(--color-accent)/60";

/**
 * 이름표와 칸 한 벌.
 *
 * 바깥이 `<label>` 이 아니라 `<div>` 인 것은 제안 단추 때문이다. `<label>` 안의
 * 단추를 누르면 브라우저가 딸린 칸까지 함께 눌러(포커스) 버려서, "적용" 을 눌렀는데
 * 커서가 엉뚱한 칸으로 뛰는 일이 생긴다. 그래서 이름표와 칸만 `<label>` 로 묶고
 * 제안 줄은 그 바깥에 둔다.
 */
function Field({
  label,
  hint,
  required,
  suggestion,
  origin,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  /** 찾아온 값을 이 칸에 넣는 줄. 제안이 없으면 null. */
  suggestion?: React.ReactNode;
  /**
   * 지금 칸 안에 회색으로 비쳐 보이는 값이 어디서 왔는가.
   *
   * 이름표 옆에 작은 딱지로 붙는다. 회색 글씨 자체는 두 출처가 똑같이 보이는데
   * (플레이스홀더는 색을 나눌 자리가 없다), 그 값이 등록기관에서 온 것인지
   * 모델의 추측인지는 **저장하기 전에** 알아야 한다.
   */
  origin?: Origin | null;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label className="flex flex-col gap-1.5">
        <span className="flex items-center gap-1.5 text-[11px] font-medium tracking-wider text-(--color-fg-4) uppercase">
          {label}
          {required && <span className="text-(--color-accent)">*</span>}
          {origin && <OriginBadge origin={origin} />}
        </span>
        {children}
      </label>
      {hint && <span className="text-[10.5px] break-keep text-(--color-fg-4)">{hint}</span>}
      {suggestion}
    </div>
  );
}

/**
 * 출처 딱지.
 *
 * 등록기관 쪽은 강조색으로 꽉 찬 딱지, 추측은 **점선 테두리**다. 색만으로
 * 가르지 않는 것은 색을 못 가리는 눈이 있어서이고, 점선을 고른 것은 "아직
 * 확정되지 않은 것" 이라는 뜻이 모양 자체에 담기기 때문이다.
 */
function OriginBadge({ origin }: { origin: Origin }) {
  return origin === "lookup" ? (
    <span className="rounded-full bg-(--color-accent)/15 px-1.5 py-px text-[9px] font-medium tracking-normal text-(--color-accent) normal-case">
      등록기관
    </span>
  ) : (
    <span className="flex items-center gap-0.5 rounded-full border border-dashed border-(--color-fg-4)/60 px-1.5 py-px text-[9px] font-medium tracking-normal text-(--color-fg-4) normal-case">
      <Sparkles className="h-2 w-2" />
      추측
    </span>
  );
}

/**
 * 제안 값을 이 칸에 넣는 줄.
 *
 * 빈 칸이면 값이 이미 회색 글씨로 칸 안에 보이므로 단추만 있으면 된다.
 * **사람이 적어 둔 칸은 다르다** — 무엇으로 바뀌는지 보여 주고, 단추 이름도
 * "덮어쓰기" 로 말한다. 적어 둔 것이 소리 없이 사라지는 것이 가장 나쁘다.
 *
 * 출처를 말머리로 단다. "찾아온 값" 과 "에이전트 추측" 이 같은 문장으로 뜨면
 * 둘 다 어디선가 확인된 값처럼 읽히는데, 한쪽은 모델이 지은 것이다.
 * 추측 줄은 단추까지 점선으로 눌러 둔다 — 눈에 먼저 들어오는 쪽은 정확한
 * 쪽이어야 한다.
 */
function SuggestRow({
  origin,
  sourceLabel,
  blank,
  value,
  onApply,
}: {
  origin: Origin;
  /** 어디서 왔는지 사람이 읽는 이름. "DOI", "제목 검색", "에이전트 추측". */
  sourceLabel: string;
  blank: boolean;
  value: string;
  onApply: () => void;
}) {
  const guessed = origin === "agent";
  return (
    <div className="flex items-start gap-2">
      <p className="min-w-0 flex-1 text-[10.5px] leading-snug text-(--color-fg-4)">
        {blank ? (
          <span>
            <span className={cn(guessed && "text-(--color-fg-3)")}>{sourceLabel}</span>
            {guessed ? " 값이 회색으로 들어 있습니다" : " 에서 받은 값이 회색으로 들어 있습니다"}
          </span>
        ) : (
          <span className="line-clamp-2 break-all">
            {sourceLabel}: <span className="text-(--color-fg-3)">{value}</span>
          </span>
        )}
      </p>
      <button
        type="button"
        onClick={onApply}
        className={cn(
          "shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium transition",
          guessed
            ? "border border-dashed border-(--color-fg-4)/60 text-(--color-fg-3) hover:bg-(--color-surface-hi)"
            : blank
              ? "bg-(--color-accent)/15 text-(--color-accent) hover:bg-(--color-accent)/25"
              : "bg-(--color-warn)/15 text-(--color-warn) hover:bg-(--color-warn)/25",
        )}
      >
        {blank ? "적용" : "덮어쓰기"}
      </button>
    </div>
  );
}

export type { Fields as PaperSheetFields };
