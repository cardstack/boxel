import { startHostedModels } from './hosted-models.ts';
import { parsePublishedProxyPolicies } from '../../realm-server/lib/published-proxy-policy.ts';
import { createHmac } from 'node:crypto';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { once } from 'node:events';
import path from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createLocalSecretsStore } from '../../realm-server/lib/local-secrets.ts';
import { initializeLocalPostgres } from '../../realm-server/lib/local-postgres.ts';
import { ensureLocalMatrixAccounts } from '../../realm-server/lib/local-matrix.ts';
import { ensureLocalPublicRealmReads } from '../../realm-server/lib/local-public-realms.ts';
import {
  createHostedIdentityVerifier,
  createLocalIdentityVerifier,
} from '../../realm-server/lib/hosted-identity.ts';
import { createLocalIdentityStore } from '../../realm-server/lib/local-identity-store.ts';
import { createLocalIdentityBroker } from '../../realm-server/lib/local-identity-broker.ts';
import { startLocalIdentityServer } from '../../realm-server/lib/local-identity-server.ts';
import { createLocalHostedLogin } from '../../realm-server/lib/local-hosted-login.ts';
import { createLocalBrowserLogin } from '../../realm-server/lib/local-browser-login.ts';
import { preparePostgresSocketDirectory } from './postgres-socket.ts';

import type {
  ConfiguredBoxelOptions,
  LocalBoxelOptions,
  NativeRuntimeHandle,
  NativeService,
} from './contracts.ts';
export type * from './contracts.ts';
export { startManagedEnvironments } from './managed-environments.ts';
export { prepareBundledBoxelProfile } from './bundled-profile.ts';

interface Profile {
  dataDirectory: string;
  isolation: {
    name: string;
    gatewayPort: number;
    controlPort: number;
    modelsPort: number;
  };
  postgresBin: string;
  tuwunelBinary: string;
  chromeBinary: string;
  modelBaseURL: string;
  modelIds: string[];
  titleModel: string;
  ollama: { binary: string; modelsDirectory: string } | null;
  hostedIdentityIssuers: Record<string, string>;
  publishedProxyPolicies: ReturnType<typeof parsePublishedProxyPolicies>;
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
async function readProfile(file: string): Promise<Profile> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    throw new Error('Cannot read native Boxel profile');
  }
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    Object.keys(value).some(
      (key) =>
        ![
          'schemaVersion',
          'dataDirectory',
          'postgresBin',
          'tuwunelBinary',
          'chromeBinary',
          'modelBaseURL',
          'modelIds',
          'titleModel',
          'ollama',
          'hostedIdentityIssuers',
          'publishedProxyPolicies',
          'isolation',
        ].includes(key),
    )
  )
    throw new Error('Invalid native Boxel profile');
  let paths = [
    'dataDirectory',
    'postgresBin',
    'tuwunelBinary',
    'chromeBinary',
  ] as const;
  for (let key of paths)
    if (typeof value[key] !== 'string' || !path.isAbsolute(value[key]))
      throw new Error(
        'Native Boxel profile requires absolute asset and data paths',
      );
  if (
    typeof value.dataDirectory !== 'string' ||
    typeof value.postgresBin !== 'string' ||
    typeof value.tuwunelBinary !== 'string' ||
    typeof value.chromeBinary !== 'string'
  )
    throw new Error('Invalid native asset paths');
  if (
    !Array.isArray(value.modelIds) ||
    value.modelIds.length === 0 ||
    !value.modelIds.every(
      (id): id is string => typeof id === 'string' && id.length > 0,
    ) ||
    typeof value.titleModel !== 'string' ||
    !value.modelIds.includes(value.titleModel)
  )
    throw new Error(
      'Configure local model IDs and a title model in the native Boxel profile',
    );
  let ollama: Profile['ollama'] = null;
  const configuredIssuers =
    value.hostedIdentityIssuers === undefined
      ? {
          'boxel.ai': 'https://matrix.boxel.ai/',
        }
      : value.hostedIdentityIssuers;
  if (
    !record(configuredIssuers) ||
    !Object.values(configuredIssuers).every(
      (endpoint) => typeof endpoint === 'string',
    )
  )
    throw new Error('Invalid hosted identity issuer configuration');
  const hostedIdentityIssuers: Record<string, string> = {};
  for (const [serverName, endpoint] of Object.entries(configuredIssuers)) {
    if (typeof endpoint !== 'string')
      throw new Error('Invalid hosted identity issuer configuration');
    hostedIdentityIssuers[serverName] = endpoint;
  }
  createHostedIdentityVerifier({
    BOXEL_HOSTED_IDENTITY_ISSUERS: JSON.stringify(hostedIdentityIssuers),
  });
  let endpoint: string;
  if (value.ollama !== undefined) {
    if (
      value.modelBaseURL !== undefined ||
      !record(value.ollama) ||
      Object.keys(value.ollama).some(
        (key) => !['binary', 'modelsDirectory'].includes(key),
      ) ||
      typeof value.ollama.binary !== 'string' ||
      !path.isAbsolute(value.ollama.binary) ||
      typeof value.ollama.modelsDirectory !== 'string' ||
      !path.isAbsolute(value.ollama.modelsDirectory)
    )
      throw new Error(
        'Managed Ollama requires absolute binary and modelsDirectory paths, without modelBaseURL',
      );
    ollama = {
      binary: value.ollama.binary,
      modelsDirectory: value.ollama.modelsDirectory,
    };
    endpoint = `http://127.0.0.1:${await port()}/v1`;
  } else {
    if (typeof value.modelBaseURL !== 'string')
      throw new Error('Configure managed Ollama or a local modelBaseURL');
    endpoint = value.modelBaseURL;
  }
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error('Invalid local model endpoint');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      'Local model endpoint must not contain credentials, query or fragment',
    );
  const isolation =
    value.isolation === undefined
      ? {
          name: 'default',
          gatewayPort: 4242,
          controlPort: 4243,
          modelsPort: 4247,
        }
      : value.isolation;
  if (
    !record(isolation) ||
    Object.keys(isolation).some(
      (key) =>
        !['name', 'gatewayPort', 'controlPort', 'modelsPort'].includes(key),
    ) ||
    typeof isolation.name !== 'string' ||
    !/^[a-z][a-z0-9-]{0,47}$/.test(isolation.name) ||
    !['gatewayPort', 'controlPort', 'modelsPort'].every(
      (key) =>
        Number.isSafeInteger(isolation[key]) &&
        Number(isolation[key]) >= 1024 &&
        Number(isolation[key]) <= 65535,
    ) ||
    new Set([
      isolation.gatewayPort,
      isolation.controlPort,
      isolation.modelsPort,
    ]).size !== 3
  )
    throw new Error('Invalid native environment isolation');
  return {
    dataDirectory: value.dataDirectory,
    isolation: {
      name: isolation.name,
      gatewayPort: Number(isolation.gatewayPort),
      controlPort: Number(isolation.controlPort),
      modelsPort: Number(isolation.modelsPort),
    },
    postgresBin: value.postgresBin,
    tuwunelBinary: value.tuwunelBinary,
    chromeBinary: value.chromeBinary,
    modelBaseURL: url.href,
    modelIds: value.modelIds,
    titleModel: value.titleModel,
    ollama,
    hostedIdentityIssuers,
    publishedProxyPolicies: parsePublishedProxyPolicies(
      value.publishedProxyPolicies,
    ),
  };
}
async function port(): Promise<number> {
  let server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('No local port available');
  let result = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return result;
}

// All Boxel policy, account provisioning and stack definitions live here. The
// Desktop dependency injects only its OS encryption and generic process runner.
export async function startLocalBoxel(
  options: LocalBoxelOptions,
): Promise<NativeRuntimeHandle> {
  let profile = await readProfile(options.profileFile);
  let root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../..',
  );
  let realmPackage = path.join(root, 'packages/realm-server');
  let hostDist = path.join(root, 'packages/host/dist');
  let iconsDist = path.join(root, 'packages/boxel-icons/dist');
  for (const file of [
    path.join(hostDist, 'index.html'),
    path.join(profile.postgresBin, 'postgres'),
    profile.tuwunelBinary,
    profile.chromeBinary,
    ...(profile.ollama ? [profile.ollama.binary] : []),
  ]) {
    if (!(await stat(file)).isFile())
      throw new Error('A required native runtime asset is unavailable');
  }
  await mkdir(profile.dataDirectory, { recursive: true, mode: 0o700 });
  const secrets = await createLocalSecretsStore(
    {
      BOXEL_LOCAL_SECRETS_PROVIDER: 'keychain',
      BOXEL_LOCAL_SECRETS_DIR: path.join(profile.dataDirectory, 'secrets'),
    },
    options.encryption,
  ).loadOrCreate();
  let pgData = path.join(profile.dataDirectory, 'postgres');
  let pgSocket = await preparePostgresSocketDirectory(profile.dataDirectory);
  await initializeLocalPostgres({
    binaryDirectory: profile.postgresBin,
    dataDirectory: pgData,
    password: secrets.postgresPassword,
  });
  let [
    pgPort,
    matrixPort,
    hostPort,
    iconsPort,
    renderPort,
    workerPort,
    realmPort,
    referencePort,
  ] = await Promise.all(Array.from({ length: 8 }, () => port()));
  let matrixURL = `http://127.0.0.1:${matrixPort}/`;
  const { name, gatewayPort, controlPort, modelsPort } = profile.isolation;
  let matrixServerName = `${name}.boxel.localhost`;
  let realmOrigin = `http://realm.${matrixServerName}:${gatewayPort}`;
  let appOrigin = `http://app.${matrixServerName}:${gatewayPort}`;
  let realmBackend = `http://127.0.0.1:${realmPort}`;
  let publicReferenceRealms = ['catalog', 'skills', 'openrouter', 'pretui'].map(
    (name) => `https://app.boxel.ai/${name}/`,
  );
  let publicReferenceEnvironment = {
    BOXEL_PUBLIC_REFERENCE_CACHE_URL: `http://127.0.0.1:${referencePort}/`,
    BOXEL_PUBLIC_REFERENCE_REALMS: JSON.stringify(publicReferenceRealms),
  };
  let matrixConfig = path.join(profile.dataDirectory, 'tuwunel.toml');
  await writeFile(
    matrixConfig,
    `[global]\nserver_name = "${matrixServerName}"\ndatabase_path = ${JSON.stringify(path.join(profile.dataDirectory, 'matrix'))}\naddress = ["127.0.0.1"]\nport = ${matrixPort}\nallow_federation = false\ndns_servers = ["127.0.0.1"]\nallow_registration = false\nregistration_shared_secret = "${secrets.matrixRegistrationSecret}"\nlog = "warn"\n[global.jwt]\nenable = true\nkey = "${secrets.matrixJwtSecret}"\nrequire_exp = true\nissuer = ["boxel-local"]\naudience = ["boxel-local-matrix"]\n`,
    { mode: 0o600 },
  );
  let environment: Record<string, string> = {
    BOXEL_SECRET_IDENTITY_BROKER: createHmac(
      'sha256',
      secrets.realmServerSecretSeed,
    )
      .update('boxel-local-identity-broker-v1')
      .digest('hex'),
    BOXEL_SECRET_POSTGRES: secrets.postgresPassword,
    BOXEL_SECRET_REALM_SERVER: secrets.realmServerSecretSeed,
    BOXEL_SECRET_REALM: secrets.realmSecretSeed,
    BOXEL_SECRET_MATRIX_REGISTRATION: secrets.matrixRegistrationSecret,
    BOXEL_SECRET_AI_BOT: secrets.aiBotPassword,
    BOXEL_SECRET_AI_DELEGATION: createHmac(
      'sha256',
      secrets.realmServerSecretSeed,
    )
      .update('boxel-local-ai-delegation-v1')
      .digest('hex'),
    BOXEL_SECRET_DATA_KEY: secrets.dataKey,
    BOXEL_SECRET_GRAFANA: createHmac('sha256', secrets.realmServerSecretSeed)
      .update('boxel-local-grafana-v1')
      .digest('hex'),
  };
  const pgEnv = {
    PGHOST: pgSocket,
    PGPORT: String(pgPort),
    PGUSER: 'postgres',
    PGDATABASE: 'postgres',
    PG_POOL_MAX: '8',
  };
  const pgReferences = { PGPASSWORD: 'BOXEL_SECRET_POSTGRES' };
  const realmReferences = {
    ...pgReferences,
    REALM_SERVER_SECRET_SEED: 'BOXEL_SECRET_REALM_SERVER',
    REALM_SECRET_SEED: 'BOXEL_SECRET_REALM',
    MATRIX_REGISTRATION_SHARED_SECRET: 'BOXEL_SECRET_MATRIX_REGISTRATION',
    GRAFANA_SECRET: 'BOXEL_SECRET_GRAFANA',
    SECRETS_LOCAL_DATA_KEY: 'BOXEL_SECRET_DATA_KEY',
  };
  const telemetryEnvironment = {
    REALM_SENTRY_DSN: '',
    SENTRY_DSN: '',
  };
  const common = {
    ASSETS_URL_OVERRIDE: `${appOrigin}/`,
    PUBLISHED_REALM_BOXEL_SPACE_BASE_URL: `${realmOrigin}/sites/`,
    BOXEL_PUBLISHED_PROXY_POLICIES: JSON.stringify(
      profile.publishedProxyPolicies,
    ),
    ...telemetryEnvironment,
    BOXEL_ERROR_DETAILS: 'redacted',
    BOXEL_ERROR_PRIVATE_PATH_PREFIXES: JSON.stringify(
      [
        root,
        profile.dataDirectory,
        homedir(),
        tmpdir(),
        await realpath(tmpdir()),
        profile.postgresBin,
        path.dirname(profile.chromeBinary),
        path.dirname(profile.tuwunelBinary),
      ].flatMap((prefix) =>
        prefix.startsWith('/private/')
          ? [prefix, prefix.slice('/private'.length)]
          : [prefix],
      ),
    ),
    ...publicReferenceEnvironment,
    ELECTRON_RUN_AS_NODE: '1',
    NODE_NO_WARNINGS: '1',
    NODE_ENV: 'development',
    BOXEL_LOCAL_REALM_SERVER_URL: `${realmOrigin}/`,
    MATRIX_URL: matrixURL,
    MATRIX_SERVER_NAME: matrixServerName,
    REALM_SERVER_MATRIX_USERNAME: 'realm_server',
    LOW_CREDIT_THRESHOLD: '2000',
    BOXEL_TRUST_FORWARDED_URL: 'true',
    BOXEL_NATIVE_RUNTIME_URL: `http://127.0.0.1:${controlPort}/`,
    BOXEL_NATIVE_MATRIX_PUBLIC_URL: `http://matrix.${matrixServerName}:${gatewayPort}/`,
    REALM_SERVER_SKIP_BOOTSTRAP_INDEX: 'true',
    ENABLE_FILE_WATCHER: 'true',
    LOG_LEVELS: '*=warn',
    ...pgEnv,
  };
  const service = (
    name: string,
    command: string,
    args: string[],
    env: Record<string, string>,
    envFrom: Record<string, string>,
    dependsOn: string[],
    readiness: NativeService['readiness'],
    stopSignal: NativeService['stopSignal'] = 'SIGTERM',
  ): NativeService => ({
    name,
    command,
    args,
    cwd: realmPackage,
    env,
    envFrom,
    dependsOn,
    readiness,
    stopSignal,
    stopTimeoutMs: 10_000,
  });
  const http = (listenPort: number): NativeService['readiness'] => ({
    kind: 'http',
    url: `http://127.0.0.1:${listenPort}/`,
    timeoutMs: 90_000,
    intervalMs: 250,
  });
  const assets = path.join(realmPackage, 'local/serve-assets.ts');
  const mounts = [
    {
      name: 'base',
      username: 'base_realm',
      dir: path.join(root, 'packages/base'),
    },
  ];
  const mappings = mounts.flatMap((mount) => [
    `--fromUrl=${realmOrigin}/${mount.name}/`,
    `--toUrl=${realmBackend}/${mount.name}/`,
  ]);
  mappings.push(
    '--fromUrl=https://cardstack.com/base/',
    `--toUrl=${realmBackend}/base/`,
    '--fromUrl=@cardstack/catalog/',
    '--toUrl=https://app.boxel.ai/catalog/',
    '--fromUrl=@cardstack/skills/',
    '--toUrl=https://app.boxel.ai/skills/',
    '--fromUrl=@cardstack/openrouter/',
    '--toUrl=https://app.boxel.ai/openrouter/',
    '--fromUrl=@cardstack/pretui/',
    '--toUrl=https://app.boxel.ai/pretui/',
  );
  const services: NativeService[] = [
    service(
      'public-references',
      options.electronPath,
      ['local/serve-public-references.ts'],
      {
        ELECTRON_RUN_AS_NODE: '1',
        ...publicReferenceEnvironment,
        BOXEL_PUBLIC_REFERENCE_CACHE_PORT: String(referencePort),
        BOXEL_PUBLIC_REFERENCE_SAVE_PUBLIC_SNAPSHOTS: 'true',
        BOXEL_PUBLIC_REFERENCE_CACHE_DIR: path.join(
          profile.dataDirectory,
          'public-reference-cache',
        ),
      },
      {},
      [],
      {
        kind: 'http',
        url: `http://127.0.0.1:${referencePort}/_health`,
        timeoutMs: 30_000,
        intervalMs: 250,
      },
    ),
    ...(profile.ollama
      ? [
          service(
            'ollama',
            profile.ollama.binary,
            ['serve'],
            {
              HOME: path.join(profile.dataDirectory, 'ollama-home'),
              OLLAMA_HOST: new URL(profile.modelBaseURL).host,
              OLLAMA_MODELS: profile.ollama.modelsDirectory,
              OLLAMA_NO_CLOUD: '1',
              OLLAMA_NUM_PARALLEL: '1',
              OLLAMA_MAX_LOADED_MODELS: '1',
              OLLAMA_CONTEXT_LENGTH: '65536',
            },
            {},
            [],
            {
              kind: 'http',
              url: `${new URL(profile.modelBaseURL).origin}/api/version`,
              timeoutMs: 60_000,
              intervalMs: 250,
            },
          ),
        ]
      : []),
    service(
      'postgres',
      path.join(profile.postgresBin, 'postgres'),
      [
        '-D',
        pgData,
        '-k',
        pgSocket,
        '-h',
        '127.0.0.1',
        '-p',
        String(pgPort),
        '-c',
        'max_connections=64',
        '-c',
        'shared_buffers=128MB',
      ],
      {},
      {},
      [],
      {
        kind: 'tcp',
        host: '127.0.0.1',
        port: pgPort,
        timeoutMs: 30_000,
        intervalMs: 250,
      },
      'SIGINT',
    ),
    service(
      'matrix',
      profile.tuwunelBinary,
      ['--config', matrixConfig],
      {},
      {},
      [],
      {
        kind: 'http',
        url: `${matrixURL}_matrix/client/versions`,
        timeoutMs: 60_000,
        intervalMs: 250,
      },
    ),
    service(
      'host',
      options.electronPath,
      [assets],
      {
        ELECTRON_RUN_AS_NODE: '1',
        BOXEL_ASSET_DIR: hostDist,
        BOXEL_ASSET_PORT: String(hostPort),
      },
      {},
      [],
      http(hostPort),
    ),
    service(
      'icons',
      options.electronPath,
      [assets],
      {
        ELECTRON_RUN_AS_NODE: '1',
        BOXEL_ASSET_DIR: iconsDist,
        BOXEL_ASSET_PORT: String(iconsPort),
      },
      {},
      [],
      {
        kind: 'tcp',
        host: '127.0.0.1',
        port: iconsPort,
        timeoutMs: 30_000,
        intervalMs: 250,
      },
    ),
    service(
      'prerender',
      options.electronPath,
      ['prerender/prerender-server.ts', `--port=${renderPort}`],
      {
        ...telemetryEnvironment,
        ELECTRON_RUN_AS_NODE: '1',
        NODE_NO_WARNINGS: '1',
        BOXEL_HOST_URL: appOrigin,
        PUPPETEER_EXECUTABLE_PATH: profile.chromeBinary,
        PRERENDER_CHROME_SANDBOX: 'true',
        PRERENDER_BROWSER_IDLE_TIMEOUT_MS: '60000',
        PRERENDER_MANAGER_URL: 'http://127.0.0.1:1',
        PRERENDER_PAGE_POOL_MIN: '2',
        PRERENDER_PAGE_POOL_MAX: '6',
        PRERENDER_PAGE_POOL_INITIAL: '4',
        LOG_LEVELS: '*=warn',
      },
      {},
      ['host', 'icons', 'public-references'],
      http(renderPort),
    ),
    service(
      'worker',
      options.electronPath,
      [
        'worker-manager.ts',
        `--port=${workerPort}`,
        '--migrateDB',
        '--allPriorityCount=4',
        '--highPriorityCount=1',
        `--matrixURL=${matrixURL}`,
        `--prerendererUrl=http://127.0.0.1:${renderPort}`,
        ...mappings,
      ],
      common,
      realmReferences,
      ['postgres', 'matrix', 'prerender'],
      http(workerPort),
    ),
    service(
      'realm-server',
      options.electronPath,
      [
        'main.ts',
        `--port=${realmPort}`,
        `--serverURL=${realmOrigin}/`,
        `--matrixURL=${matrixURL}`,
        `--realmsRootPath=${path.join(profile.dataDirectory, 'realms')}`,
        `--workerManagerUrl=http://127.0.0.1:${workerPort}`,
        `--prerendererUrl=http://127.0.0.1:${renderPort}`,
        `--distURL=http://127.0.0.1:${hostPort}/`,
        `--secureOriginURL=http://secure.${matrixServerName}:${gatewayPort}/secure`,
        `--secureOriginAppOrigin=${appOrigin}`,
        ...mounts.flatMap((mount) => [
          `--username=${mount.username}`,
          `--path=${mount.dir}`,
        ]),
        ...mappings,
      ],
      {
        ...common,
        // Vendor keys the stack's owner places here are sealed as system keys
        // at startup; see realm-server/lib/local-vendor-keys.ts.
        BOXEL_LOCAL_VENDOR_KEYS_DIR: path.join(
          profile.dataDirectory,
          'vendor-keys',
        ),
      },
      {
        ...realmReferences,
        AI_BOT_DELEGATION_SECRET: 'BOXEL_SECRET_AI_DELEGATION',
      },
      ['worker'],
      {
        kind: 'tcp',
        host: '127.0.0.1',
        port: realmPort,
        timeoutMs: 90_000,
        intervalMs: 250,
      },
    ),
    service(
      'ai-bot',
      options.electronPath,
      [path.join(root, 'packages/ai-bot/main.ts')],
      {
        ...common,
        AI_MODEL_PROVIDER: 'local',
        AI_MODEL_BASE_URL: profile.modelBaseURL,
        AI_MODEL_IDS: JSON.stringify(profile.modelIds),
        AI_TITLE_MODEL: profile.titleModel,
        DISABLE_MATRIX_JS_LOGGING: '1',
      },
      {
        ...pgReferences,
        BOXEL_AIBOT_PASSWORD: 'BOXEL_SECRET_AI_BOT',
        AI_BOT_DELEGATION_SECRET: 'BOXEL_SECRET_AI_DELEGATION',
      },
      ['realm-server', ...(profile.ollama ? ['ollama'] : [])],
      { kind: 'process', graceMs: 5_000 },
    ),
  ];
  await mkdir(path.join(profile.dataDirectory, 'ollama-home'), {
    recursive: true,
    mode: 0o700,
  });
  if (profile.ollama)
    await mkdir(profile.ollama.modelsDirectory, {
      recursive: true,
      mode: 0o700,
    });
  await mkdir(path.join(profile.dataDirectory, 'realms'), {
    recursive: true,
    mode: 0o700,
  });
  const routes = {
    [`app.${matrixServerName}`]: { target: `http://127.0.0.1:${hostPort}` },
    [`icons.${matrixServerName}`]: {
      target: `http://127.0.0.1:${iconsPort}`,
    },
    [`realm.${matrixServerName}`]: { target: realmBackend },
    [`secure.${matrixServerName}`]: { target: realmBackend },
    [`matrix.${matrixServerName}`]: { target: matrixURL },
    [`reference.${matrixServerName}`]: {
      target: `http://127.0.0.1:${referencePort}`,
    },
  };
  const identityStore = await createLocalIdentityStore({
    directory: path.join(profile.dataDirectory, 'secrets', 'identity'),
    encryption: options.encryption,
    stackId: name,
    localMatrixServerName: matrixServerName,
    hostedVerifier: createHostedIdentityVerifier({
      BOXEL_HOSTED_IDENTITY_ISSUERS: JSON.stringify(
        profile.hostedIdentityIssuers,
      ),
    }),
  });
  const identity = await startLocalIdentityServer({
    hostedLogin: createLocalHostedLogin({
      store: identityStore,
      hostedIssuers: profile.hostedIdentityIssuers,
      matrixURL,
      matrixServerName,
      matrixJwtSecret: secrets.matrixJwtSecret,
    }),
    broker: createLocalIdentityBroker({
      store: identityStore,
      localVerifier: createLocalIdentityVerifier({
        matrixURL,
        matrixServerName,
      }),
    }),
    secret: environment.BOXEL_SECRET_IDENTITY_BROKER,
    port: 0,
  });
  for (const nativeService of services) {
    if (!['realm-server', 'worker', 'prerender'].includes(nativeService.name))
      continue;
    nativeService.env.BOXEL_LOCAL_IDENTITY_BROKER_URL = identity.url;
    nativeService.envFrom.BOXEL_LOCAL_IDENTITY_BROKER_SECRET =
      'BOXEL_SECRET_IDENTITY_BROKER';
  }
  let models: Awaited<ReturnType<typeof startHostedModels>>;
  try {
    models = await startHostedModels({
      directory: profile.dataDirectory,
      port: modelsPort,
    });
  } catch (error) {
    await identity.stop();
    throw error;
  }
  if (models.provider === 'boxel') {
    const bot = services.find((service) => service.name === 'ai-bot')!;
    bot.env.AI_MODEL_PROVIDER = 'boxel';
    bot.env.AI_MODEL_BASE_URL = models.url;
    delete bot.env.AI_MODEL_IDS;
    delete bot.env.AI_TITLE_MODEL;
    bot.envFrom.AI_MODEL_API_KEY = 'BOXEL_SECRET_MODELS_PROXY';
    environment.BOXEL_SECRET_MODELS_PROXY = models.secret;
    bot.dependsOn = bot.dependsOn.filter((name) => name !== 'ollama');
    const index = services.findIndex((service) => service.name === 'ollama');
    if (index !== -1) services.splice(index, 1);
  }
  let runtime: NativeRuntimeHandle;
  try {
    runtime = await options.host.start({
      initialStack: 'default',
      controlPort,
      dataDirectory: profile.dataDirectory,
      manifest: {
        schemaVersion: 1,
        stacks: { default: { mode: 'local', url: appOrigin, services } },
        gateway: { port: gatewayPort, routes },
      },
      environment,
      createBrowserLoginToken: createLocalBrowserLogin({
        matrixURL,
        matrixServerName,
        matrixJwtSecret: secrets.matrixJwtSecret,
      }),
      async prepareService(_stack, name) {
        if (name === 'realm-server')
          await ensureLocalPublicRealmReads({
            host: pgSocket,
            port: pgPort,
            database: 'postgres',
            password: secrets.postgresPassword,
            realmURLs: mounts.map((mount) => `${realmOrigin}/${mount.name}/`),
            realmOwners: Object.fromEntries(
              mounts.map((mount) => [
                `${realmOrigin}/${mount.name}/`,
                `@${mount.username}:${matrixServerName}`,
              ]),
            ),
          });
        if (name === 'worker')
          await ensureLocalMatrixAccounts({
            matrixURL,
            serverName: matrixServerName,
            registrationSecret: secrets.matrixRegistrationSecret,
            realmSecretSeed: secrets.realmSecretSeed,
            systemUsernames: [
              'realm_server',
              ...mounts.map((mount) => mount.username),
            ],
            aiBotPassword: secrets.aiBotPassword,
          });
      },
    });
  } catch (error) {
    await models.stop();
    await identity.stop();
    throw error;
  }
  let stopping: Promise<void> | undefined;
  return {
    stop() {
      return (stopping ??= (async () => {
        try {
          await runtime.stop();
        } finally {
          await models.stop();
          await identity.stop();
        }
      })());
    },
  };
}

export async function startConfiguredBoxel(
  options: ConfiguredBoxelOptions,
): Promise<NativeRuntimeHandle | null> {
  let configured = options.environment.BOXEL_LOCAL_PROFILE;
  let profileFile =
    configured ?? path.join(options.userDataDirectory, 'boxel', 'profile.json');
  if (!path.isAbsolute(profileFile) || !profileFile.trim())
    throw new Error(
      'BOXEL_LOCAL_PROFILE must be an absolute native profile path',
    );
  if (configured === undefined) {
    try {
      await stat(profileFile);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        return null;
      throw error;
    }
  }
  return startLocalBoxel({
    profileFile,
    electronPath: options.electronPath,
    encryption: options.encryption,
    host: options.host,
  });
}
