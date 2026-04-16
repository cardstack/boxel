import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface TestProfileOptions {
  username: string;
  matrixUrl: string;
  realmServerUrl: string;
  password: string;
}

/**
 * Creates a temporary HOME directory with a fake ~/.boxel-cli/profiles.json.
 * Sets process.env.HOME to the temp dir so getActiveProfile() reads from it.
 * Returns a cleanup function that restores the original HOME.
 */
export function installTestProfile(options: TestProfileOptions): () => void {
  let originalHome = process.env.HOME;

  let tempHome = mkdtempSync(join(tmpdir(), 'boxel-test-'));
  let boxelCliDir = join(tempHome, '.boxel-cli');
  mkdirSync(boxelCliDir, { recursive: true });

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
    join(boxelCliDir, 'profiles.json'),
    JSON.stringify(config, null, 2),
  );
  process.env.HOME = tempHome;

  return () => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  };
}
