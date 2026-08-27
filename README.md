# PaperBento

논문 PDF 를 **서가 단위로 모아 보는 셀프호스팅 서재**입니다.
자기 서버나 NAS 에 Docker 로 올려 쓰는 개인용 앱입니다.
[MailBento](https://github.com/columncat/MailBento)(메일함) ·
[MemoBento](https://github.com/columncat/MemoBento)(메모함) 와 같은 벌입니다.

## 기능

**서가 — 두 단까지.** 서가(예: `강화학습`) 안에 칸(`오프폴리시`)을 둘 수 있고,
칸 안에는 다시 칸을 두지 못합니다. 논문은 서가에도 칸에도 바로 놓입니다.
두 단 제한은 DB·서버·타입 세 겹으로 지켜집니다 — 자세한 것은
[`src/lib/db/schema.ts`](src/lib/db/schema.ts) 의 `groups` 주석에 있습니다.

**논문** — PDF 를 끌어다 놓으면 등록됩니다. 제목·저자·학회·연도·DOI·arXiv ID·
초록·태그를 함께 들고 있고, 표지는 브라우저가 첫 쪽을 그려 만듭니다.
읽기 상태는 `안 읽음 / 읽는 중 / 읽음` 셋입니다 — 논문은 읽다 만 것이 대부분입니다.

**뷰어** — pdf.js 로 직접 그립니다. 한국어·중국어·일본어 논문의 글자도 그대로
뽑히도록 CMap 과 기본 글꼴을 함께 싣습니다. 이 셋이 없으면 CJK 논문은 그림처럼
보이기만 하고 글자를 못 집습니다.

**요약** — 논문 하나에 마크다운 요약 하나. PDF 오른쪽에 나란히 붙습니다.

**메모** — PDF 위 특정 자리에 붙는 순수 글자 메모. 좌표를 쪽 크기에 대한
비율로 두어서 배율을 바꾸거나 창을 줄여도 자리가 버팁니다.

**서지정보 찾아오기** — DOI·arXiv ID·제목으로 doi.org · arXiv · Crossref 에
물어 빈 칸을 채웁니다. 후보는 **채울 수 있는 칸이 많은 순**으로 놓입니다.
받아 온 CSL-JSON 원본을 그대로 들고 있어서 인용문과 내보내기가 그 위에 섭니다.

**인용문과 내보내기** — APA · IEEE · Chicago · MLA · Nature · AMA 여섯 형식으로
한 줄을 뽑아 복사하고, BibTeX · RIS · CSL-JSON 으로 논문 하나 · 서가 하나 ·
서재 전체를 내보냅니다.

**Inbox** — 밖에서(에이전트·다른 앱) 들어온 PDF 가 갈 곳을 못 정했을 때 놓이는
예약 서가입니다. 이름 변경과 삭제가 잠겨 있습니다.

## 에이전트가 하는 일

[BentoAgent](https://github.com/columncat/BentoAgent) 를 띄워 두었을 때만 뜹니다.

**요약 만들기** — 무엇을 시킬지는 설정에서 고칩니다. 항목 이름과 실제로 모델에게
가는 글이 따로고, 더하고 지우고 순서를 바꿀 수 있습니다. 실행 직전에 이번 한
번만 고쳐 쓸 수도 있습니다.

**서지정보 제안** — **찾아오기가 먼저 돕니다.** 등록기관에서 받은 것은 정확한
값이고 모델이 PDF 를 읽어 낸 것은 추측이라, 정확한 것을 먼저 얻어 단서로 넘기고
모델은 **아직 빈 칸만** 메웁니다. 화면에서 두 출처를 딱지 모양으로 가릅니다.

이 둘은 평소 대화와 다른 **좁은 호출**입니다. 도구가 하나도 없고, 세션이 따로
놀고, 출력은 허용목록으로만 읽습니다. 논문은 남이 만든 파일이고 첫 쪽에 흰
글씨로 지시문을 심는 데 드는 비용은 0 이라, 방어를 프롬프트가 아니라 구조에
겁니다. 나온 값도 `paper_suggestions` 에 앉을 뿐이고, 논문이 바뀌는 순간은
사람이 적용을 누른 그 한 번입니다.

**MCP** — 에이전트가 서재를 읽고 옮기는 여덟 도구 (`list_groups` · `get_paper` ·
`read_paper_text` · `search_papers` · `move_paper` · `set_read_state` ·
`set_mark` · `create_group`). 요약도 서지정보도 여기서는 못 씁니다. 자세한 것은
[`mcp/README.md`](mcp/README.md).

## 그 밖에

- 삭제한 서가·논문은 30일간 휴지통에 남고 되살릴 수 있습니다
- 에이전트가 무엇을 고쳤는지 남습니다
- 서재 전체를 JSON 으로 내려받는 백업 (되살리기는 아직 손으로 합니다)
- 비밀번호 잠금 (선택) 과 로그인 기록

## 기술 스택

- **Next.js 15** (App Router) · React 19 · TypeScript
- **Tailwind CSS v4**
- **SQLite + Drizzle ORM** — 마이그레이션은 첫 실행 시 자동 적용
- **pdf.js** — 뷰어와 표지 만들기(브라우저) · 글자층 뽑기(서버)
- **citeproc-js + CSL** — 인용문 (라이선스는 아래를 보세요)
- **Docker** (Next.js standalone output)

## 빠른 시작

```bash
npm install
cp .env.example .env.local
npm run dev
```

`http://localhost:3000` 으로 접속합니다. `.env.local` 값은 전부 선택 항목이라
그대로 두어도 동작합니다.

기타 스크립트:

```bash
npm run build && npm start   # 프로덕션 확인
npm run db:generate          # 스키마 변경 후 마이그레이션 생성
```

> `db:generate` 로 뽑은 SQL 은 **눈으로 확인하세요.** `groups` 의
> `parent_depth` 는 반드시 `GENERATED ALWAYS AS (depth - 1) VIRTUAL` 이어야
> 하고, 복합 외래키 `(parent_id, parent_depth) → groups(id, depth)` 와
> `groups_depth_ck` · `groups_root_ck` 두 CHECK 가 함께 있어야 합니다.
> 이 넷이 모여 3단 그룹을 DB 수준에서 막습니다.

## 환경 변수

| 이름 | 기본값 | 설명 |
| --- | --- | --- |
| `DATABASE_PATH` | `./data/paperbento.db` | SQLite 파일 경로 |
| `UPLOAD_DIR` | `./data/uploads` | PDF 원본·표지 저장 위치 |
| `MAX_UPLOAD_MB` | `5120` | 업로드 1건당 최대 크기 (MB) |
| `AUTH_PASSWORD` | (없음) | plaintext 또는 bcrypt 해시. 비우면 인증 끔 |
| `AUTH_SECRET` | (없음) | 세션 쿠키 암호화 키 (32바이트 base64) |
| `MAILBENTO_URL` · `MEMOBENTO_URL` | (없음) | 헤더의 자매 앱 버튼 주소. 비우면 자동 유추 |
| `AGENT_URL` · `AGENT_TOKEN` | (없음) | 에이전트 채팅 (아래 참고) |
| `BASE_PATH` | (없음) | 하위 경로 배포. **빌드 시점**에만 (아래 참고) |

자세한 설명은 [`.env.example`](.env.example) 에 있습니다.

## Docker 배포

세 자매 앱과 에이전트를 한 벌로 띄우는 것이 정석입니다. 그쪽은
[MailBento 의 `deploy/`](https://github.com/columncat/MailBento/tree/main/deploy) 를 보세요 —
`./bootstrap.sh` 한 번이면 저장소를 받아 넷을 다 띄우고, 설치 마법사가
비밀번호와 키를 한 번에 받습니다. 스택에서 PaperBento 는 **3002 번**입니다.

이 앱만 따로 띄운다면:

```bash
docker build -t paperbento .
mkdir -p data/uploads && chmod -R 777 data
docker run -d -p 3002:3000 -v "$PWD/data:/app/data" \
  -e AUTH_PASSWORD=… -e AUTH_SECRET=… paperbento
```

- DB 와 PDF 원본은 `/app/data` 볼륨에 영속화되어 재배포해도 남습니다.
- 컨테이너는 uid 1001 로 실행됩니다. 바인드 마운트가 uid 를 매핑하지 않는 환경
  (예: Synology)에서는 `data` 에 쓰기 권한이 없으면 부팅에 실패하므로 위 `chmod` 가 필요합니다.

### 하위 경로에 얹기

`bento.example.com/paper` 처럼 도메인 하나를 경로로 나눠 쓸 때는 **이미지를
만들 때** 알려 줘야 합니다. Next 가 이 값을 산출물 곳곳에 미리 심기 때문에
런타임 환경변수로는 바꿀 수 없습니다.

```bash
docker build --build-arg BASE_PATH=/paper -t paperbento .
```

앞단(Cloudflare 터널 등) 설정은
[`deploy/cloudflare-ingress.md`](https://github.com/columncat/MailBento/blob/main/deploy/cloudflare-ingress.md)
에 있습니다. **경로 규칙은 정규식이고 앵커가 필요합니다** — `/paper*` 처럼
적으면 다른 앱의 `.../main-app.js` 까지 걸려 들어갑니다. 실제로 겪은 일입니다.

## 에이전트 붙이기 (선택)

[BentoAgent](https://github.com/columncat/BentoAgent) 를 띄워 두면 우상단에 **대화**
버튼이 생깁니다. Discord 에서 하던 대화와 **같은 대화**라 창구를 옮겨도 맥락이 이어집니다.
위의 요약 만들기와 서지정보 제안도 같은 두 값으로 켜집니다.

```bash
AGENT_URL=http://127.0.0.1:4000
AGENT_TOKEN=…
```

둘 다 채워야 버튼이 뜹니다. 브라우저가 에이전트를 직접 부르지 않고 이 앱이 서버에서
프록시하므로 토큰은 화면에 실리지 않고, 이미 있는 로그인이 그대로 경계가 됩니다.

## 라이선스

이 앱의 코드는 [MIT](LICENSE) 다.

다만 **브라우저로 내려보내는 것 안에 남이 쓴 것이 섞여 있고** 그중 둘은 MIT 가
아니다 — 인용문을 만드는 citeproc-js(CPAL-1.0)와 CSL 스타일(CC BY-SA 3.0).
무엇이 어떤 라이선스로 함께 나가는지는 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)
에 적어 두었다.
