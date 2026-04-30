/**
 * Test helpers for building a real BoxelCLIClient wired to a harness-
 * generated realm. The harness issues realm auth headers via
 * `realm.authorizationHeaders()` and `realm.serverToken` — we pre-seed
 * those into a ProfileManager pointed at an isolated config dir, so
 * BoxelCLIClient can make authenticated realm calls without needing
 * matrix login.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  BoxelCLIClient,
  resetProfileManager,
  setProfileManager,
  setQuiet,
} from '@cardstack/boxel-cli/api';

export interface TestClientOptions {
  realmUrl: string;
  /**
   * Full `Authorization` header value (typically `"Bearer <jwt>"`) for the
   * target realm URL. ProfileManager injects this verbatim as the
   * `Authorization` header on realm requests.
   */
  realmToken: string;
  realmServerUrl: string;
  /**
   * Full `Authorization` header value (typically `"Bearer <jwt>"`) for the
   * realm server. Injected verbatim on server-level requests.
   */
  realmServerToken: string;
  /** Optional matrix URL — defaults to a localhost placeholder. */
  matrixUrl?: string;
  /** Optional username — defaults to "test-user". */
  username?: string;
}

/**
 * Build a real BoxelCLIClient wired to the harness realm. Returns the
 * client plus a cleanup function that resets the ProfileManager singleton
 * and removes the temp config dir.
 */
export function buildTestClient(options: TestClientOptions): {
  client: BoxelCLIClient;
  cleanup: () => void;
} {
  let tempConfigDir = mkdtempSync(join(tmpdir(), 'boxel-test-config-'));
  mkdirSync(tempConfigDir, { recursive: true });

  let username = options.username ?? 'test-user';
  let matrixUrl = options.matrixUrl ?? 'http://matrix.invalid/';
  let profileId = `@${username}:localhost`;
  let config = {
    profiles: {
      [profileId]: {
        matrixUrl,
        realmServerUrl: options.realmServerUrl,
        password: 'unused',
        realmTokens: {
          [options.realmUrl]: options.realmToken,
        },
        realmServerToken: options.realmServerToken,
      },
    },
    activeProfile: profileId,
  };

  writeFileSync(
    join(tempConfigDir, 'profiles.json'),
    JSON.stringify(config, null, 2),
  );
  setProfileManager(tempConfigDir);

  // BoxelCLIClient.sync/pull/push delegate to the realm command code in
  // process — same console.log lines a CLI invocation would emit. We're
  // not parsing argv here, so the global `--quiet` flag never fires;
  // turn quiet mode on explicitly so SF Playwright tests don't drown CI
  // logs in "Starting sync …" / "Downloaded: …" / "Sync completed" noise.
  setQuiet(true);

  let client = new BoxelCLIClient();

  let cleanup = () => {
    setQuiet(false);
    resetProfileManager();
    rmSync(tempConfigDir, { recursive: true, force: true });
  };

  return { client, cleanup };
}
