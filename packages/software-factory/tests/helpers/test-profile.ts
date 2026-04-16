import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { resetProfileManager } from '@cardstack/boxel-cli/api';

export interface TestProfileOptions {
  username: string;
  matrixUrl: string;
  realmServerUrl: string;
  password: string;
}

/**
 * Installs a fake Boxel CLI profile into the real ~/.boxel-cli/profiles.json.
 * Backs up any existing file and resets the ProfileManager singleton so
 * BoxelCLIClient picks up the test profile.
 *
 * Returns a cleanup function that restores the original file and resets again.
 */
export function installTestProfile(options: TestProfileOptions): () => void {
  let configDir = join(homedir(), '.boxel-cli');
  let profilesFile = join(configDir, 'profiles.json');

  let backup: string | undefined;
  if (existsSync(profilesFile)) {
    backup = readFileSync(profilesFile, 'utf8');
  }

  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

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

  writeFileSync(profilesFile, JSON.stringify(config, null, 2));
  resetProfileManager();

  return () => {
    if (backup !== undefined) {
      writeFileSync(profilesFile, backup);
    } else {
      writeFileSync(
        profilesFile,
        JSON.stringify({ profiles: {}, activeProfile: null }),
      );
    }
    resetProfileManager();
  };
}
