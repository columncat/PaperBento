"use client";

import { AlertTriangle, FileText, Loader2, RotateCcw, Search, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { api, type BiblioGuess, type PaperInput } from "@/lib/client-api";
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

import {
  askAgent,
  clueOf,
  fillOne,
  lookupable,
  type BiblioPrefill,
} from "./biblio-batch";

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
 * ## 값은 두 곳에서 온다 — 그리고 순서가 있다
 *
 * 1. **찾아오기** — doi.org·arXiv·Crossref 가 준 값. 정확한 것이다.
 * 2. **에이전트** — 모델이 PDF 앞부분을 읽고 짐작한 값. 추측이다.
 *
 * 늘 1이 먼저 돌고, 찾은 것을 **단서로 넘겨** 2가 남은 칸을 메운다. 순서를
 * 뒤집으면 같은 칸에 두 값이 서로 다르게 앉고, 그때부터는 어느 쪽이 맞는지
 * 사람이 가려야 한다. 넘기지 않아도 될 일을 넘기는 것이다. 차례 자체는
 * `biblio-batch.tsx` 의 `fillOne` 에 있다 — 시트도 배치도 그것을 부른다.
 *
 * 그래서 **화면에서도 둘이 같아 보이면 안 된다.** 이름표 옆 딱지(`OriginBadge`)가
 * 그 칸의 값이 어디서 왔는지 말하고, 추측 쪽은 점선으로 눌러 그린다.
 *
 * ## 채우기는 **단추 하나**이고, 누르면 **덮어쓴다**
 *
 * 예전에는 체크박스였고 빈 칸만 채웠다. 지금은 시트 제일 위의 단추다. 누르면
 * 적어 둔 값이 있어도 덮는다 — "채워 달라" 고 누른 사람에게 "몇 칸은 안 채웠다"
 * 를 돌려주는 것이 더 나쁘고, 어느 칸이 덮였는지는 딱지와 **되돌리기** 한 번으로
 * 되짚을 수 있기 때문이다.
 *
 * 열 때 저절로 도는 것은 **없다.** 단추가 방아쇠인데 저절로 도는 길이 남아
 * 있으면, 서지정보를 손으로 고치려고 시트를 연 사람의 값이 소리 없이 덮인다.
 *
 * 그리고 값이 앉는 곳은 **칸(React 상태)뿐이다.** 논문이 바뀌는 것은 사람이
 * 저장을 누른 그 한 번이다 (`onSubmit`). 그래서 덮어쓴 뒤에도 고치거나 그냥
 * 닫아 버릴 수 있다.
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
  /**
   * 배치가 미리 돌아 둔 결과. 있으면 **열자마자 칸에 앉힌다.**
   *
   * 저절로 덮는 유일한 자리인데, 그래도 되는 이유는 사람이 이미 "N편 모두
   * 채워라" 를 눌렀기 때문이다. 그 동의가 이 값에 실려 온다. 되돌리기와 출처
   * 딱지는 여기서도 똑같이 붙는다.
   */
  prefill?: BiblioPrefill;
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
/** 어느 칸이 이번 채우기로 앉았고 어디서 왔는가. */
type Marks = Partial<Record<SuggestKey, Origin>>;

/** 비어 있는 값인가. 제안 쪽에만 쓴다 — **칸이 비었는지는 이제 묻지 않는다.** */
function blank(v: unknown): boolean {
  return v === null || v === undefined || String(v).trim() === "";
}

/**
 * 찾아온 후보를 칸에 눕힌다. **적혀 있던 값은 덮는다.**
 *
 * `csl` 원본을 함께 싣는 것은 이 후보에서 온 칸들과 한 대입에서 세우기
 * 위해서다 — 한 후보의 값과 다른 후보의 원본이 섞이면 BibTeX 내보내기가
 * 어긋난 레코드를 낸다.
 */
function foundPatch(c: LookupResult): { patch: Partial<Fields>; marks: Marks } {
  const patch: Record<string, unknown> = { csl: JSON.stringify(c.csl) };
  const marks: Marks = {};
  for (const k of SUGGEST_KEYS) {
    const v = c.fields[k];
    // 후보가 안 들고 있는 칸까지 빈 값으로 덮지는 않는다. 그건 "찾아온 값" 이
    // 아니라 "찾아온 것이 없다" 이고, 사람이 적어 둔 값을 지울 이유가 없다.
    if (blank(v)) continue;
    patch[k] = v;
    marks[k] = "lookup";
  }
  return { patch: patch as Partial<Fields>, marks };
}

/**
 * 에이전트 추측을 칸에 눕힌다.
 *
 * **등록기관이 든 칸은 건드리지 않는다.** 정확한 것이 있는데 추측으로 덮으면
 * 찾아오기를 먼저 돌린 이유가 없어진다.
 *
 * **`csl` 은 붙이지 않는다** — 키를 아예 넣지 않는다(`null` 도 아니다). 원본
 * 없는 값이 원본이 있는 척하면 내보내기가 근거 없는 레코드를 내고, 여기서
 * `csl: null` 을 실으면 애써 받아 둔 원본을 저장 한 번으로 지운다.
 */
function guessPatch(
  g: BiblioGuess,
  from: LookupResult | null,
): { patch: Partial<Fields>; marks: Marks } {
  const patch: Record<string, unknown> = {};
  const marks: Marks = {};
  for (const k of AGENT_KEYS) {
    if (from && !blank(from.fields[k])) continue;
    const v = g[k];
    if (blank(v)) continue;
    patch[k] = v;
    marks[k] = "agent";
  }
  return { patch: patch as Partial<Fields>, marks };
}

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
  const [agentBusy, setAgentBusy] = useState<null | "lookup" | "agent">(null);
  const [pendingPick, setPendingPick] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [guess, setGuess] = useState<BiblioGuess | null>(null);
  const [guessId, setGuessId] = useState<string | null>(null);

  /*
   * 덮어쓰기의 뒷정리.
   *
   * `marks` 는 이번 채우기가 앉힌 칸과 그 출처다. 이름표 옆 딱지가 여기서 온다 —
   * 값이 회색 미리보기가 아니라 **진짜로 칸에 들어앉기 때문에**, 무엇이 내가 적은
   * 값이고 무엇이 방금 덮인 값인지는 화면이 말해 주지 않으면 알 길이 없다.
   *
   * `undoTo` 는 채우기가 시작되기 **직전의 한 벌**이다. 되돌리기는 한 걸음이면
   * 된다 — 칸마다 되돌리게 하면 그건 예전의 "칸마다 적용" 을 뒤집어 놓은 것일
   * 뿐이고, 사람이 원하는 것은 "방금 그거 취소" 하나다.
   *
   * `guessUsed` 는 추측이 실제로 한 칸이라도 앉았는가다. 그때만 저장 뒤에
   * "적용했다" 를 표시한다 — 안 쓴 것까지 적용으로 세면 기록이 거짓말을 한다.
   */
  const [marks, setMarks] = useState<Marks>({});
  const [undoTo, setUndoTo] = useState<Fields | null>(null);
  const [guessUsed, setGuessUsed] = useState(false);

  /**
   * 이 논문에 **이미 받아 둔 제안**이 있는가.
   *
   * 열 때 저절로 앉히지 않는다 — 덮어쓰기는 사람이 누른 뒤여야 한다. 다만
   * 있다는 것은 말해 주고, 누르면 에이전트를 다시 부르지 않고 그것을 쓴다.
   * 한 번 1분 넘게 기다린 것을 시트를 다시 열었다고 또 기다릴 이유가 없다.
   */
  const [stored, setStored] = useState<{ fields: BiblioGuess; id: string } | null>(null);

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

  /**
   * 여는 요청의 번호. **채우기 번호와 갈라 둔다.**
   *
   * 되돌리기는 돌고 있던 채우기를 버리려고 `runSeq` 를 올린다. 그 번호로 여는
   * 요청까지 재면, 열자마자 되돌리기를 누른 사람에게는 "부를 수 있는가" 의 답이
   * 영영 안 도착하고 단추가 꺼진 채로 남는다.
   */
  const openSeq = useRef(0);

  const paperId = target?.paper?.id ?? null;
  const hasPdf = Boolean(target?.paper?.file);

  // 열릴 때마다 값을 새로 심는다. 앞서 열었던 논문의 저자가 남아 있으면
  // 그걸 그대로 저장해 버리는 사고가 난다.
  useEffect(() => {
    if (!target) return;
    const base = fieldsOf(target);
    setGroupId(target.groupId);
    setDups([]);
    // 앞 논문의 것이 남아 있으면 남의 서지정보가 이 논문 칸에 앉는다.
    setAgent(null);
    setAgentBusy(null);
    setStored(null);

    const pre = target.prefill;
    if (!pre) {
      setFields(base);
      setReport(null);
      setPicked(null);
      setLookupError(null);
      setLookupBusy(false);
      setPendingPick(false);
      setAgentError(null);
      setGuess(null);
      setGuessId(null);
      setMarks({});
      setUndoTo(null);
      setGuessUsed(false);
    } else {
      /*
       * 배치가 미리 돌아 둔 것을 그대로 앉힌다.
       *
       * 앉히는 규칙은 단추를 눌렀을 때와 **같은 함수**다 — 두 벌로 적으면
       * 배치로 채운 것과 손으로 채운 것이 다르게 앉는 날이 온다.
       */
      let next: Fields = base;
      const m: Marks = {};
      if (pre.picked) {
        const r = foundPatch(pre.picked);
        next = { ...next, ...r.patch };
        Object.assign(m, r.marks);
      }
      let used = false;
      if (pre.guess) {
        const r = guessPatch(pre.guess, pre.picked);
        next = { ...next, ...r.patch };
        Object.assign(m, r.marks);
        used = Object.keys(r.marks).length > 0;
      }
      setFields(next);
      setMarks(m);
      // 되돌리기는 늘 **열었을 때의 값**으로 간다.
      setUndoTo(base);
      setGuessUsed(used);
      setReport(pre.report);
      setPicked(pre.picked);
      setLookupError(null);
      setLookupBusy(false);
      setPendingPick(Boolean(pre.pendingPick));
      setAgentError(pre.error ?? null);
      setGuess(pre.guess);
      setGuessId(pre.guessId);
    }

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

  // ── 채우기 ────────────────────────────────────────────────

  /**
   * 시트가 열릴 때 한 번. **부를 수 있는가**와 **받아 둔 제안이 있는가**를 묻는다.
   *
   * 예전에는 여기서 조건이 맞으면 저절로 돌았다. 지금은 안 돈다 — 채우기가
   * 단추가 된 뒤로는 열자마자 도는 길이 곧 "누르지도 않은 사람의 값이 덮인다"
   * 가 된다. 받아 둔 제안도 앉히지 않고, 있다는 것만 말한다.
   */
  useEffect(() => {
    if (!target) {
      // 닫히면 돌고 있던 것을 놓는다. 답이 늦게 와도 받을 화면이 없는데,
      // 번호를 안 올리면 폴링이 몇 분을 더 돈다.
      runSeq.current++;
      return;
    }
    // 앞 논문의 채우기가 돌고 있었다면 그 답은 버린다.
    runSeq.current++;
    const seq = ++openSeq.current;

    if (!paperId || !hasPdf) {
      // 읽을 PDF 가 없으면 에이전트가 할 일이 없다. 단추를 살려 두면 눌렀을 때
      // "글자를 뽑지 못했습니다" 만 나온다.
      setAgent({
        ready: false,
        reason: "PDF 가 붙은 논문에서만 됩니다. 파일을 올린 뒤에 누를 수 있습니다.",
      });
      return;
    }

    const prefilled = Boolean(target.prefill);
    void api.biblio
      .status(paperId)
      .then((state) => {
        if (openSeq.current !== seq) return;
        setAgent(state.agent);
        const done = state.suggestion;
        // 배치가 방금 실어 보낸 것이 이미 칸에 앉아 있으면 같은 것을 두 번
        // 말하지 않는다.
        if (!prefilled && done?.state === "done" && done.fields) {
          setStored({ fields: done.fields, id: done.id });
        }
      })
      .catch(() => {
        if (openSeq.current !== seq) return;
        // "서버가 안 된다고 했다" 와 "물어보지도 못했다" 는 다른 일이다.
        setAgent({ ready: false, reason: "에이전트를 부를 수 있는지 확인하지 못했습니다" });
      });
  }, [target, paperId, hasPdf]);

  if (!target) return null;

  const set = <K extends keyof Fields>(k: K, v: Fields[K]) => {
    setFields((f) => ({ ...f, [k]: v }));
    /*
     * 손댄 칸의 출처 딱지를 뗀다.
     *
     * 딱지는 "이 칸에 지금 앉아 있는 값이 어디서 왔는가" 다. 사람이 한 글자라도
     * 고치면 그 값은 더 이상 등록기관의 것도 모델의 것도 아니다. 남겨 두면
     * 자기가 적은 저자 이름에 "추측" 이 붙어 있게 된다.
     */
    setMarks((m) => {
      if (!(k in m)) return m;
      const next = { ...m };
      delete next[k as SuggestKey];
      return next;
    });
  };

  const canLookup = lookupable(fields);

  /**
   * 채우기 한 판의 시작.
   *
   * 하는 일은 **지금 값을 한 벌 붙드는 것**뿐이고, 이미 붙들어 둔 것이 있으면
   * 그대로 둔다. 되돌릴 자리는 **처음 열었을 때** 하나다 — 채우기를 두 번
   * 눌렀는데 한 걸음만 물러나면, 되돌리기가 사람이 본 적 없는 중간 상태로
   * 데려가는 단추가 된다. 단계별 되감기를 원하는 사람은 없다.
   */
  const beginRun = () => setUndoTo((prev) => prev ?? fields);

  /** 찾아온 후보를 칸에 앉힌다. **적어 둔 값도 덮는다.** */
  const applyFound = (c: LookupResult) => {
    const { patch, marks: m } = foundPatch(c);
    setPicked(c);
    setFields((f) => ({ ...f, ...patch }));
    setMarks((prev) => ({ ...prev, ...m }));
  };

  /** 추측을 칸에 앉힌다. 등록기관이 든 칸은 건드리지 않는다. */
  const applyGuess = (g: BiblioGuess, from: LookupResult | null) => {
    const { patch, marks: m } = guessPatch(g, from);
    setFields((f) => ({ ...f, ...patch }));
    setMarks((prev) => ({ ...prev, ...m }));
    if (Object.keys(m).length > 0) setGuessUsed(true);
  };

  /**
   * 되돌리기.
   *
   * `csl` 까지 함께 돌아간다 — 붙들어 둔 한 벌에는 그 칸도 들어 있다(찾아오기
   * 전이라면 없는 상태 그대로). 값만 되돌리고 원본을 남기면 사람이 보고 있는
   * 칸과 내보내기가 갈라진다.
   */
  const undo = () => {
    if (!undoTo) return;
    // 아직 돌고 있는 것이 있으면 그 답도 버린다. 되돌린 칸에 1분 뒤 답이
    // 날아와 앉으면 그건 되돌린 것이 아니다.
    runSeq.current++;
    setFields(undoTo);
    setUndoTo(null);
    setMarks({});
    setGuessUsed(false);
    setAgentBusy(null);
    setPendingPick(false);
  };

  /** 머리의 "찾아오기" 단추. 손으로 누를 때는 에이전트까지 끌고 가지 않는다. */
  const runLookup = async () => {
    if (lookupBusy || !canLookup) return;
    setLookupBusy(true);
    setLookupError(null);
    setReport(null);
    setPicked(null);
    // 찾아온 값도 곧바로 칸에 앉으므로 이것 역시 되돌릴 수 있어야 한다.
    beginRun();
    try {
      const r = await api.lookup({
        doi: fields.doi,
        arxiv: fields.arxivId,
        title: fields.title,
      });
      setReport(r);
      // 후보가 하나뿐이면 고를 것이 없다. 바로 앉힌다.
      if (r.candidates.length === 1) applyFound(r.candidates[0]);
    } catch (e) {
      setLookupError(e instanceof Error ? e.message : "찾아오기에 실패했습니다");
    } finally {
      setLookupBusy(false);
    }
  };

  /**
   * 시트 제일 위의 단추 — **에이전트에게 채우게 하기.**
   *
   * 차례는 `fillOne` 이 들고 있다. 여기서 하는 일은 그 결과를 칸에 앉히고,
   * 어느 단계인지 화면에 말하는 것뿐이다.
   *
   * 후보가 여럿이면 `fillOne` 이 멈춰 서고 `pendingPick` 이 켜진다. 단추를
   * 눌렀다고 해서 우리가 하나를 고를 수 있게 되는 것은 아니다 — 틀린 논문의
   * 서지정보를 "확정된 값" 이라고 모델에게 알려 주게 된다. 고르면 `pick` 이
   * 그 자리에서 이어 돈다.
   */
  const fillAll = async () => {
    if (!paperId || agentBusy || !agent?.ready) return;
    const seq = ++runSeq.current;
    const base = fields;

    beginRun();
    // 이 판이 다시 세울 것들. 앞 판의 후보와 추측이 남아 있으면 화면이 이번
    // 결과와 지난 결과를 섞어 말한다.
    setReport(null);
    setPicked(null);
    setLookupError(null);
    setGuess(null);
    setGuessId(null);
    setGuessUsed(false);
    setStored(null);
    setAgentError(null);
    setPendingPick(false);
    setAgentBusy("lookup");

    const out = await fillOne(
      paperId,
      { title: base.title, doi: base.doi, arxivId: base.arxivId },
      {
        alive: () => runSeq.current === seq,
        onReport: (r) => setReport(r),
        onLookupError: (m) => setLookupError(m),
        // 찾아온 것은 기다리지 않고 그 자리에서 앉힌다. 에이전트가 1분을
        // 더 도는 동안 화면이 비어 있을 이유가 없다.
        onPicked: (c) => applyFound(c),
        onAgent: () => setAgentBusy("agent"),
      },
    );

    if (runSeq.current !== seq) return;
    setAgentBusy(null);
    if (out.kind === "aborted") return;
    if (out.kind === "picking") {
      setReport(out.report);
      setPendingPick(true);
      return;
    }
    if (out.kind === "failed") {
      setAgentError(out.error);
      return;
    }
    setGuess(out.guess);
    setGuessId(out.guessId);
    if (out.guess) applyGuess(out.guess, out.picked);
  };

  /**
   * 앞서 받아 둔 제안만 앉힌다. **에이전트를 다시 부르지 않는다.**
   *
   * 한 편에 1분이 넘는 일을 시트를 다시 열었다는 이유로 또 시킬 수는 없다.
   * 찾아오기를 여기서 같이 돌지 않는 것은, 그 제안이 그때 등록기관 값을
   * 단서로 받고 만들어진 것이라 등록기관이 든 칸은 애초에 비어 있기 때문이다.
   * 정확한 쪽이 필요하면 아래 "찾아오기" 를 누르면 된다.
   */
  const useStored = () => {
    if (!stored) return;
    beginRun();
    applyGuess(stored.fields, null);
    setGuess(stored.fields);
    setGuessId(stored.id);
    setStored(null);
  };

  /**
   * 후보를 고르면 그 값이 칸에 앉고, 멈춰 있던 에이전트가 그것을 단서로 이어 돈다.
   */
  const pick = (c: LookupResult) => {
    applyFound(c);
    if (!pendingPick || !paperId) return;
    const seq = ++runSeq.current;
    setPendingPick(false);
    setAgentError(null);
    setAgentBusy("agent");
    void (async () => {
      const out = await askAgent(paperId, clueOf(c), () => runSeq.current === seq);
      if (runSeq.current !== seq) return;
      setAgentBusy(null);
      if (out.kind === "aborted") return;
      if (out.kind === "failed") {
        setAgentError(out.error);
        return;
      }
      setGuess(out.guess);
      setGuessId(out.guessId);
      if (out.guess) applyGuess(out.guess, c);
    })();
  };

  /** 이번 채우기가 앉힌 칸들. 무엇이 덮였는지 한 줄로 말하는 데 쓴다. */
  const filled = SUGGEST_KEYS.filter((k) => marks[k]);
  const filledByLookup = filled.filter((k) => marks[k] === "lookup").length;
  const filledByGuess = filled.length - filledByLookup;

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      /*
       * **칸에 보이는 것을 그대로 저장한다.**
       *
       * 예전에는 여기서 회색 제안을 한 번 더 섞었다. 지금은 섞을 것이 없다 —
       * 채우기가 이미 칸에 앉혔고, 그 뒤에 사람이 고친 것이 있으면 그것이
       * 마지막 말이다. 보이는 것과 저장되는 것이 갈라질 자리가 없어졌다.
       *
       * **여기가 경계선이다.** 이 줄 위의 어떤 코드도 논문을 바꾸지 않는다.
       * 찾아오기도 에이전트도 배치도 전부 React 상태까지만 온다.
       */
      await onSubmit(groupId, fields);
      /*
       * 저장이 끝난 **뒤에** "적용했다" 를 표시한다.
       *
       * 순서가 반대면 저장이 실패했는데 제안만 적용됨으로 남는다. 이 표시가
       * 논문을 바꾸지 않는다는 것도 그 순서를 지켜야 사실이 된다. 실패해도
       * 되받지 않는 것은, 표시가 안 남는 것보다 저장이 성공한 것이 훨씬
       * 중요하기 때문이다.
       */
      if (guessUsed && guessId && paperId) {
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
          {/*
            에이전트에게 채우게 하는 단추. **시트 제일 위다.**

            예전에는 맨 아래 체크박스였고, 그 자리의 근거는 "찾아오기가 먼저 돌고
            거기서 안 채운 것만 여기로 내려온다" 는 순서였다. 도는 순서는 지금도
            같다. 다만 단추는 그 순서의 **끝**이 아니라 **방아쇠**다 — 이 화면에서
            가장 먼저 할 일이 되었으니 가장 먼저 보여야 한다.

            찾아오기 상자와 후보 고르기는 DOI·arXiv 칸 옆에 그대로 둔다. 그 두 칸이
            그쪽 단추의 재료이고, 후보를 고르는 일은 이 단추가 멈춰 선 자리에서
            사람이 이어 주는 것이라 값이 흘러 들어가는 칸 옆에 있어야 한다.
          */}
          <div
            className={cn(
              "flex flex-col gap-2 rounded-lg bg-(--color-bg-2) px-3 py-3 ring-1 ring-(--color-border-soft)",
              !agent?.ready && "opacity-70",
            )}
          >
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => void fillAll()}
                  disabled={!agent?.ready || Boolean(agentBusy)}
                  className="flex items-center gap-1.5 rounded-full bg-(--color-accent) px-3.5 py-1.5 text-xs font-medium text-(--color-bg) transition hover:bg-(--color-accent-strong) disabled:opacity-40"
                >
                  {agentBusy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  에이전트에게 채우게 하기
                </button>
                <p className="mt-1.5 text-[10.5px] leading-snug break-keep text-(--color-fg-4)">
                  먼저 바깥에서 찾아오고, 거기서 못 채운 칸만 PDF 앞부분을 읽어
                  짐작합니다. <b className="text-(--color-fg-3)">적어 둔 값도 덮습니다.</b>{" "}
                  논문이 바뀌는 것은 아래 <b className="text-(--color-fg-3)">저장</b>을
                  누른 뒤입니다.
                </p>
              </div>
              {/*
                되돌리기는 **채운 것이 있을 때만** 뜬다. 돌아갈 자리가 없는데
                단추가 서 있으면 그 자체가 거짓말이다.
              */}
              {filled.length > 0 && (
                <button
                  type="button"
                  onClick={undo}
                  className="flex shrink-0 items-center gap-1 rounded-full bg-(--color-surface-hi) px-2.5 py-1 text-[11px] font-medium text-(--color-fg-2) ring-1 ring-(--color-border-soft) transition hover:bg-(--color-surface)"
                >
                  <RotateCcw className="h-3 w-3" />
                  되돌리기
                </button>
              )}
            </div>

            {/*
              무엇이 덮였는지 세어 말한다. 칸마다 붙는 딱지는 "이 칸이 어디서
              왔는가" 만 말해서, 화면을 내려 보기 전에는 몇 칸이 바뀌었는지 모른다.
            */}
            {filled.length > 0 && !agentBusy && (
              <p className="text-[10.5px] leading-snug break-keep text-(--color-fg-3)">
                {filled.length}칸을 채웠습니다
                {filledByLookup > 0 && ` · 등록기관 ${filledByLookup}`}
                {filledByGuess > 0 && ` · 추측 ${filledByGuess}`} — 이름표 옆 딱지가
                칸마다 출처를 말합니다. 되돌리기는 몇 번을 눌렀든 <b>채우기 전의 값</b>으로
                한 번에 돌아갑니다.
              </p>
            )}

            {/*
              못 쓰는 이유를 그 자리에 적는다.
              꺼진 단추만 있으면 사람은 자기가 뭘 잘못한 줄 안다.
            */}
            {agent && !agent.ready && agent.reason && (
              <p className="text-[10.5px] leading-snug break-keep text-(--color-fg-4)">
                {agent.reason}
              </p>
            )}

            {/*
              받아 둔 제안. 있다는 것만 말하고 **앉히지는 않는다** — 덮어쓰기는
              사람이 누른 뒤여야 한다.
            */}
            {stored && !agentBusy && filled.length === 0 && (
              <div className="flex items-start gap-2">
                <p className="min-w-0 flex-1 text-[10.5px] leading-snug break-keep text-(--color-fg-4)">
                  앞서 에이전트가 내놓은 추측이 남아 있습니다. 이것을 쓰면 다시 부르지
                  않습니다.
                </p>
                <button
                  type="button"
                  onClick={useStored}
                  className="shrink-0 rounded-full border border-dashed border-(--color-fg-4)/60 px-2 py-0.5 text-[10.5px] font-medium text-(--color-fg-3) transition hover:bg-(--color-surface-hi)"
                >
                  받아 둔 값 쓰기
                </button>
              </div>
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
                후보가 여럿이라 멈춰 있습니다. 아래 DOI·arXiv 칸 밑에서 맞는 것을
                고르면 그 값이 칸에 앉고, 그것을 단서로 나머지를 이어서 채웁니다.
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

            {filledByGuess > 0 && !agentBusy && (
              <p className="text-[10.5px] leading-snug break-keep text-(--color-fg-4)">
                추측으로 채운 칸에는 받아 온 원본(CSL)이 없습니다. 저장하기 전에
                한 번 훑어보세요.
              </p>
            )}
          </div>

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

          <Field label="제목" required origin={marks.title ?? null}>
            <input
              ref={titleRef}
              value={fields.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="논문 제목"
              className={INPUT}
            />
          </Field>

          <Field
            label="저자"
            hint="사람이 읽는 한 줄로 적습니다. 쉼표로 나누면 보기 좋습니다"
            origin={marks.authors ?? null}
          >
            <input
              value={fields.authors ?? ""}
              onChange={(e) => set("authors", e.target.value || null)}
              placeholder="Vaswani, Shazeer, Parmar…"
              className={INPUT}
            />
          </Field>

          <div className="grid grid-cols-[1fr_110px] gap-3">
            <Field label="학회 · 저널" origin={marks.venue ?? null}>
              <input
                value={fields.venue ?? ""}
                onChange={(e) => set("venue", e.target.value || null)}
                placeholder="NeurIPS"
                className={INPUT}
              />
            </Field>
            <Field label="연도" origin={marks.year ?? null}>
              <input
                value={fields.year ?? ""}
                inputMode="numeric"
                onChange={(e) => {
                  // 서버가 1000~3000 만 받는다. 네 자리로 잘라 두면 "20177"
                  // 같은 오타가 저장 단계까지 가지 않는다.
                  const raw = e.target.value.replace(/[^0-9]/g, "").slice(0, 4);
                  set("year", raw ? Number(raw) : null);
                }}
                placeholder="2017"
                className={INPUT}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="DOI" origin={marks.doi ?? null}>
              <input
                value={fields.doi ?? ""}
                onChange={(e) => set("doi", e.target.value.trim() || null)}
                placeholder="10.1145/3292500"
                className={INPUT}
              />
            </Field>
            <Field label="arXiv" origin={marks.arxivId ?? null}>
              <input
                value={fields.arxivId ?? ""}
                onChange={(e) => set("arxivId", e.target.value.trim() || null)}
                placeholder="1706.03762"
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
                  {pendingPick && " (고르면 그 값이 칸에 앉고 나머지를 이어서 채웁니다)"}
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

            {/* 되돌린 뒤에는 "들어갔습니다" 가 거짓말이 된다. 칸에 남아 있을 때만 말한다. */}
            {picked && filledByLookup > 0 && (
              <p className="text-[10.5px] leading-snug break-keep text-(--color-fg-4)">
                찾아온 값이 위 칸에 들어갔습니다 — 적어 두었던 값은 덮였습니다. 받아 온{" "}
                <b>원본</b>도 함께 실려 BibTeX 내보내기가 온전해집니다. 되돌리려면 맨 위의
                되돌리기를 누르세요.
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

          <Field label="원문 주소" origin={marks.url ?? null}>
            <input
              value={fields.url ?? ""}
              onChange={(e) => set("url", e.target.value.trim() || null)}
              placeholder="https://arxiv.org/abs/1706.03762"
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

          <Field label="초록" origin={marks.abstract ?? null}>
            <textarea
              value={fields.abstract ?? ""}
              onChange={(e) => set("abstract", e.target.value || null)}
              rows={5}
              placeholder="붙여 넣어 두면 나중에 찾기 쉽습니다"
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
 * 이름표와 칸만 `<label>` 로 묶고 바깥은 `<div>` 다. 힌트까지 `<label>` 안에
 * 넣으면 그것을 누를 때도 칸에 포커스가 뛴다.
 */
function Field({
  label,
  hint,
  required,
  origin,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  /**
   * 이 칸에 지금 앉아 있는 값이 어디서 왔는가. 사람이 적은 값이면 null.
   *
   * 이름표 옆에 작은 딱지로 붙는다. 값이 **진짜로 칸에 들어앉기 때문에** 이것이
   * 없으면 내가 적은 값과 방금 덮인 값이 똑같아 보인다. 등록기관에서 온
   * 것인지 모델의 추측인지는 **저장하기 전에** 알아야 한다.
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

export type { Fields as PaperSheetFields };
