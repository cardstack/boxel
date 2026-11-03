import type { NativeModelsView } from './contracts.ts';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import { ProfileManager } from '../../boxel-cli/src/lib/profile-manager.ts';
import { getRealmServerToken } from '../../boxel-cli/src/lib/auth.ts';
import {
  listStoredProfiles,
  profileSignInTargets,
} from '../../boxel-cli/src/lib/desktop-profiles.ts';

export interface HostedModelPreferences {
  schemaVersion: 1;
  provider: 'boxel' | 'local';
  environment: 'production' | 'staging';
  billingProfiles: {
    production: Record<string, string>;
    staging: Record<string, string>;
  };
}
export interface ModelAccount {
  id: string;
  displayName: string;
  matrixUserId: string;
  environment: 'production' | 'staging';
}
interface ConfigureModels {
  provider: 'boxel' | 'local';
  environment: 'production' | 'staging';
  localUserId: string;
  profileId: string | null;
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function sameEndpoint(left: string, right: string): boolean {
  try {
    const a = new URL(left);
    const b = new URL(right);
    return (
      a.protocol === 'https:' &&
      !a.username &&
      !a.password &&
      !a.search &&
      !a.hash &&
      a.href.replace(/\/$/, '') === b.href.replace(/\/$/, '')
    );
  } catch {
    return false;
  }
}
function userId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 512 &&
    /^@[^\s:]+:[^\s]+$/.test(value)
  );
}
function preferences(value: unknown): HostedModelPreferences {
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    !['boxel', 'local'].includes(String(value.provider)) ||
    !['production', 'staging'].includes(String(value.environment)) ||
    !record(value.billingProfiles) ||
    Object.keys(value).some(
      (key) =>
        ![
          'schemaVersion',
          'provider',
          'environment',
          'billingProfiles',
        ].includes(key),
    )
  )
    throw new Error('Invalid model preferences');
  const billingProfiles: HostedModelPreferences['billingProfiles'] = {
    production: {},
    staging: {},
  };
  if (
    Object.keys(value.billingProfiles).some(
      (key) => !['production', 'staging'].includes(key),
    )
  )
    throw new Error('Invalid billing environments');
  for (const environment of ['production', 'staging'] as const) {
    const profiles = value.billingProfiles[environment];
    if (!record(profiles)) throw new Error('Invalid billing profiles');
    for (const [actor, profile] of Object.entries(profiles)) {
      if (
        !userId(actor) ||
        typeof profile !== 'string' ||
        profile.length === 0 ||
        profile.length > 512
      )
        throw new Error('Invalid billing account selection');
      billingProfiles[environment][actor] = profile;
    }
  }
  return {
    schemaVersion: 1,
    provider: value.provider === 'local' ? 'local' : 'boxel',
    environment: value.environment === 'staging' ? 'staging' : 'production',
    billingProfiles,
  };
}
function configuration(value: unknown): ConfigureModels {
  if (
    !record(value) ||
    Object.keys(value).some(
      (key) =>
        !['provider', 'environment', 'localUserId', 'profileId'].includes(key),
    ) ||
    !['boxel', 'local'].includes(String(value.provider)) ||
    !['production', 'staging'].includes(String(value.environment)) ||
    !userId(value.localUserId) ||
    !(
      value.profileId === null ||
      (typeof value.profileId === 'string' &&
        value.profileId.length > 0 &&
        value.profileId.length <= 512)
    )
  )
    throw new Error('Invalid model configuration');
  return {
    provider: value.provider === 'local' ? 'local' : 'boxel',
    environment: value.environment === 'staging' ? 'staging' : 'production',
    localUserId: value.localUserId,
    profileId: value.profileId,
  };
}
async function jsonBody(
  request: IncomingMessage,
  limit: number,
): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) throw new Error('Model request is too large');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function send(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(body));
}
export async function startHostedModels(options: {
  directory: string;
  port?: number;
  accounts?: () => ModelAccount[];
  localUsers?: () => { id: string; name: string }[];
  authorize?: (
    profileId: string,
    environment: 'production' | 'staging',
    signal: AbortSignal,
  ) => Promise<{ token: string; userId: string }>;
  fetchImpl?: typeof fetch;
}) {
  await mkdir(options.directory, { recursive: true, mode: 0o700 });
  const filename = path.join(options.directory, 'model-preferences.json');
  let selected: HostedModelPreferences;
  try {
    selected = preferences(JSON.parse(await readFile(filename, 'utf8')));
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
      throw error;
    selected = {
      schemaVersion: 1,
      provider: 'boxel',
      environment: 'production',
      billingProfiles: { production: {}, staging: {} },
    };
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const targets = profileSignInTargets();
  const accounts =
    options.accounts ??
    (() =>
      listStoredProfiles(new ProfileManager()).flatMap(
        (profile): ModelAccount[] => {
          const target = targets.find(
            (target) =>
              ['production', 'staging'].includes(target.id) &&
              sameEndpoint(target.realmServerUrl, profile.realmServerUrl) &&
              sameEndpoint(target.matrixUrl, profile.matrixUrl),
          );
          if (!target || !profile.canSignIn || !profile.matrixUserId) return [];
          return [
            {
              id: profile.id,
              displayName: profile.displayName,
              matrixUserId: profile.matrixUserId,
              environment: target.id === 'staging' ? 'staging' : 'production',
            },
          ];
        },
      ));
  const localUsers =
    options.localUsers ??
    (() =>
      listStoredProfiles(new ProfileManager()).flatMap((profile) =>
        profile.matrixUserId &&
        /^@[^:]+:[a-z0-9-]+\.boxel\.localhost$/.test(profile.matrixUserId)
          ? [{ id: profile.matrixUserId, name: profile.displayName }]
          : [],
      ));
  const authorize =
    options.authorize ??
    (async (profileId, environment, signal) => {
      const manager = new ProfileManager();
      const profile = manager.getProfile(profileId);
      const target = targets.find((target) => target.id === environment);
      if (
        !target ||
        !profile ||
        !sameEndpoint(profile.realmServerUrl, target.realmServerUrl) ||
        !sameEndpoint(profile.matrixUrl, target.matrixUrl)
      )
        throw new Error('Choose a saved account for this Boxel environment');
      const auth = manager.getStoredMatrixAuth(profileId);
      if (
        !sameEndpoint(auth.matrixUrl, target.matrixUrl) ||
        auth.userId !== profile.matrixUserId
      )
        throw new Error('Sign in to the selected Boxel account again');
      const token = await getRealmServerToken(auth, target.realmServerUrl, {
        signal,
      });
      return { token: token.replace(/^Bearer\s+/i, ''), userId: auth.userId };
    });
  const initialProvider = selected.provider;
  const view = (): NativeModelsView => ({
    ...selected,
    billing: selected.provider === 'boxel' ? 'boxel-credits' : 'local',
    accounts: accounts(),
    localUsers: localUsers(),
    restartRequired: selected.provider !== initialProvider,
  });
  const secret = randomBytes(32).toString('hex');
  let update = Promise.resolve();
  const server = createServer((request, response) => {
    void (async () => {
      if (
        request.headers.origin !== undefined ||
        !request.headers.host?.startsWith('127.0.0.1:')
      )
        return send(response, 403, { error: 'Native model requests only' });
      if (request.url === '/configuration' && request.method === 'GET')
        return send(response, 200, view());
      if (request.url === '/configuration' && request.method === 'POST') {
        if (!request.headers['content-type']?.startsWith('application/json'))
          return send(response, 415, { error: 'JSON is required' });
        const input = configuration(await jsonBody(request, 65536));
        if (
          input.profileId !== null &&
          !accounts().some(
            (account) =>
              account.id === input.profileId &&
              account.environment === input.environment,
          )
        )
          return send(response, 422, {
            error: 'Choose an account for the selected environment',
          });
        update = update
          .catch(() => {})
          .then(async () => {
            const billingProfiles = {
              production: { ...selected.billingProfiles.production },
              staging: { ...selected.billingProfiles.staging },
            };
            if (input.profileId === null)
              delete billingProfiles[input.environment][input.localUserId];
            else
              billingProfiles[input.environment][input.localUserId] =
                input.profileId;
            const next = preferences({
              schemaVersion: 1,
              provider: input.provider,
              environment: input.environment,
              billingProfiles,
            });
            const temporary = `${filename}.${randomBytes(8).toString('hex')}`;
            await writeFile(temporary, JSON.stringify(next, null, 2) + '\n', {
              mode: 0o600,
              flag: 'wx',
            });
            await rename(temporary, filename);
            selected = next;
          });
        await update;
        return send(response, 200, view());
      }
      if (request.url !== '/v1/chat/completions' || request.method !== 'POST')
        return send(response, 404, { error: 'Not found' });
      const candidate = request.headers.authorization ?? '';
      const expected = `Bearer ${secret}`;
      if (
        Buffer.byteLength(candidate) !== Buffer.byteLength(expected) ||
        !timingSafeEqual(Buffer.from(candidate), Buffer.from(expected))
      )
        return send(response, 403, { error: 'Model authentication required' });
      if (selected.provider !== 'boxel')
        return send(response, 409, {
          error: {
            message: 'Restart Studio to apply the local model selection.',
          },
        });
      const body = await jsonBody(request, 8 * 1024 * 1024);
      if (
        !record(body) ||
        !userId(body.user) ||
        typeof body.model !== 'string' ||
        !Array.isArray(body.messages)
      )
        return send(response, 422, {
          error: 'A model, messages and workspace user are required',
        });
      const environment = selected.environment;
      const profileId =
        selected.billingProfiles[environment][body.user] ??
        accounts().find(
          (account) =>
            account.environment === environment &&
            account.matrixUserId === body.user,
        )?.id;
      if (!profileId)
        return send(response, 403, {
          error: {
            message:
              'Choose a billing account in Studio → Boxel settings → Models to use Boxel credits.',
          },
        });
      const controller = new AbortController();
      response.once('close', () => {
        if (!response.writableEnded) controller.abort();
      });
      const authorization = await authorize(
        profileId,
        environment,
        AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      );
      const target = targets.find((target) => target.id === environment)!;
      const upstream = await fetchImpl(
        new URL('_openrouter/chat/completions', target.realmServerUrl),
        {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(300000),
          ]),
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${authorization.token}`,
          },
          body: JSON.stringify({ ...body, user: authorization.userId }),
        },
      );
      response.writeHead(upstream.status, {
        'content-type':
          upstream.headers.get('content-type') ?? 'application/json',
        'cache-control': 'no-store',
      });
      if (!upstream.body) {
        response.end();
        return;
      }
      const source = upstream.body;
      const stream = Readable.from(
        (async function* () {
          const reader = source.getReader();
          try {
            while (true) {
              const next = await reader.read();
              if (next.done) return;
              yield next.value;
            }
          } finally {
            await reader.cancel().catch(() => {});
            reader.releaseLock();
          }
        })(),
      );
      stream.on('error', () => response.destroy());
      response.once('close', () => stream.destroy());
      stream.pipe(response);
    })().catch(() => {
      if (response.headersSent) response.destroy();
      else
        send(response, 502, {
          error: {
            message:
              'Boxel hosted AI is unavailable. Check the connection and sign in to the selected billing account again.',
          },
        });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 4247, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Model service did not start');
  return {
    url: `http://127.0.0.1:${address.port}/v1/`,
    secret,
    provider: selected.provider,
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
