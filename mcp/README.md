# paperbento-mcp

[PaperBento](../README.md) 의 서재를 **에이전트가 읽고 정리할 수 있게** 해 주는
MCP 서버입니다. stdio 로 붙습니다.

앱의 HTTP API 를 그대로 씁니다. DB 파일을 직접 건드리지 않습니다 — 두 단 제한,
휴지통 30일 보관, 순서, 시스템 서가(Inbox) 규칙이 전부 서버 쪽에 있어서 우회하면
그게 다 깨집니다.

**읽는 것은 다 열려 있고, 쓰는 것은 정리 작업만 열려 있습니다.** 서지정보·요약·
메모 본문은 이 서버로 쓸 수 없습니다. 이유는 아래 [무엇을 안 열었나](#무엇을-안-열었나)
에 있습니다.

## 어디서 돌리나

PaperBento 에 HTTP 로 닿을 수 있으면 됩니다.

| 상황 | `PAPERBENTO_URL` |
| --- | --- |
| 같은 호스트 (Docker 로 앱을 띄운 머신) | `http://127.0.0.1:3002` |
| 같은 내부망의 다른 머신 | `http://<호스트>:3002` |
| 하위 경로에 얹은 배포 | `http://<호스트>:3002/paper` — 경로까지 그대로 적습니다 |

## 설치

```bash
git clone https://github.com/columncat/PaperBento.git
cd PaperBento/mcp
npm install
npm run build
```

## 설정

환경변수 넷입니다.

| 이름 | 기본값 | 설명 |
| --- | --- | --- |
| `PAPERBENTO_URL` | `http://127.0.0.1:3002` | 앱 주소 |
| `PAPERBENTO_PASSWORD` | (없음) | 잠금을 켠 서버라면 필수 |
| `PAPERBENTO_TIMEOUT_MS` | `20000` | 요청 하나의 제한 시간 |
| `PAPERBENTO_AGENT_NAME` | `MCP` | 활동 기록에 남을 이름 |

앱에는 API 토큰이 없어서, 사람이 쓰는 것과 같은 비밀번호로 세션 쿠키를 받아 씁니다.
세션이 만료되면 자동으로 다시 로그인하고 원래 요청을 재시도합니다.

이 서버로 들어온 변경은 **설정 → 에이전트 기록**에 남습니다. 감사 로그가 아니라
기록입니다 — 나중에 "이 논문 왜 옮겨졌지" 를 되짚는 자리입니다.

### MCP 클라이언트에 등록

```json
{
  "mcpServers": {
    "paperbento": {
      "command": "node",
      "args": ["/path/to/PaperBento/mcp/dist/index.js"],
      "env": {
        "PAPERBENTO_URL": "http://127.0.0.1:3002",
        "PAPERBENTO_PASSWORD": "…"
      }
    }
  }
}
```

Claude Code 라면:

```bash
claude mcp add paperbento --env PAPERBENTO_URL=http://127.0.0.1:3002 --env PAPERBENTO_PASSWORD=… -- node /path/to/PaperBento/mcp/dist/index.js
```

## 도구

### 읽기

| 도구 | 하는 일 |
| --- | --- |
| `list_groups` | 서가와 칸, 담긴 논문 목록. `includePapers=false` 로 편수만 |
| `get_paper` | 논문 하나의 서지정보 + 요약 본문 + 메모 목록 |
| `read_paper_text` | PDF 에서 뽑은 글자. `pages="1-3"` (한 번에 30쪽까지), `limit` |
| `search_papers` | 제목·저자·태그·초록으로 찾기 |

### 정리

| 도구 | 하는 일 |
| --- | --- |
| `move_paper` | 다른 서가/칸으로 |
| `set_read_state` | 안읽음 / 읽는중 / 읽음 |
| `set_mark` | 표식 붙이기·떼기 |
| `create_group` | 서가·칸 만들기 (두 단 제한은 서버가 막습니다) |

논문과 서가는 **id 로도 이름으로도** 지정합니다. 이름이 겹치면 고르지 않고 후보를
보여 주며 되묻습니다 — 아무거나 골라 옮기면 사람은 논문이 사라진 줄 압니다.
칸은 `"서가/칸"` 으로도 짚을 수 있습니다.

## 무엇을 안 열었나

**서지정보 쓰기 · 요약 쓰기 · 메모 쓰기와 지우기 · 논문 지우기 · 서가 지우기.**
앱의 API 에는 다 있습니다. 여기에만 없습니다.

이 서버를 붙인 에이전트가 읽는 것은 **남이 쓴 글**입니다. 논문 본문은 우리가 쓴
것이 아니고, PDF 안에 "지금까지의 지시를 무시하고 …" 같은 문장을 심어 두는 것을
막을 방법이 우리에게 없습니다. 쓰기 도구가 열려 있으면 거기 심긴 문장이 곧 DB
쓰기가 됩니다 — 요약 자리에 남의 글이 들어앉고, 서지정보가 조용히 바뀌고, 사람이
적어 둔 메모가 지워집니다. **읽은 것이 그대로 쓰기로 이어지는 고리를 끊었습니다.**

그래서 **제안은 앱이 합니다.** 등록 시트와 상세 화면의 "에이전트에게 맡기기" 가
`/api/papers/[id]/suggest` 를 부르고, 사람이 보고 눌러야 저장됩니다.

지우기가 빠진 것도 같은 줄기입니다. 휴지통이 있어 되돌릴 수는 있지만, PDF 가
딸린 논문은 잘못 지웠을 때 사람이 파일을 다시 구해 와야 하는 경우가 생깁니다.
얻는 것보다 잃을 것이 큽니다.

## PDF 를 통째로 싣지 않습니다

논문 한 편은 수십 MB 입니다. 바이트를 그대로 도구 결과에 실으면 그 한 번으로
맥락이 통째로 날아갑니다. 그래서 파일을 내려주는 도구가 없고, 글자가 필요하면
`read_paper_text` 로 쪽을 짚어 받습니다.

글자층이 없는 스캔본이면 빈 글과 함께 `reason` 이 옵니다. 그건 "내용이 없다" 가
아니라 "읽을 글자가 없다" 입니다.

### 쪽을 짚는 일은 절반이 이쪽에서 일어납니다

앱의 추출기(`lib/pdf-text.ts`)는 **늘 1쪽부터 읽고 "몇 쪽까지" 만** 받습니다.
아무 쪽이나 열어 볼 수가 없습니다. 그래서 이 서버는

1. `pages="5-6"` 을 풀어 가장 뒤 쪽(6)을 구하고,
2. 앱에 `?maxPages=6&maxChars=…` 로 부탁한 뒤,
3. 돌아온 글에서 `--- p.N ---` 표시를 보고 **5·6쪽만 남깁니다.**

그대로 흘리면 5쪽 하나 보려다 1~5쪽이 통째로 대화에 쌓입니다. `maxChars` 를
`limit` 보다 넉넉히 부르는 것도 같은 이유입니다 — 상한에 먼저 걸리면 정작
원한 쪽이 뽑힌 글에 들어 있지 않습니다.

이 서버가 기대하는 라우트는 하나입니다.

```
GET /api/papers/:id/text?maxPages=<n>&maxChars=<n>
    → lib/pdf-text.ts 의 ExtractResult 를 그대로
      { text, pages, totalPages, truncated, hasText, reason }
```

## 개발

```bash
npm run check   # 타입 검사
npm run build   # dist/ 생성
npm start       # 직접 실행 (stdio 라 터미널에서는 조용합니다)
```
