# 함께 실려 나가는 남의 것

이 앱의 코드는 [MIT](LICENSE) 다. 다만 **브라우저로 내려보내는 것 안에 남이 쓴
것이 섞여 있고**, 그중 둘은 MIT 가 아니다. `LICENSE` 만 보고 "전부 MIT" 로 읽으면
사실과 다르므로 여기 적어 둔다.

> 이 파일은 법률 자문이 아니다. 무엇이 어떤 라이선스로 함께 나가는지를
> 적어 둔 기록이고, 그것을 어떻게 다룰지는 내놓는 사람이 정할 일이다.

## citeproc-js — CPAL-1.0 **또는** AGPL-1.0 (고르는 쪽)

- npm 패키지 `citeproc`, 저자 Frank G. Bennett, Jr.
- https://github.com/Juris-M/citeproc-js
- **고치지 않고** 의존성으로 그대로 쓴다.
- 인용문을 만드는 일 전부가 이것이다. `src/lib/cite.ts` 가 감싼다.

둘 중 하나를 고르라는 듀얼 라이선스다. **이 저장소는 CPAL-1.0 쪽으로 읽는다** —
AGPL 쪽을 고르면 이 앱 전체가 그 조건에 끌려가는데, 나머지는 전부 우리가 쓴
MIT 코드라 그렇게 둘 이유가 없다.

CPAL 은 "고친 것을 내놓을 때 그 소스를 함께" 를 요구한다. 우리는 고치지 않았고
npm 에서 받은 그대로 번들에 실으므로, 여기 출처와 라이선스를 밝히는 것으로
갈음한다. 고치게 되는 날에는 이 문단부터 다시 읽어야 한다.

**이 코드는 브라우저까지 간다.** 서버에만 두는 것이 아니라 372KB 짜리 청크로
갈라져 논문 상세 화면에서 내려간다 — 그래서 "배포" 에 해당한다.

## CSL 스타일과 로케일 — CC BY-SA 3.0

- `public/csl/` 아래 XML 전부 (APA · IEEE · Chicago · MLA · Nature · AMA, 로케일 둘)
- https://github.com/citation-style-language/styles
- https://github.com/citation-style-language/locales
- **고치지 않고** 받은 그대로 둔다. 왜 저장소에 넣었는지는 `public/csl/README.md`.

각 파일 안에 저작자와 라이선스가 적혀 있다. 고쳐서 내놓는다면 같은 라이선스로
내놓아야 한다(SA).

## pdf.js — Apache-2.0

- npm 패키지 `pdfjs-dist`, Mozilla
- 논문을 보여 주는 뷰어와 표지 만들기.
- `public/pdfjs/` 의 CMap·기본 글꼴은 빌드 때 `node_modules` 에서 옮겨 온 것이라
  저장소에는 없다 (`scripts/copy-pdfjs-assets.mjs`).

## 그 밖

`package.json` 의 나머지 의존성은 MIT 나 Apache-2.0 이다. Next.js, React,
Tailwind, drizzle, better-sqlite3, lucide, dnd-kit, zod, bcryptjs.

## 자매 앱과 다른 점

MailBento 와 MemoBento 에는 이 파일이 없다. 그 둘은 MIT·Apache 만 싣기
때문이다. 논문함만 인용문을 만들어야 해서 이 하나가 늘었다.
