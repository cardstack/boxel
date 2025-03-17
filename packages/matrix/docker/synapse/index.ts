import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import * as fse from 'fs-extra';
import { request } from '@playwright/test';
import {
  dockerCreateNetwork,
  dockerExec,
  dockerLogs,
  dockerRun,
  dockerStop,
} from '../index';

export const SYNAPSE_IP_ADDRESS = '172.20.0.5';
export const SYNAPSE_PORT = 8008;

const registrationSecretFile = path.resolve(
  path.join(__dirname, '..', '..', 'registration_secret.txt'),
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

function randB64Bytes(numBytes: number): string {
  return crypto.randomBytes(numBytes).toString('base64').replace(/=*$/, '');
}

export async function cfgDirFromTemplate(
  template: string,
  dataDir?: string,
): Promise<SynapseConfig> {
  const templateDir = path.join(__dirname, template);

  const stats = await fse.stat(templateDir);
  if (!stats?.isDirectory) {
    throw new Error(`No such template: ${template}`);
  }
  const configDir = dataDir
    ? dataDir
    : await fse.mkdtemp(path.join(os.tmpdir(), 'synapsedocker-'));

  // copy the contents of the template dir, omitting homeserver.yaml as we'll template that
  console.log(`Copy ${templateDir} -> ${configDir}`);
  await fse.copy(templateDir, configDir, {
    filter: (f) => path.basename(f) !== 'homeserver.yaml',
  });

  const registrationSecret = randB64Bytes(16);
  const macaroonSecret = randB64Bytes(16);
  const formSecret = randB64Bytes(16);

  const baseUrl = `http://${SYNAPSE_IP_ADDRESS}:${SYNAPSE_PORT}`;

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
    port: SYNAPSE_PORT,
    host: SYNAPSE_IP_ADDRESS,
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
}
export async function synapseStart(
  opts?: StartOptions,
  stopExisting = true,
): Promise<SynapseInstance> {
  if (stopExisting) {
    // Stop the main server if it's running
    let stopPromises = [dockerStop({ containerId: 'boxel-synapse' })];
    for (const [id, _synapse] of synapses) {
      // Stop any other synapses that are running
      stopPromises.push(synapseStop(id));
    }
    await Promise.allSettled(stopPromises);
  }
  const synCfg = await cfgDirFromTemplate(
    opts?.template ?? 'test',
    opts?.dataDir,
  );
  let containerName = opts?.containerName || path.basename(synCfg.configDir);
  console.log(
    `Starting synapse with config dir ${synCfg.configDir} in container ${containerName}...`,
  );
  await dockerCreateNetwork({ networkName: 'boxel' });
  const synapseId = await dockerRun({
    image: 'matrixdotorg/synapse:v1.126.0',
    containerName: 'boxel-synapse',
    dockerParams: [
      '--rm',
      '-v',
      `${synCfg.configDir}:/data`,
      '-v',
      `${path.join(__dirname, 'templates')}:/custom/templates/`,
      `--ip=${synCfg.host}`,
      /**
       * When using -p flag with --ip, the docker internal port must be used to access from the host
       */
      '-p',
      `${synCfg.port}:8008/tcp`,
      '--network=boxel',
    ],
    applicationParams: ['run'],
    runAsUser: true,
  });

  console.log(`Started synapse with id ${synapseId} on port ${synCfg.port}`);

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

  const synapse: SynapseInstance = { synapseId, ...synCfg };
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
  const url = `http://localhost:${SYNAPSE_PORT}/_synapse/admin/v1/register`;
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
    : `http://localhost:${SYNAPSE_PORT}/_matrix/client/r0/login`;
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
    `http://localhost:${SYNAPSE_PORT}/_matrix/client/v3/profile/${userId}/displayname`,
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
    `http://localhost:${SYNAPSE_PORT}/_synapse/admin/v1/registration_tokens/new`,
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
    throw new Error(
      `could not create registration token: ${
        res.status
      } - ${await res.text()}`,
    );
  }
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
  }: {
    password?: string;
    displayname?: string;
    avatar_url?: string;
    emailAddresses?: string[];
    matrixURL?: string;
  },
) {
  let url = matrixURL
    ? `${matrixURL}/_synapse/admin/v2/users/${userId}`
    : `http://localhost:${SYNAPSE_PORT}/_synapse/admin/v2/users/${userId}`;
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

export async function updateAccountData(
  userId: string,
  accessToken: string,
  type: string,
  data: string,
): Promise<void> {
  let response = await fetch(
    `http://localhost:${SYNAPSE_PORT}/_matrix/client/v3/user/${userId}/account_data/${type}`,
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
    `http://localhost:${SYNAPSE_PORT}/_matrix/client/v3/user/${userId}/account_data/${type}`,
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
    `http://localhost:${SYNAPSE_PORT}/_matrix/client/v3/joined_rooms`,
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
    `http://localhost:${SYNAPSE_PORT}/_matrix/client/v3/rooms/${roomId}/state/${eventType}`,
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
    `http://localhost:${SYNAPSE_PORT}/_matrix/client/v3/rooms/${roomId}/joined_members`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
  return await response.json();
}

export async function sync(accessToken: string) {
  let response = await fetch(
    `http://localhost:${SYNAPSE_PORT}/_matrix/client/v3/sync`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
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
      `http://localhost:${SYNAPSE_PORT}/_matrix/client/v3/rooms/${roomId}/messages?dir=${
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
  let url = `http://localhost:${SYNAPSE_PORT}/_matrix/client/v3/rooms/${roomId}/send/${eventType}/${txnId}`;
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
