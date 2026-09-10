#! /bin/sh

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPTS_DIR/../../../scripts/env-slug.sh"

if [ -n "$BOXEL_ENVIRONMENT" ]; then
  ENV_SLUG=$(resolve_env_slug)
  # A file from the dist rather than `/`: a 200 for it means an icons server
  # is answering, not merely something on the port.
  PROBE_PATH="/@cardstack/boxel-icons/v1/icons/folder-pen.js"

  # The route file lives in the directory the running Traefik container
  # watches, which in a worktree can differ from this checkout's own
  # traefik/dynamic (see scripts/start-traefik.sh). Resolved once, here, and
  # handed to the registration below so the check and the write agree.
  DYNAMIC_DIR=$(docker inspect boxel-traefik --format '{{range .Mounts}}{{if eq .Destination "/etc/traefik/dynamic"}}{{.Source}}{{end}}{{end}}' 2>/dev/null)
  [ -n "$DYNAMIC_DIR" ] || DYNAMIC_DIR="$SCRIPTS_DIR/../../../traefik/dynamic"
  CONFIG_PATH="$DYNAMIC_DIR/${ENV_SLUG}-icons.yml"

  # More than one task starts this script for the same environment:
  # services:icons on its own, and services:realm-server, which spawns it so
  # that dev-all — which does not list services:icons — still gets an icons
  # server. Each start registers its own port under this one route file, last
  # writer winning, so a second instance that failed to come up would take the
  # route away from a first that was serving. An instance that finds the
  # registered server answering steps aside. The check goes straight to the
  # port the route names, the way Traefik reaches it, rather than through the
  # hostname: that depends on nothing but the server being up — not on DNS,
  # the mkcert trust, or Traefik having finished a reload.
  if [ -f "$CONFIG_PATH" ]; then
    REGISTERED_PORT=$(sed -n 's/.*host\.docker\.internal:\([0-9]*\).*/\1/p' "$CONFIG_PATH" | head -1)
    if [ -n "$REGISTERED_PORT" ] && curl --fail --silent --max-time 2 "http://127.0.0.1:${REGISTERED_PORT}${PROBE_PATH}" >/dev/null 2>&1; then
      echo "icons already served for icons.${ENV_SLUG}.localhost on port ${REGISTERED_PORT}, skipping startup"
      exit 0
    fi
  fi

  # http-server doesn't support port 0, so pick a free port here. The port is
  # found by binding it and letting it go, so http-server's own bind can still
  # fail; the wait below is what makes that safe.
  ICONS_PORT=$(node -e 'const s=require("net").createServer();s.listen(0,()=>{console.log(s.address().port);s.close();})')
  echo "Starting icons server on dynamic port ${ICONS_PORT}"
  cd "$(dirname "$0")/../../boxel-icons" && npx http-server --cors=Origin,X-Requested-With,Content-Type,Accept,Range,Authorization,X-Boxel-Assume-User --port "${ICONS_PORT}" dist &
  ICONS_PID=$!

  # Register only a server that answers. http-server binds after this script
  # has moved on, and a route written before it does would point Traefik at
  # the port whether or not anything ever listens there; every icon request
  # would then fail with a 502 that no service log records, and the host app
  # cannot render a card without its icons.
  tries=0
  until curl --fail --silent --max-time 2 "http://127.0.0.1:${ICONS_PORT}${PROBE_PATH}" >/dev/null 2>&1; do
    if ! kill -0 "$ICONS_PID" 2>/dev/null; then
      echo "icons server exited before it answered on port ${ICONS_PORT}; not registering it" >&2
      exit 1
    fi
    tries=$((tries + 1))
    if [ "$tries" -ge 60 ]; then
      echo "icons server did not answer on port ${ICONS_PORT} within 30s; not registering it" >&2
      kill "$ICONS_PID" 2>/dev/null
      exit 1
    fi
    sleep 0.5
  done

  # Register icons service with Traefik via a small node script.
  # Mirrors dev-service-registry.ts: a `websecure` router terminates TLS
  # at Traefik (mkcert leaf) and a sibling `-http` router on :80
  # 308-redirects to https. The host bundle is loaded over https, so an
  # `http://icons.<slug>.localhost/...` upstream would be mixed-content
  # blocked AND fail the CORS preflight on the redirect.
  CONFIG_PATH="$CONFIG_PATH" node -e "
    const fs = require('fs');
    const { spawn } = require('child_process');
    const slug = '${ENV_SLUG}';
    const routerKey = 'icons-' + slug;
    const redirectMiddleware = routerKey + '-https-redirect';
    const configPath = process.env.CONFIG_PATH;
    const entry = [
      'http:',
      '  routers:',
      '    ' + routerKey + ':',
      '      rule: \"Host(\`icons.${ENV_SLUG}.localhost\`)\"',
      '      service: ' + routerKey,
      '      entryPoints:',
      '        - websecure',
      '      tls: {}',
      '    ' + routerKey + '-http:',
      '      rule: \"Host(\`icons.${ENV_SLUG}.localhost\`)\"',
      '      entryPoints:',
      '        - web',
      '      middlewares:',
      '        - ' + redirectMiddleware,
      '      service: ' + routerKey,
      '  middlewares:',
      '    ' + redirectMiddleware + ':',
      '      redirectScheme:',
      '        scheme: https',
      '        permanent: true',
      '  services:',
      '    ' + routerKey + ':',
      '      loadBalancer:',
      '        servers:',
      '          - url: \"http://host.docker.internal:${ICONS_PORT}\"',
      '',
    ].join('\\n');
    const tmp = configPath + '.tmp';
    fs.writeFileSync(tmp, entry, 'utf-8');
    fs.renameSync(tmp, configPath);
    // Bounce Traefik on macOS — Docker Desktop's bind mounts don't
    // propagate inotify, and Traefik v3 file provider has no polling
    // option. See dev-service-registry.ts for the full rationale.
    if (process.platform === 'darwin') {
      const child = spawn('docker', ['restart', 'boxel-traefik'], {
        stdio: 'ignore', detached: true,
      });
      child.on('error', () => {});
      child.unref();
    }
  "
  echo "Registered icons at icons.${ENV_SLUG}.localhost -> localhost:${ICONS_PORT}"

  # The route is right only while this server is up. When it exits, take the
  # route with it — if it still names this port — so Traefik answers 404 for a
  # missing route rather than 502 for a dead upstream, and the next start of
  # any icons task registers afresh instead of stepping aside for a route that
  # only looks live.
  wait $ICONS_PID
  ICONS_STATUS=$?
  if grep -qF "host.docker.internal:${ICONS_PORT}\"" "$CONFIG_PATH" 2>/dev/null; then
    rm -f "$CONFIG_PATH"
    echo "icons server on port ${ICONS_PORT} exited (status ${ICONS_STATUS}); removed its route" >&2
  fi
  exit $ICONS_STATUS
else
  if curl --fail --silent --show-error http://localhost:4206 >/dev/null 2>&1; then
    echo "icons server already running on http://localhost:4206, skipping startup"
    exit 0
  fi

  pnpm --dir=../boxel-icons serve
fi
