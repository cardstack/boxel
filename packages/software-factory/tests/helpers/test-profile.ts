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
      [profileId]: {
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
