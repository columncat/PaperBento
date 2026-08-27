# CSL 스타일과 로케일

인용문을 뽑는 데 쓰는 자산이다. `src/lib/cite.ts` 가 `apiPath("/csl/…")` 로
받아 간다. citeproc-js 는 이 XML 들이 없으면 아무것도 못 한다.

## 왜 저장소에 넣었는가 (내려받지 않고)

pdf.js 의 CMap 은 빌드 때 `node_modules` 에서 옮겨 온다
(`scripts/copy-pdfjs-assets.mjs`). 여기도 그러고 싶었지만 **CSL 스타일은 npm
패키지가 아니다** — `citation-style-language/styles` 라는 GitHub 저장소다.
빌드 스크립트로 받아 오려면 빌드가 GitHub 에 닿아야 하는데, 그러면

- 인터넷이 없는 곳에서 이미지를 못 만든다,
- GitHub 이 잠깐 흔들리는 것이 우리 배포를 멎게 하고,
- 어제 만든 이미지와 오늘 만든 이미지의 인용문이 조용히 달라진다
  (master 를 따라가므로 스타일이 바뀌면 결과도 바뀐다).

세 번째가 특히 나쁘다. 인용 형식은 **재현되어야** 하는 것이라, 판이 바뀌면
사람이 알고 바꿔야지 빌드가 몰래 바꿀 일이 아니다. 400KB 를 저장소에 지고
가는 편이 싸다.

## 무엇이 들어 있는가

받아 온 곳: <https://github.com/citation-style-language/styles> (master)
로케일: <https://github.com/citation-style-language/locales> (master)
받은 날: 2026-08-26

| 파일 | 스타일 |
| --- | --- |
| `apa.csl` | APA Style 7th edition |
| `ieee.csl` | IEEE Reference Guide (11.29.2023) |
| `chicago-author-date.csl` | Chicago Manual of Style 18th edition (author-date) |
| `modern-language-association.csl` | MLA Handbook 9th edition |
| `nature.csl` | Nature |
| `american-medical-association.csl` | AMA Manual of Style 11th edition |

### Vancouver 가 없는 이유

애초에 Vancouver 를 넣으려 했는데 **`styles` 저장소 뿌리에 `vancouver.csl` 이
없다.** `*-vancouver.csl` (Elsevier·Springer·SAGE 판)만 열여덟 개가 있고 그중
무엇이 "그냥 Vancouver" 인지는 우리가 정할 일이 아니다. 같은 자리(의학·번호
매김)를 메우는 독립 스타일로 AMA 를 대신 넣었다. Vancouver 가 꼭 필요해지면
쓰는 사람이 어느 판인지 골라서 여기 파일을 더하고 `cite.ts` 의 `CITE_STYLES`
에 한 줄을 보태면 된다.

### 로케일이 둘뿐인 이유

`locales-en-US.xml` 은 citeproc 이 늘 바탕으로 삼으므로 반드시 있어야 한다.
`locales-en-GB.xml` 은 **`nature.csl` 이 `default-locale="en-GB"` 라서** 있다 —
이걸 빠뜨리면 Nature 인용문이 미국식 용어로 조용히 찍힌다. 나머지 넷은
로케일을 지정하지 않아 en-US 를 쓴다.

한국어 로케일(`locales-ko-KR.xml`)은 넣지 않았다. 여기 실린 여섯은 모두 영어권
스타일이라 citeproc 이 ko-KR 을 **부르지 않는다** — 넣어 봐야 아무도 안 읽는
30KB 다. 한국어 스타일(예: 학회지 양식)을 더하는 날 함께 넣으면 된다.

## 라이선스

**CSL 스타일과 로케일: [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)**
Copyright the respective authors — 각 `.csl` 파일의 `<info>` 안 `<author>` 와
`<rights>` 에 적혀 있다. 고치지 않고 받은 그대로 두었다.

**citeproc-js (npm `citeproc`): CPAL-1.0 OR AGPL-1.0 듀얼.**
저장소에 두지 않고 `package.json` 의 의존성으로만 있다
(`node_modules/citeproc/LICENSE`).

PaperBento 자체의 `LICENSE`(MIT)는 건드리지 않았다. 이 둘을 함께 배포하는 것이
MIT 와 어떻게 맞물리는지는 이 앱을 내놓는 사람이 판단할 몫이다.
