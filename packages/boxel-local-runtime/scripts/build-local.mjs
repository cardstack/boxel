import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const instance = process.env.BOXEL_NATIVE_INSTANCE ?? 'default';
const gatewayPort = process.env.BOXEL_NATIVE_GATEWAY_PORT ?? '4242';
if (
  !/^[a-z][a-z0-9-]{0,47}$/.test(instance) ||
  !/^\d{4,5}$/.test(gatewayPort) ||
  Number(gatewayPort) < 1024 ||
  Number(gatewayPort) > 65535
)
  throw new Error('Invalid native build environment');
const server = `${instance}.boxel.localhost:${gatewayPort}`;
const environment = {
  ...process.env,
  CLIENT_TELEMETRY_ENABLED: 'false',
  BOXEL_PUBLIC_SOURCE_NAMES: 'true',
  PUBLISHED_REALM_BOXEL_SPACE_BASE_URL: `http://realm.${server}/sites/`,
  REALM_SERVER_DOMAIN: `http://realm.${server}/`,
  BOXEL_PUBLIC_REFERENCE_CACHE_URL: `http://reference.${server}/`,
  MATRIX_URL: `http://matrix.${server}`,
  MATRIX_SERVER_NAME: `${instance}.boxel.localhost`,
  SECURE_ORIGIN_URL: `http://secure.${server}/secure`,
  ICONS_URL: `http://icons.${server}`,
  RESOLVED_BASE_REALM_URL: `http://realm.${server}/base/`,
  RESOLVED_CATALOG_REALM_URL: 'https://app.boxel.ai/catalog/',
  RESOLVED_SKILLS_REALM_URL: 'https://app.boxel.ai/skills/',
  RESOLVED_OPENROUTER_REALM_URL: 'https://app.boxel.ai/openrouter/',
  RESOLVED_PRETUI_REALM_URL: 'https://app.boxel.ai/pretui/',
};

const result = spawnSync(
  'pnpm',
  [
    'exec',
    'turbo',
    'run',
    '--output-logs=errors-only',
    'build',
    'lint:types',
    '--filter=@cardstack/boxel-local-runtime',
  ],
  {
    cwd: fileURLToPath(new URL('../../../', import.meta.url)),
    env: environment,
    stdio: 'inherit',
  },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
