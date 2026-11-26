import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  resetProfileManager,
  setProfileManager,
} from '@cardstack/boxel-cli/api';

export interface TestProfileOptions {
  username: string;
  matrixUrl: string;
  realmServerUrl: string;
  password: string;
  // Sign the profile in with OAuth instead, its connection granted `scope`.
  oauth?: { scope: string };
}

/**
 * Installs a fake Boxel CLI profile into an isolated temp directory.
 * Replaces the ProfileManager singleton so BoxelCLIClient picks up the
 * test profile without touching the real ~/.boxel-cli/profiles.json.
 *
 * Returns a cleanup function that resets the singleton and removes the temp dir.
 */
export function installTestProfile(options: TestProfileOptions): () => void {
  let tempConfigDir = mkdtempSync(join(tmpdir(), 'boxel-test-config-'));
  mkdirSync(tempConfigDir, { recursive: true });

  let profileId = `@${options.username}:localhost`;
  let config = {
    profiles: {
      [profileId]: options.oauth
        ? {
            matrixUrl: options.matrixUrl,
            realmServerUrl: options.realmServerUrl,
            matrixUserId: profileId,
            displayName: options.username,
            oauth: {
              issuer: new URL(options.realmServerUrl).origin,
              tokenEndpoint: new URL(
                '_oauth-provider/token',
                options.realmServerUrl,
              ).href,
              accessToken: 'access-token-placeholder',
              accessExpiresAt: new Date(Date.now() + 600_000).toISOString(),
              connectionEndsAt: new Date(
                Date.now() + 30 * 24 * 3600_000,
              ).toISOString(),
              scope: options.oauth.scope,
            },
          }
        : {
            matrixUrl: options.matrixUrl,
            realmServerUrl: options.realmServerUrl,
            password: options.password,
          },
    },
    activeProfile: profileId,
  };

  writeFileSync(
    join(tempConfigDir, 'profiles.json'),
    JSON.stringify(config, null, 2),
  );
  setProfileManager(tempConfigDir);

  return () => {
    resetProfileManager();
    rmSync(tempConfigDir, { recursive: true, force: true });
  };
}
