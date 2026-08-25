import { Library } from "@/components/library";
import { env } from "@/lib/env";
import { listGroups } from "@/lib/paper-server";

/**
 * 서재 첫 화면.
 *
 * 여기서 하는 일은 **읽어서 넘기는 것뿐이다.** 상태는 `<Library>` 가 전부
 * 들고, 이 파일은 서버에서만 할 수 있는 일(DB 읽기, 환경변수)만 한다 —
 * MailBento 의 3단 분리를 그대로 따른다.
 *
 * `force-dynamic` 인 것은 서재가 사람과 에이전트 양쪽에서 바뀌기 때문이다.
 * 정적으로 굳으면 새로고침해도 옛 서재가 나온다.
 */
export const dynamic = "force-dynamic";

export default async function HomePage() {
  return (
    <Library
      initial={listGroups()}
      mailbentoUrl={env.MAILBENTO_URL?.trim() || null}
      memobentoUrl={env.MEMOBENTO_URL?.trim() || null}
    />
  );
}
