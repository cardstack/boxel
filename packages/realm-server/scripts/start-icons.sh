#! /bin/sh

if [ -n "$BOXEL_BRANCH" ]; then
  # In branch mode, use port 0 (dynamic) and register with Traefik.
  # http-server doesn't support port 0, so we pick a free port ourselves.
  ICONS_PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("",0)); print(s.getsockname()[1]); s.close()' 2>/dev/null || node -e 'const s=require("net").createServer();s.listen(0,()=>{console.log(s.address().port);s.close();})')
  echo "Starting icons server on dynamic port ${ICONS_PORT}"
  cd "$(dirname "$0")/../../boxel-icons" && npx http-server --cors=Origin,X-Requested-With,Content-Type,Accept,Range,Authorization,X-Boxel-Assume-User --port "${ICONS_PORT}" dist &
  ICONS_PID=$!

  # Register icons service with Traefik via a small node script
  BRANCH_SLUG=$(echo "$BOXEL_BRANCH" | tr '[:upper:]' '[:lower:]' | sed 's|/|-|g; s|[^a-z0-9-]||g; s|-\+|-|g; s|^-\|-$||g')
  node -e "
    const yaml = require('yaml');
    const fs = require('fs');
    const path = require('path');
    const dir = path.resolve(__dirname, '..', '..', 'traefik', 'dynamic');
    const slug = '${BRANCH_SLUG}';
    const configPath = path.join(dir, slug + '.yml');
    let config = {};
    try { config = yaml.parse(fs.readFileSync(configPath, 'utf-8')) || {}; } catch {}
    if (!config.http) config.http = {};
    if (!config.http.routers) config.http.routers = {};
    if (!config.http.services) config.http.services = {};
    config.http.routers['icons-' + slug] = { rule: 'Host(\`icons.${BRANCH_SLUG}.lvh.me\`)', service: 'icons-' + slug, entryPoints: ['web'] };
    config.http.services['icons-' + slug] = { loadBalancer: { servers: [{ url: 'http://host.docker.internal:${ICONS_PORT}' }] } };
    const tmp = configPath + '.tmp';
    fs.writeFileSync(tmp, yaml.stringify(config), 'utf-8');
    fs.renameSync(tmp, configPath);
    console.log('Registered icons at icons.${BRANCH_SLUG}.lvh.me -> localhost:${ICONS_PORT}');
  "

  wait $ICONS_PID
else
  if curl --fail --silent --show-error http://localhost:4206 >/dev/null 2>&1; then
    echo "icons server already running on http://localhost:4206, skipping startup"
    exit 0
  fi

  pnpm --dir=../boxel-icons serve
fi
