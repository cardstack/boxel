#! /bin/sh

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPTS_DIR/../../../scripts/env-slug.sh"

if [ -n "$BOXEL_ENVIRONMENT" ]; then
  # In environment mode, use port 0 (dynamic) and register with Traefik.
  # http-server doesn't support port 0, so we pick a free port ourselves.
  ICONS_PORT=$(node -e 'const s=require("net").createServer();s.listen(0,()=>{console.log(s.address().port);s.close();})')
  echo "Starting icons server on dynamic port ${ICONS_PORT}"
  cd "$(dirname "$0")/../../boxel-icons" && npx http-server --cors=Origin,X-Requested-With,Content-Type,Accept,Range,Authorization,X-Boxel-Assume-User --port "${ICONS_PORT}" dist &
  ICONS_PID=$!

  # Register icons service with Traefik via a small node script.
  # Mirrors dev-service-registry.ts: a `websecure` router terminates TLS
  # at Traefik (mkcert leaf) and a sibling `-http` router on :80
  # 308-redirects to https. The host bundle is loaded over https, so an
  # `http://icons.<slug>.localhost/...` upstream would be mixed-content
  # blocked AND fail the CORS preflight on the redirect.
  ENV_SLUG=$(resolve_env_slug)
  node -e "
    const fs = require('fs');
    const path = require('path');
    const { execSync, spawn } = require('child_process');
    let dir;
    try {
      const mounted = execSync(
        \"docker inspect boxel-traefik --format '{{range .Mounts}}{{if eq .Destination \\\"/etc/traefik/dynamic\\\"}}{{.Source}}{{end}}{{end}}'\",
        { encoding: 'utf-8' },
      ).trim();
      if (mounted) dir = mounted;
    } catch {}
    if (!dir) dir = path.resolve(__dirname, '..', '..', 'traefik', 'dynamic');
    const slug = '${ENV_SLUG}';
    const routerKey = 'icons-' + slug;
    const redirectMiddleware = routerKey + '-https-redirect';
    const configPath = path.join(dir, slug + '-icons.yml');
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
    console.log('Registered icons at icons.${ENV_SLUG}.localhost -> localhost:${ICONS_PORT}');
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

  wait $ICONS_PID
else
  if curl --fail --silent --show-error http://localhost:4206 >/dev/null 2>&1; then
    echo "icons server already running on http://localhost:4206, skipping startup"
    exit 0
  fi

  pnpm --dir=../boxel-icons serve
fi
