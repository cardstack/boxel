import { MatrixClient } from '../lib/matrix-client.js';
import { getProfileManager, formatProfileBadge } from '../lib/profile-manager.js';

interface CreateOptions {
  background?: string;
  icon?: string;
}

async function getRealmServerToken(
  matrixClient: MatrixClient,
  realmServerUrl: string,
): Promise<string> {
  const openIdToken = await matrixClient.getOpenIdToken();
  if (!openIdToken) {
    throw new Error('Failed to get OpenID token from Matrix');
  }

  const response = await fetch(`${realmServerUrl}_server-session`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(openIdToken),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to get realm server session: ${response.status} - ${text}`);
  }

  const token = response.headers.get('Authorization');
  if (!token) {
    throw new Error('No Authorization header in realm server session response');
  }

  return token;
}

export async function createCommand(
  endpoint: string,
  name: string,
  options: CreateOptions,
): Promise<void> {
  // Get credentials from profile manager (falls back to env vars)
  const profileManager = getProfileManager();
  const credentials = await profileManager.getActiveCredentials();

  if (!credentials) {
    console.error('No credentials found. Run "boxel profile add" or set environment variables.');
    process.exit(1);
  }

  const { matrixUrl, username, password, realmServerUrl: baseRealmServerUrl, profileId } = credentials;

  // Show active profile if using one
  if (profileId) {
    console.log(`${formatProfileBadge(profileId)}\n`);
  }

  let realmServerUrl = baseRealmServerUrl;
  if (!realmServerUrl) {
    const matrixUrlObj = new URL(matrixUrl);
    if (matrixUrlObj.hostname.startsWith('matrix-')) {
      realmServerUrl = `${matrixUrlObj.protocol}//${matrixUrlObj.hostname.slice(7)}/`;
    } else if (matrixUrlObj.hostname.startsWith('matrix.')) {
      realmServerUrl = `${matrixUrlObj.protocol}//app.${matrixUrlObj.hostname.slice(7)}/`;
    } else {
      console.error('Could not derive realm server URL. Set REALM_SERVER_URL.');
      process.exit(1);
    }
  }

  if (!realmServerUrl.endsWith('/')) {
    realmServerUrl += '/';
  }

  // Validate endpoint format
  if (!/^[a-z0-9-]+$/.test(endpoint)) {
    console.error('Endpoint must contain only lowercase letters, numbers, and hyphens');
    process.exit(1);
  }

  try {
    console.log('Logging into Matrix...');
    const matrixClient = new MatrixClient({
      matrixURL: new URL(matrixUrl),
      username,
      password,
    });
    await matrixClient.login();

    console.log('Getting realm server token...');
    const serverToken = await getRealmServerToken(matrixClient, realmServerUrl);

    console.log(`Creating workspace "${name}" at endpoint "${endpoint}"...`);

    const createUrl = `${realmServerUrl}_create-realm`;
    const response = await fetch(createUrl, {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json',
        'Authorization': serverToken,
      },
      body: JSON.stringify({
        data: {
          type: 'realm',
          attributes: {
            endpoint,
            name,
            ...(options.background && { backgroundURL: options.background }),
            ...(options.icon && { iconURL: options.icon }),
          },
        },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`Failed to create workspace: ${response.status}`);
      console.error(text);
      process.exit(1);
    }

    const result = await response.json() as {
      data?: {
        id?: string;
        attributes?: {
          endpoint?: string;
          name?: string;
        };
      };
    };

    const realmUrl = result.data?.id;

    console.log('');
    console.log('✅ Workspace created successfully!');
    console.log('');
    console.log(`   Name: ${name}`);
    console.log(`   URL:  ${realmUrl}`);
    console.log('');
    console.log('To sync locally:');
    console.log(`   boxel sync ./${endpoint} ${realmUrl}`);

  } catch (error) {
    console.error('Failed to create workspace:', error);
    process.exit(1);
  }
}
