#! /bin/sh

if [ -n "$BOXEL_BRANCH" ]; then
  ICONS_DIST="$(dirname "$0")/../../boxel-icons/dist"

  # If icons aren't built locally, fall back to the production CDN.
  # This avoids requiring `pnpm --filter @cardstack/boxel-icons build` for branch setup.
  if [ ! -d "$ICONS_DIST" ]; then
    export ICONS_URL="https://boxel-icons.boxel.ai"
    echo "Icons not built locally — using production CDN: $ICONS_URL"
    exit 0
  fi

  # In branch mode, use port 0 (dynamic) and register with Traefik.
  # http-server doesn't support port 0, so we pick a free port ourselves.
  ICONS_PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("",0)); print(s.getsockname()[1]); s.close()' 2>/dev/null || node -e 'const s=require("net").createServer();s.listen(0,()=>{console.log(s.address().port);s.close();})')
  echo "Starting icons server on dynamic port ${ICONS_PORT}"
  cd "$(dirname "$0")/../../boxel-icons" && npx http-server --cors=Origin,X-Requested-With,Content-Type,Accept,Range,Authorization,X-Boxel-Assume-User --port "${ICONS_PORT}" dist &
  ICONS_PID=$!

  # Register icons service with Traefik via a small node script
  BRANCH_SLUG=$(echo "$BOXEL_BRANCH" | tr '[:upper:]' '[:lower:]' | sed 's|/|-|g; s|[^a-z0-9-]||g; s|-\+|-|g; s|^-\|-$||g')
  node -e "
    const fs = require('fs');
    const path = require('path');
    const { execSync } = require('child_process');
    let dir;
    try {
      const mounted = execSync(
        \"docker inspect boxel-traefik --format '{{range .Mounts}}{{if eq .Destination \\\"/etc/traefik/dynamic\\\"}}{{.Source}}{{end}}{{end}}'\",
        { encoding: 'utf-8' },
      ).trim();
      if (mounted) dir = mounted;
    } catch {}
    if (!dir) dir = path.resolve(__dirname, '..', '..', 'traefik', 'dynamic');
    const slug = '${BRANCH_SLUG}';
    const routerKey = 'icons-' + slug;
    const configPath = path.join(dir, slug + '-icons.yml');
    const entry = [
      'http:',
      '  routers:',
      '    ' + routerKey + ':',
      '      rule: \"Host(\`icons.${BRANCH_SLUG}.localhost\`)\"',
      '      service: ' + routerKey,
      '      entryPoints:',
      '        - web',
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
    console.log('Registered icons at icons.${BRANCH_SLUG}.localhost -> localhost:${ICONS_PORT}');
  "

  wait $ICONS_PID
else
  if curl --fail --silent --show-error http://localhost:4206 >/dev/null 2>&1; then
    echo "icons server already running on http://localhost:4206, skipping startup"
    exit 0
  fi

  pnpm --dir=../boxel-icons serve
fi
