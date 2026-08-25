import { notFound } from "next/navigation";

import { PaperDetail } from "@/components/paper-detail";
import { getSummary, listGroups } from "@/lib/paper-server";
import type { PaperDTO } from "@/lib/types";

/**
 * 논문 한 편.
 *
 * 서재를 통째로 읽어 그 안에서 찾는다. 논문 하나만 뽑아 오는 길을
 * `paper-server.ts` 에 새로 내지 않은 이유가 두 가지다. 하나는 그 파일이
 * 이미 정해진 계약이라는 것, 다른 하나는 **어차피 전부 필요하다는 것** —
 * 서지정보 편집 시트의 "꽂을 자리" 고르기가 서가 목록을 통째로 요구한다.
 * 수천 편이 되어 이 읽기가 무거워지면 그때 목록 쪽을 얇게 만들면 되고
 * (`listGroups` 주석에 그 길이 적혀 있다) DTO 모양은 그대로다.
 */
export const dynamic = "force-dynamic";

export default async function PaperPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const groups = listGroups();

  let paper: PaperDTO | undefined;
  let groupName = "";
  for (const g of groups) {
    const hit = g.papers.find((p) => p.id === id);
    if (hit) {
      paper = hit;
      groupName = g.name;
      break;
    }
    for (const c of g.children) {
      const sub = c.papers.find((p) => p.id === id);
      if (sub) {
        paper = sub;
        // 칸에 든 논문은 "서가 › 칸" 으로 보여 준다. 칸 이름만으로는
        // 어느 서가의 칸인지 알 수 없다 — "2024" 같은 이름이 흔하다.
        groupName = `${g.name} › ${c.name}`;
        break;
      }
    }
    if (paper) break;
  }

  // 지워졌거나 없는 id. 빈 화면 대신 404 를 준다 — 주소를 잘못 눌렀을 때
  // "요약을 적으세요" 가 떠 있으면 어디에 적히는지 알 수 없다.
  if (!paper) notFound();

  return (
    <PaperDetail
      paper={paper}
      groupName={groupName}
      groups={groups}
      summary={getSummary(paper.id)}
    />
  );
}
