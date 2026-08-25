import { z } from "zod";

/**
 * 메모가 붙는 자리의 검증 규칙.
 *
 * 라우트 파일(`route.ts`) 밖에 둔다. Next 는 라우트 파일의 export 를 정해진
 * 것들(핸들러·`dynamic` 따위)로 제한해서, 거기서 스키마를 내보내면 빌드가
 * 타입 오류로 죽는다. 목록 라우트와 개별 메모 라우트가 같은 규칙을 써야 하니
 * 옆 모듈로 뺀다.
 *
 * 좌표는 **쪽 크기에 대한 비율**이다 (`types.ts` 의 `Anchor`). 픽셀을 받으면
 * 배율을 바꾸거나 창을 줄인 순간 메모가 엉뚱한 곳으로 간다. 1 을 크게 넘는
 * 값을 거절하는 것은, 픽셀을 그대로 보낸 호출부를 개발 중에 바로 잡아내려는
 * 것이다 — 조용히 저장되면 나중에 "메모가 사라졌다" 로 보인다.
 */
const ratio = z.number().min(-0.5).max(1.5);
const rect = z.tuple([ratio, ratio, ratio, ratio]);

export const anchorSchema = z.object({
  /** 모양이 바뀌면 올린다. 옛 메모를 읽을 때 갈래를 탄다. */
  v: z.literal(1),
  page: z.number().int().min(1),
  /** 칠할 조각들. */
  rects: z.array(rect).max(200).default([]),
  /** rects 를 감싸는 상자. 스크롤 목표는 이것만 본다. */
  box: rect,
  /** 고른 글자. 판본이 바뀌어 좌표가 어긋났을 때 글자로 다시 찾는 보험이다. */
  quote: z.string().max(4000).optional(),
  prefix: z.string().max(1000).optional(),
  suffix: z.string().max(1000).optional(),
});
