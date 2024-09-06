/* eslint-env node */
import { readFileSync } from 'fs-extra';
import { resolve, join } from 'path';
import { createHmac } from 'crypto';
import yaml from 'yaml';
import { existsSync } from 'fs';

const homeserverFile = resolve(
  join(__dirname, '..', 'matrix', 'synapse-data', 'homeserver.yaml'),
);

export function getLocalConfig() {
  if (existsSync(homeserverFile)) {
    let homeserverYml = readFileSync(homeserverFile, 'utf8');
    return yaml.parse(homeserverYml) as Record<string, any>;
  }
  return undefined;
}

export async function registerUser({
  matrixURL,
  displayname,
  username,
  password,
  registrationSecret,
}: {
  matrixURL: URL;
  displayname: string;
  username: string;
  password: string;
  registrationSecret: string;
}) {
  let nonceResponse = await fetch(
    `${matrixURL.href}_synapse/admin/v1/register`,
  );
  let { nonce } = (await nonceResponse.json()) as { nonce: string };
  let mac = createHmac('sha1', registrationSecret)
    .update(`${nonce}\0${username}\0${password}\0notadmin`)
    .digest('hex');

  let registerResponse = await fetch(
    `${matrixURL.href}_synapse/admin/v1/register`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        nonce,
        username,
        displayname,
        password,
        mac,
        admin: false,
      }),
    },
  );
  if (!registerResponse.ok) {
    throw new Error(`could not register matrix user '${username}'`);
  }
  let {
    access_token: accessToken,
    user_id: userId,
    home_server: homeServer,
    device_id: deviceId,
  } = (await registerResponse.json()) as {
    access_token: string;
    user_id: string;
    home_server: string;
    device_id: string;
  };
  return { accessToken, userId, homeServer, deviceId };
}
