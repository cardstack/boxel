import * as fs from 'fs';
import * as path from 'path';
import { MatrixClient } from './matrix-client.js';
import { RealmAuthClient } from './realm-auth-client.js';

interface SyncManifest {
  workspaceUrl: string;
  lastSyncTime: number;
  files: Record<string, { localHash: string; remoteMtime: number }>;
}

interface ResolvedWorkspace {
  localDir: string;
  workspaceUrl: string;
  manifest?: SyncManifest;
}

/**
 * Resolve workspace reference to local dir and URL.
 *
 * Formats:
 *   .                     -> current dir (must have .boxel-sync.json)
 *   ./path                -> local path (must have .boxel-sync.json)
 *   @user/workspace       -> lookup from realm-auth, use default local dir
 *   https://...           -> explicit URL
 */
export async function resolveWorkspace(
  ref: string,
  matrixClient?: MatrixClient
): Promise<ResolvedWorkspace> {
  // Check if it's a local path
  if (ref === '.' || ref.startsWith('./') || ref.startsWith('/')) {
    const absoluteDir = path.resolve(ref);
    const manifestPath = path.join(absoluteDir, '.boxel-sync.json');

    if (!fs.existsSync(manifestPath)) {
      throw new Error(`No .boxel-sync.json found in ${absoluteDir}. Run sync first to establish tracking.`);
    }

    const manifest: SyncManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    return {
      localDir: absoluteDir,
      workspaceUrl: manifest.workspaceUrl,
      manifest
    };
  }

  // Check if it's a @user/workspace reference
  if (ref.startsWith('@')) {
    if (!matrixClient) {
      throw new Error('Matrix client required to resolve @user/workspace references');
    }

    const workspaces = await listUserWorkspaces(matrixClient);
    const match = ref.slice(1); // Remove @

    // Find matching workspace
    const workspace = workspaces.find(w => {
      // Match against path like "username/workspace"
      const urlPath = new URL(w.url).pathname.replace(/^\/|\/$/g, '');
      return urlPath === match || urlPath.endsWith(match);
    });

    if (!workspace) {
      throw new Error(`Workspace not found: ${ref}\nAvailable: ${workspaces.map(w => '@' + new URL(w.url).pathname.replace(/^\/|\/$/g, '')).join(', ')}`);
    }

    // Default local dir is the workspace name
    const localDir = path.resolve(match.split('/').pop() || match);

    // Check if we have a local manifest
    const manifestPath = path.join(localDir, '.boxel-sync.json');
    let manifest: SyncManifest | undefined;
    if (fs.existsSync(manifestPath)) {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    }

    return {
      localDir,
      workspaceUrl: workspace.url,
      manifest
    };
  }

  // Check if it's a full URL
  if (ref.startsWith('http://') || ref.startsWith('https://')) {
    // For URLs, we need a local dir - derive from URL path
    const urlPath = new URL(ref).pathname.replace(/^\/|\/$/g, '');
    const localDir = path.resolve(urlPath.split('/').pop() || 'workspace');

    // Check if we have a local manifest
    const manifestPath = path.join(localDir, '.boxel-sync.json');
    let manifest: SyncManifest | undefined;
    if (fs.existsSync(manifestPath)) {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    }

    return {
      localDir,
      workspaceUrl: ref,
      manifest
    };
  }

  throw new Error(`Invalid workspace reference: ${ref}\nUse: . | ./path | @user/workspace | https://...`);
}

interface WorkspaceInfo {
  url: string;
  permissions: string[];
}

export async function listUserWorkspaces(matrixClient: MatrixClient): Promise<WorkspaceInfo[]> {
  const realmServerUrl = process.env.REALM_SERVER_URL;
  if (!realmServerUrl) {
    throw new Error('REALM_SERVER_URL environment variable required');
  }

  // Ensure matrix client is logged in
  if (!matrixClient.isLoggedIn()) {
    await matrixClient.login();
  }

  const baseUrl = realmServerUrl.endsWith('/') ? realmServerUrl : realmServerUrl + '/';

  // Step 1: Get realm server session token
  const openIdToken = await matrixClient.getOpenIdToken();
  if (!openIdToken) {
    throw new Error('Failed to get OpenID token from Matrix');
  }

  const sessionResponse = await fetch(`${baseUrl}_server-session`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(openIdToken),
  });

  if (!sessionResponse.ok) {
    throw new Error(`Failed to get realm server session: ${sessionResponse.status}`);
  }

  const serverToken = sessionResponse.headers.get('Authorization');
  if (!serverToken) {
    throw new Error('No Authorization header in realm server session response');
  }

  // Step 2: Fetch accessible realms with server token
  const authUrl = `${baseUrl}_realm-auth`;
  const response = await fetch(authUrl, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': serverToken,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch workspaces: ${response.status}`);
  }

  // The response is a Record<url, token> not the format I assumed
  const data = await response.json() as Record<string, string>;

  return Object.keys(data).map(url => ({
    url,
    permissions: ['read', 'write'], // Assume write access for now
  }));
}

/**
 * Get all user workspaces with their sync status
 */
export async function getAllWorkspacesStatus(matrixClient: MatrixClient): Promise<Array<{
  url: string;
  shortName: string;
  localDir: string | null;
  hasSyncManifest: boolean;
  permissions: string[];
}>> {
  const workspaces = await listUserWorkspaces(matrixClient);

  return workspaces.map(w => {
    const urlPath = new URL(w.url).pathname.replace(/^\/|\/$/g, '');
    const shortName = '@' + urlPath;
    const localDirName = urlPath.split('/').pop() || urlPath;
    const localDir = path.resolve(localDirName);
    const manifestPath = path.join(localDir, '.boxel-sync.json');
    const hasSyncManifest = fs.existsSync(manifestPath);

    return {
      url: w.url,
      shortName,
      localDir: hasSyncManifest ? localDir : null,
      hasSyncManifest,
      permissions: w.permissions,
    };
  });
}
