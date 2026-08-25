#!/bin/sh
# 설정이 생길 때까지 기다렸다가 시작한다.
#
# 설치 마법사는 메일함 컨테이너가 띄운다 (그쪽이 3000 번으로 사람이 처음 닿는
# 곳이다). 여기서는 그 결과만 기다린다. 없는 채로 뜨면 인증도 주소도 없는
# 상태로 잠깐 열리게 되는데, 그 사이에 누가 들어오면 곤란하다.
set -e

CONFIG_DIR="${BENTO_CONFIG_DIR:-/config}"
CONFIG="$CONFIG_DIR/paperbento.env"
DONE="$CONFIG_DIR/setup.json"

# 설정을 환경변수로 직접 받는 배포는 예전 그대로 둔다.
#
# 이 갈림길이 없으면 멀쩡히 돌던 배포가 다음 이미지에서 영영 기다리기만 한다.
# 실제로 그랬다 — 22분 동안 "설정을 기다립니다" 만 찍으며 앱이 안 떴다.
# 기다림은 스택이 관리하는 배포(BENTO_MANAGED=1)에서만 한다.
if [ "${BENTO_MANAGED:-}" != "1" ] && [ ! -f "$DONE" ]; then
  echo "[paperbento] 환경변수로 설정된 배포입니다. 앱을 시작합니다."
  exec node server.js
fi

waited=0
while [ ! -f "$DONE" ] || [ ! -f "$CONFIG" ]; do
  if [ "$waited" -eq 0 ]; then
    echo "[paperbento] 설정을 기다립니다 — 메일함 쪽(3000 번)의 설치 마법사에서 진행하세요."
  fi
  waited=$((waited + 3))
  # 오래 기다리면 한 번씩 다시 알린다. 로그만 보고 있는 사람에게 멈춘 것처럼
  # 보이지 않게.
  if [ $((waited % 60)) -eq 0 ]; then
    echo "[paperbento] 아직 설정이 없습니다 (${waited}초째)."
  fi
  sleep 3
done

if [ ! -r "$CONFIG" ]; then
  echo "[paperbento] $CONFIG 를 읽을 수 없습니다 (지금 uid=$(id -u))." >&2
  echo "  호스트 폴더의 주인이 다릅니다. 스택 폴더에서 한 번 돌리세요:" >&2
  echo "    docker compose run --rm --no-deps --user 0 --entrypoint sh paperbento \\" >&2
  echo "      -c 'chown -R 1001:1001 /app/data'" >&2
  echo "  bootstrap.sh 로 띄우면 이 일을 알아서 합니다." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$CONFIG"
set +a

echo "[paperbento] 설정을 읽었습니다. 앱을 시작합니다."
exec node server.js
