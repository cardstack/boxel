import { MatrixClient } from '../lib/matrix-client.js';
import { getProfileManager, formatProfileBadge } from '../lib/profile-manager.js';
async function getRealmServerToken(matrixClient, realmServerUrl) {
    const openIdToken = await matrixClient.getOpenIdToken();
    if (!openIdToken) {
        throw new Error('Failed to get OpenID token from Matrix');
    }
    const response = await fetch(`${realmServerUrl}_server-session`, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
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
async function fetchAccessibleRealms(realmServerUrl, token) {
    const response = await fetch(`${realmServerUrl}_realm-auth`, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: token,
        },
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to fetch accessible realms: ${response.status} - ${text}`);
    }
    return response.json();
}
async function fetchRealmInfo(realmUrl, token) {
    try {
        const response = await fetch(realmUrl, {
            headers: {
                Accept: 'application/vnd.api+json',
                Authorization: token,
            },
        });
        if (response.ok) {
            const data = await response.json();
            return {
                url: realmUrl,
                name: data.data?.attributes?.name,
            };
        }
    }
    catch {
        // Ignore errors fetching realm info
    }
    return { url: realmUrl };
}
export async function listCommand(options) {
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
    // Ensure trailing slash
    if (!realmServerUrl.endsWith('/')) {
        realmServerUrl += '/';
    }
    try {
        console.log('Logging into Matrix...');
        const matrixClient = new MatrixClient({
            matrixURL: new URL(matrixUrl),
            username,
            password,
        });
        await matrixClient.login();
        console.log('Matrix login successful');
        console.log(`Connecting to realm server: ${realmServerUrl}`);
        const realmServerToken = await getRealmServerToken(matrixClient, realmServerUrl);
        console.log('Realm server authentication successful');
        console.log('Fetching accessible workspaces...\n');
        const realms = await fetchAccessibleRealms(realmServerUrl, realmServerToken);
        const realmUrls = Object.keys(realms);
        if (realmUrls.length === 0) {
            console.log('No workspaces found.');
            return;
        }
        if (options.json) {
            console.log(JSON.stringify(realmUrls, null, 2));
            return;
        }
        console.log(`Found ${realmUrls.length} workspace(s):\n`);
        // Fetch info for each realm
        for (const realmUrl of realmUrls) {
            const token = realms[realmUrl];
            const info = await fetchRealmInfo(realmUrl, token);
            if (info.name) {
                console.log(`  ${info.name}`);
                console.log(`    ${realmUrl}`);
            }
            else {
                console.log(`  ${realmUrl}`);
            }
            console.log('');
        }
    }
    catch (error) {
        console.error('Failed to list workspaces:', error);
        process.exit(1);
    }
}
//# sourceMappingURL=list.js.map