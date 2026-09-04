import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import * as net from 'net';
import * as childProcess from 'child_process';
import fse from 'fs-extra';
import { request } from '@playwright/test';
import {
  dockerCreateNetwork,
  dockerExec,
  dockerLogs,
  dockerRun,
  dockerStop,
} from '../docker.ts';
import { APP_BOXEL_REALMS_EVENT_TYPE } from '../matrix-constants.ts';
import { appURL } from '../isolated-realm-server.ts';
import {
  isEnvironmentMode,
  getSynapseContainerName,
  getSynapseURL,
  registerSynapseWithTraefik,
} from '../environment-config.ts';

export const SYNAPSE_PORT = 8008;

// Synapse containers are named after the temp config directory they are given,
// which `cfgDirFromTemplate` creates with this prefix.
const TEST_SYNAPSE_CONTAINER_PREFIX = 'sf-test-synapse-';

// Synapse's listeners bind to "::" (IPv6 dual-stack) by default. Hosts whose
// kernel lacks IPv6 (some minimal cloud VMs / containers) can't bind it and
// synapse dies at startup with "Address family not supported by protocol". We
// detect that here so the generated config can fall back to IPv4-only binding.
function hostHasIPv6(): boolean {
  let interfaces = os.networkInterfaces();
  for (let name of Object.keys(interfaces)) {
    for (let info of interfaces[name] ?? []) {
      // Node has reported `family` as both the string 'IPv6' and the number 6
      // across versions; accept either.
      if (info.family === 'IPv6' || (info.family as unknown) === 6) {
        return true;
      }
    }
  }
  return false;
}

const registrationSecretFile = path.resolve(
  path.join(import.meta.dirname, '..', '..', 'registration_secret.txt'),
);

interface SynapseConfig {
  configDir: string;
  registrationSecret: string;
  // Synapse must be configured with its public_baseurl so we have to allocate a port & url at this stage
  baseUrl: string;
  port: number;
  host: string;
}

export interface SynapseInstance extends SynapseConfig {
  synapseId: string;
}

const synapses = new Map<string, SynapseInstance>();
const dynamicHostPortStartAttempts = 5;

function findAvailablePort(preferred?: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let server = net.createServer();

    server.on('error', (error: NodeJS.ErrnoException) => {
      server.close();
      if (preferred != null && error.code === 'EADDRINUSE') {
        findAvailablePort(undefined).then(resolve, reject);
        return;
      }
      reject(error);
    });

    server.listen(preferred ?? 0, '127.0.0.1', () => {
      let address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() =>
          reject(new Error('Could not determine available port')),
        );
        return;
      }
      let { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

function randB64Bytes(numBytes: number): string {
  return crypto.randomBytes(numBytes).toString('base64').replace(/=*$/, '');
}

function isPortBindError(error: unknown): boolean {
  let message = error instanceof Error ? error.message : String(error);
  return /address already in use|port is already allocated/i.test(message);
}

// The Google OIDC block is gated on env vars so a developer without a Google
// OAuth client can still run Synapse for unrelated work. When either env var is
// missing, the whole `# BEGIN_GOOGLE_OIDC ... # END_GOOGLE_OIDC` block is
// stripped — Synapse refuses to boot with an `oidc_providers` entry whose
// `client_id` is empty. When both are present, the secrets are interpolated.
export function applyGoogleOidcGating(
  hsYaml: string,
  clientId: string,
  clientSecret: string,
): string {
  if (clientId && clientSecret) {
    return hsYaml
      .replace(/{{GOOGLE_OAUTH_CLIENT_ID}}/g, clientId)
      .replace(/{{GOOGLE_OAUTH_CLIENT_SECRET}}/g, clientSecret);
  }
  return hsYaml.replace(/# BEGIN_GOOGLE_OIDC[\s\S]*?# END_GOOGLE_OIDC\n?/g, '');
}

// The test template carries a Google OIDC block pointed at
// navikt/mock-oauth2-server for the Playwright SSO suite. It is gated on
// `issuer` (set by the matrix global setup once the mock container is up) so
// every other suite — which never starts the mock — boots Synapse without a
// dangling provider whose discovery would never resolve.
export function applyTestOidcGating(
  hsYaml: string,
  issuer: string | undefined,
): string {
  if (issuer) {
    return hsYaml.replace(/{{MOCK_OAUTH2_ISSUER}}/g, issuer);
  }
  return hsYaml.replace(/# BEGIN_TEST_OIDC[\s\S]*?# END_TEST_OIDC\n?/g, '');
}

export async function cfgDirFromTemplate(
  template: string,
  dataDir?: string,
  options?: {
    publicBaseUrl?: string;
    host?: string;
    port?: number;
  },
): Promise<SynapseConfig> {
  const templateDir = path.join(import.meta.dirname, template);

  const stats = await fse.stat(templateDir);
  if (!stats?.isDirectory) {
    throw new Error(`No such template: ${template}`);
  }
  const configDir = dataDir
    ? dataDir
    : await fse.mkdtemp(path.join(os.tmpdir(), 'sf-test-synapse-'));

  // copy the contents of the template dir, omitting homeserver.yaml as we'll template that
  console.log(`Copy ${templateDir} -> ${configDir}`);
  await fse.copy(templateDir, configDir, {
    filter: (f) => path.basename(f) !== 'homeserver.yaml',
  });

  const registrationSecret = randB64Bytes(16);
  const macaroonSecret = randB64Bytes(16);
  const formSecret = randB64Bytes(16);

  const host = options?.host ?? '127.0.0.1';
  const port = options?.port ?? SYNAPSE_PORT;
  const baseUrl = options?.publicBaseUrl ?? `http://${host}:${port}`;

  // now copy homeserver.yaml, applying substitutions
  console.log(`Gen ${path.join(templateDir, 'homeserver.yaml')}`);
  let hsYaml = await fse.readFile(
    path.join(templateDir, 'homeserver.yaml'),
    'utf8',
  );
  hsYaml = hsYaml.replace(/{{REGISTRATION_SECRET}}/g, registrationSecret);
  hsYaml = hsYaml.replace(/{{MACAROON_SECRET_KEY}}/g, macaroonSecret);
  hsYaml = hsYaml.replace(/{{FORM_SECRET}}/g, formSecret);
  hsYaml = hsYaml.replace(/{{PUBLIC_BASEURL}}/g, baseUrl);

  hsYaml = applyGoogleOidcGating(
    hsYaml,
    process.env.GOOGLE_OAUTH_CLIENT_ID ?? '',
    process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '',
  );

  hsYaml = applyTestOidcGating(hsYaml, process.env.MOCK_OAUTH2_ISSUER);

  await fse.writeFile(path.join(configDir, 'homeserver.yaml'), hsYaml);

  // now generate a signing key (we could use synapse's config generation for
  // this, or we could just do this...)
  // This assumes the homeserver.yaml specifies the key in this location
  const signingKey = randB64Bytes(32);
  console.log(`Gen ${path.join(templateDir, 'localhost.signing.key')}`);
  await fse.writeFile(
    path.join(configDir, 'localhost.signing.key'),
    `ed25519 x ${signingKey}`,
  );

  return {
    port,
    host,
    baseUrl,
    configDir,
    registrationSecret,
  };
}

// Start a synapse instance: the template must be the name of one of the
// templates in the docker/synapse directory
interface StartOptions {
  template?: string;
  dataDir?: string;
  containerName?: string;
  suppressRegistrationSecretFile?: true;
  dynamicHostPort?: true;
}

// Build the `docker run` flags for a Synapse container.
//
// The container joins the shared `boxel` network without asking for an address
// on it. Everything that reaches Synapse addresses it either from the host
// through the published port, or — for containers on the same network, such as
// a local Prometheus scraping `boxel-synapse:9001` — by container name through
// Docker's embedded DNS. Requesting a fixed address instead would make startup
// depend on how many other containers already hold the low addresses in the
// range, since Docker hands those out in the order containers join.
export function synapseDockerParams(args: {
  configDir: string;
  hostPort: number;
  runAsRoot?: boolean;
}): string[] {
  return [
    '--rm',
    '-v',
    `${args.configDir}:/data`,
    '-v',
    `${path.join(import.meta.dirname, 'templates')}:/custom/templates/`,
    '-v',
    `${path.join(import.meta.dirname, 'modules')}:/custom/modules/`,
    '-e',
    'PYTHONPATH=/custom/modules',
    // When the host runs as root (e.g. the Claude-web cloud VM), the synapse
    // image would otherwise drop privileges to its default uid 991, which
    // cannot write the root-owned config dir mounted at /data. Telling the
    // image to stay as root (UID/GID=0) keeps it able to create media_store.
    ...(args.runAsRoot ? ['-e', 'UID=0', '-e', 'GID=0'] : []),
    '-p',
    `${args.hostPort}:8008/tcp`,
    '--network=boxel',
  ];
}

function dockerCapture(params: string[]): Promise<string> {
  return new Promise((resolve) => {
    childProcess.execFile(
      'docker',
      params,
      { encoding: 'utf8' },
      (err, stdout) => resolve(err ? '' : stdout.trim()),
    );
  });
}

// Docker reports a refused bind as "Address already in use" without saying
// which address it means, which reads equally like the published host port and
// like the container's address on the network. Name the port and whatever
// already publishes it, so the message points at something actionable.
export async function describeHostPortConflict(
  hostPort: number,
): Promise<string> {
  let holders = await dockerCapture([
    'ps',
    '--filter',
    `publish=${hostPort}`,
    '--format',
    '{{.Names}} ({{.Image}})',
  ]);
  if (holders) {
    return (
      `Host port ${hostPort} is already published by: ` +
      `${holders.split('\n').join(', ')}.`
    );
  }
  return (
    `Host port ${hostPort} is already bound, and no container publishes it — ` +
    `a process on this host is listening on it.`
  );
}

// Synapse containers are named after the temp config directory they are given,
// so a run killed before its teardown leaves one behind under a name no later
// run can predict — which rules out clearing it by name.
//
// What separates debris from a live tenant is the port. A container still
// publishing the fixed Synapse port is holding the one this launch is about to
// claim; a harness that chose its port dynamically is deliberately sharing the
// host (it starts with `stopExisting: false` precisely so it can coexist with a
// dev Synapse) and is left alone. So the sweep is the intersection: this
// harness's own containers, on the port being claimed.
export function abandonedSynapseQuery(hostPort: number): string[] {
  return [
    'ps',
    '-q',
    '--filter',
    `name=${TEST_SYNAPSE_CONTAINER_PREFIX}`,
    '--filter',
    `publish=${hostPort}`,
  ];
}

async function removeAbandonedTestSynapseContainers(
  hostPort: number,
): Promise<void> {
  let ids = await dockerCapture(abandonedSynapseQuery(hostPort));
  let containerIds = ids.split(/\s+/).filter(Boolean);
  if (containerIds.length === 0) {
    return;
  }
  await dockerCapture(['rm', '-f', ...containerIds]);
}

async function resolveHostPort(synapseId: string): Promise<number> {
  let { execSync } = await import('child_process');
  let portOutput = execSync(`docker port ${synapseId} 8008/tcp`, {
    encoding: 'utf-8',
  }).trim();
  let firstLine = portOutput.split('\n')[0];
  return parseInt(firstLine.split(':').pop()!, 10);
}

export async function synapseStart(
  opts?: StartOptions,
  stopExisting = true,
): Promise<SynapseInstance> {
  let useDynamicHostPort = Boolean(
    isEnvironmentMode() || opts?.dynamicHostPort,
  );
  if (stopExisting) {
    // Stop the main server if it's running
    let defaultContainerName = getSynapseContainerName();
    let stopPromises = [dockerStop({ containerId: defaultContainerName })];
    for (const [id, _synapse] of synapses) {
      // Stop any other synapses that are running
      stopPromises.push(synapseStop(id));
    }
    await Promise.allSettled(stopPromises);
    // Only a fixed-port launch has a port to be blocked out of: the dynamic
    // path picks one nothing holds.
    if (!useDynamicHostPort) {
      await removeAbandonedTestSynapseContainers(SYNAPSE_PORT);
    }
  }
  await dockerCreateNetwork({ networkName: 'boxel' });

  let hostPort = SYNAPSE_PORT;
  let synCfg!: SynapseConfig;
  let containerName!: string;
  let synapseId!: string;
  let attempts = useDynamicHostPort ? dynamicHostPortStartAttempts : 1;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    hostPort = useDynamicHostPort ? await findAvailablePort() : SYNAPSE_PORT;
    synCfg = await cfgDirFromTemplate(opts?.template ?? 'test', opts?.dataDir, {
      port: hostPort,
      publicBaseUrl: `http://localhost:${hostPort}`,
    });
    // On a host without IPv6, rewrite the generated config's listeners to bind
    // IPv4 only — synapse is reached via localhost:8008 in dev regardless, so
    // dropping the dual-stack "::" bind is transparent there but lets synapse
    // start at all. Hosts with IPv6 keep the template's "::" untouched.
    if (!hostHasIPv6()) {
      let hsYaml = path.join(synCfg.configDir, 'homeserver.yaml');
      let contents = await fse.readFile(hsYaml, 'utf8');
      let patched = contents.replace(
        /bind_addresses:\s*\[\s*"::"\s*\]/g,
        'bind_addresses: ["0.0.0.0"]',
      );
      if (patched !== contents) {
        await fse.writeFile(hsYaml, patched);
      }
    }
    containerName =
      opts?.containerName ||
      (isEnvironmentMode()
        ? getSynapseContainerName()
        : path.basename(synCfg.configDir));
    console.log(
      `Starting synapse with config dir ${synCfg.configDir} in container ${containerName}...`,
    );

    let dockerParams = synapseDockerParams({
      configDir: synCfg.configDir,
      hostPort,
      runAsRoot: process.getuid?.() === 0,
    });

    try {
      synapseId = await dockerRun({
        // If you bump this version, also update the GHCR mirror so CI keeps
        // caching it (it must match the version pinned there):
        // .github/workflows/mirror-test-images.yml and
        // .github/actions/warm-test-images/action.yml.
        image: 'matrixdotorg/synapse:v1.126.0',
        containerName,
        dockerParams,
        applicationParams: ['run'],
        runAsUser: true,
      });
      break;
    } catch (error) {
      if (
        !useDynamicHostPort ||
        !isPortBindError(error) ||
        attempt === attempts
      ) {
        throw isPortBindError(error)
          ? new Error(
              `Could not start Synapse: ${await describeHostPortConflict(hostPort)} ` +
                `Docker reported: ${error instanceof Error ? error.message : String(error)}`,
            )
          : error;
      }
      console.warn(
        `Synapse host port ${hostPort} was claimed before Docker bound it; retrying (${attempt}/${attempts})...`,
      );
      if (!opts?.dataDir) {
        await fse.remove(synCfg.configDir);
      }
    }
  }

  console.log(`Started synapse with id ${synapseId} on port ${hostPort}`);

  // Await Synapse healthcheck
  await dockerExec({
    containerId: synapseId,
    params: [
      'curl',
      '--connect-timeout',
      '30',
      '--retry',
      '30',
      '--retry-delay',
      '1',
      '--retry-all-errors',
      '--silent',
      `http://localhost:8008/health`,
    ],
  });

  if (useDynamicHostPort) {
    let resolvedPort = await resolveHostPort(synapseId);
    if (resolvedPort !== hostPort) {
      throw new Error(
        `Synapse started on unexpected host port ${resolvedPort}; expected ${hostPort}`,
      );
    }
    console.log(`Synapse dynamic host port: ${hostPort}`);
  }

  if (isEnvironmentMode()) {
    registerSynapseWithTraefik(hostPort);
  }

  const synapse: SynapseInstance = {
    synapseId,
    ...synCfg,
    host: '127.0.0.1',
    port: hostPort,
    baseUrl: `http://localhost:${hostPort}`,
  };
  synapses.set(synapseId, synapse);

  function cleanupRegistrationSecret() {
    fse.removeSync(registrationSecretFile);
  }

  cleanupRegistrationSecret();
  if (!opts?.suppressRegistrationSecretFile) {
    fse.writeFileSync(registrationSecretFile, synapse.registrationSecret);
    process.on('exit', cleanupRegistrationSecret);
    process.on('SIGINT', cleanupRegistrationSecret);
  }
  return synapse;
}

export async function synapseStop(id: string): Promise<void> {
  const synCfg = synapses.get(id);

  if (!synCfg) throw new Error('Unknown synapse ID');

  const synapseLogsPath = path.join('playwright', 'synapselogs', id);
  await fse.ensureDir(synapseLogsPath);

  await dockerLogs({
    containerId: id,
    stdoutFile: path.join(synapseLogsPath, 'stdout.log'),
    stderrFile: path.join(synapseLogsPath, 'stderr.log'),
  });

  await dockerStop({
    containerId: id,
  });

  await fse.remove(synCfg.configDir);
  synapses.delete(id);
  console.log(`Stopped synapse id ${id}.`);
}

export interface Credentials {
  accessToken: string;
  userId: string;
  deviceId: string;
  homeServer: string;
}

export async function registerUser(
  synapse: SynapseInstance,
  username: string,
  password: string,
  admin = false,
  displayName?: string,
): Promise<Credentials> {
  const url = `${getSynapseURL(synapse)}/_synapse/admin/v1/register`;
  const context = await request.newContext({ baseURL: url });
  const { nonce } = await (await context.get(url)).json();
  const mac = admin
    ? crypto
        .createHmac('sha1', synapse.registrationSecret)
        .update(`${nonce}\0${username}\0${password}\0admin`)
        .digest('hex')
    : crypto
        .createHmac('sha1', synapse.registrationSecret)
        .update(`${nonce}\0${username}\0${password}\0notadmin`)
        .digest('hex');
  const response = await (
    await context.post(url, {
      data: {
        nonce,
        username,
        password,
        mac,
        admin,
        displayname: displayName,
      },
    })
  ).json();

  // Set the test realm in the user's account data
  // so it appears in the list of available realms
  if (username.startsWith('user')) {
    await updateAccountData(
      response.user_id,
      response.access_token,
      APP_BOXEL_REALMS_EVENT_TYPE,
      JSON.stringify({
        realms: [`${appURL}/`],
      }),
    );
  }

  return {
    homeServer: response.home_server,
    accessToken: response.access_token,
    userId: response.user_id,
    deviceId: response.device_id,
  };
}

export async function loginUser(
  username: string,
  password: string,
  matrixURL?: string,
): Promise<Credentials> {
  let url = matrixURL
    ? `${matrixURL}/_matrix/client/r0/login`
    : `${getSynapseURL()}/_matrix/client/r0/login`;
  let response = await (
    await fetch(url, {
      method: 'POST',
      body: JSON.stringify({
        type: 'm.login.password',
        user: username,
        password,
      }),
    })
  ).json();
  return {
    homeServer: response.home_server,
    accessToken: response.access_token,
    userId: response.user_id,
    deviceId: response.device_id,
  };
}

export async function updateDisplayName(
  userId: string,
  accessToken: string,
  newDisplayName: string,
): Promise<void> {
  let response = await fetch(
    `${getSynapseURL()}/_matrix/client/v3/profile/${userId}/displayname`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ displayname: newDisplayName }),
    },
  );

  console.log(
    `Received: ${response.status}, ${response.statusText}, ${JSON.stringify(
      await response.json(),
    )}`,
  );

  return;
}

export async function createRegistrationToken(
  adminAccessToken: string,
  registrationToken: string,
  usesAllowed = 1000,
) {
  let res = await fetch(
    `${getSynapseURL()}/_synapse/admin/v1/registration_tokens/new`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminAccessToken}`,
      },
      body: JSON.stringify({
        token: registrationToken,
        uses_allowed: usesAllowed,
      }),
    },
  );
  if (!res.ok) {
    let body = await res.text();
    // Registering is idempotent: an earlier (possibly partial) run may have
    // already created this token, and Synapse rejects duplicates with a 400.
    if (res.status === 400 && body.includes('Token already exists')) {
      return;
    }
    throw new Error(
      `could not create registration token: ${res.status} - ${body}`,
    );
  }
}

export interface UpdateUserOptions {
  password?: string;
  displayname?: string;
  avatar_url?: string;
  emailAddresses?: string[];
  matrixURL?: string;
}

export async function updateUser(
  adminAccessToken: string,
  userId: string,
  {
    password,
    displayname,
    avatar_url,
    emailAddresses,
    matrixURL,
  }: UpdateUserOptions,
) {
  let url = matrixURL
    ? `${matrixURL}/_synapse/admin/v2/users/${userId}`
    : `${getSynapseURL()}/_synapse/admin/v2/users/${userId}`;
  let res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${adminAccessToken}`,
    },
    body: JSON.stringify({
      ...(password ? { password } : {}),
      ...(displayname ? { displayname } : {}),
      ...(avatar_url ? { avatar_url } : {}),
      ...(emailAddresses
        ? {
            threepids: emailAddresses.map((address) => ({
              medium: 'email',
              address,
            })),
          }
        : {}),
    }),
  });
  if (!res.ok) {
    throw new Error(
      `could not update user: ${res.status} - ${await res.text()}`,
    );
  }
}

export interface SynapseExternalId {
  auth_provider: string;
  external_id: string;
}

// Reads the admin API's view of an account, whose payload includes the
// `external_ids` rows linking it to SSO identities. That linkage is otherwise
// invisible from the client API, and it is the value an OIDC sign-in is matched
// against — so it is what a test has to inspect to know *which* identity a
// session was established for, rather than merely that some session was.
export async function getUserExternalIds(
  adminAccessToken: string,
  userId: string,
  matrixURL?: string,
): Promise<SynapseExternalId[]> {
  let url = `${matrixURL ?? getSynapseURL()}/_synapse/admin/v2/users/${userId}`;
  let res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${adminAccessToken}`,
    },
  });
  if (!res.ok) {
    throw new Error(`could not get user: ${res.status} - ${await res.text()}`);
  }
  let { external_ids: externalIds } = (await res.json()) as {
    external_ids?: SynapseExternalId[];
  };
  return externalIds ?? [];
}

export async function updateAccountData(
  userId: string,
  accessToken: string,
  type: string,
  data: string,
): Promise<void> {
  let response = await fetch(
    `${getSynapseURL()}/_matrix/client/v3/user/${userId}/account_data/${type}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: data,
    },
  );

  console.log(
    `updateAccountData result for ${type}: ${response.status}, ${
      response.statusText
    }, ${JSON.stringify(await response.json())}`,
  );
}

export async function getAccountData<T>(
  userId: string,
  accessToken: string,
  type: string,
): Promise<T> {
  let response = await fetch(
    `${getSynapseURL()}/_matrix/client/v3/user/${userId}/account_data/${type}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
  let json = await response.json();
  return json as T;
}

export async function getJoinedRooms(accessToken: string) {
  let response = await fetch(
    `${getSynapseURL()}/_matrix/client/v3/joined_rooms`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
  let { joined_rooms } = (await response.json()) as { joined_rooms: string[] };
  return joined_rooms;
}

export async function getRoomStateEventType(
  accessToken: string,
  roomId: string,
  eventType: string,
) {
  let response = await fetch(
    `${getSynapseURL()}/_matrix/client/v3/rooms/${roomId}/state/${eventType}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
  return await response.json();
}

export async function getRoomName(accessToken: string, roomId: string) {
  return await getRoomStateEventType(accessToken, roomId, 'm.room.name');
}

export async function getRoomRetentionPolicy(
  accessToken: string,
  roomId: string,
) {
  return await getRoomStateEventType(accessToken, roomId, 'm.room.retention');
}

export async function getRoomMembers(roomId: string, accessToken: string) {
  let response = await fetch(
    `${getSynapseURL()}/_matrix/client/v3/rooms/${roomId}/joined_members`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
  return await response.json();
}

export async function sync(accessToken: string) {
  let response = await fetch(`${getSynapseURL()}/_matrix/client/v3/sync`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  return await response.json();
}

interface MessageOptions {
  direction?: 'forward' | 'backward';
  pageSize: number;
}
const DEFAULT_PAGE_SIZE = 50;

export async function getAllRoomEvents(
  roomId: string,
  accessToken: string,
  opts?: MessageOptions,
) {
  let messages: MessageEvent[] = [];
  let from: string | undefined;

  do {
    let response = await fetch(
      `${getSynapseURL()}/_matrix/client/v3/rooms/${roomId}/messages?dir=${
        opts?.direction ? opts.direction.slice(0, 1) : 'f'
      }&limit=${opts?.pageSize ?? DEFAULT_PAGE_SIZE}${
        from ? '&from=' + from : ''
      }`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );
    let { chunk, end } = await response.json();
    from = end;
    let events: MessageEvent[] = chunk;
    messages.push(...events);
  } while (from);
  return messages;
}

interface MessageEvent {
  type: 'm.room.message';
  content: {
    'm.relates_to'?: {
      rel_type: string;
      event_id: string;
    };
    msgtype: string;
    format: string;
    body: string;
    formatted_body?: string;
    data?: any;
  };
  unsigned: {
    age: number;
    transaction_id: string;
    prev_content?: any;
    prev_sender?: string;
  };
  sender: string;
  origin_server_ts: number;
  event_id: string;
  room_id: string;
}

export async function putEvent(
  accessToken: string,
  roomId: string,
  eventType: string,
  txnId: string,
  body: any,
) {
  let url = `${getSynapseURL()}/_matrix/client/v3/rooms/${roomId}/send/${eventType}/${txnId}`;
  let res = await await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });
  if (res.ok) {
    let r = await res.json();
    return r;
  }
  return;
}
