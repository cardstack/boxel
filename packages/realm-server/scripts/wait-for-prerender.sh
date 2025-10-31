#! /bin/sh

wait_for_prerender() {
  local url="${1:-${PRERENDER_HEALTH_URL:-http://localhost:4221/}}"
  local trimmed_url="${url%/}/"
  TIMEOUT_SECONDS=30
  START_TIME=$(date +%s)

  echo "Waiting for prerender server at ${trimmed_url}"

  while ! curl -sf "$trimmed_url" >/dev/null 2>&1; do
    CURRENT_TIME=$(date +%s)
    ELAPSED=$((CURRENT_TIME - START_TIME))
    if [ "$ELAPSED" -ge "$TIMEOUT_SECONDS" ]; then
      echo "Timed out waiting for prerender server after ${TIMEOUT_SECONDS}s"
      exit 1
    fi
    sleep 1
  done

  echo "Prerender server is ready"
}
