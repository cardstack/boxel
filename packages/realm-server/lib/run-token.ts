import jwt from 'jsonwebtoken';
import type { AutomationRun } from '@cardstack/runtime-common';
import {
  runTokenContext,
  runTokenSecret,
  type RunTokenContext,
} from '@cardstack/runtime-common/run-token';
import { assertNoSecureSessionClaim } from '../utils/jwt.ts';

// Minting and verifying the run token (ADR 026 §1.2): the session an
// automation run's calls carry. See `runtime-common/run-token.ts` for what it
// admits.
//
// A token is minted for one attempt of a running run, for the run's identity
// (`acts_as`), and expires at the run's deadline: its first start
// (`started_at`, which a retry keeps) plus its time limit. So a retry's token
// expires when the run's first attempt's would have, and a retry can't extend
// the run. A realm accepts it only
// through `Realm.handleAutomation`, which checks the run's row on every call.
// A realm-server route that serves run tokens verifies one with
// `verifyRunToken` and checks the run's row itself with
// `automationRunForCall`, since the signature says only that the realm server
// minted it, not that the run is still going.

export interface MintRunTokenOptions {
  realmSecretSeed: string;
  // The run, as the attempt that owns it read it when it started: running,
  // with its `attempt` set.
  run: AutomationRun;
  // The URL the automation's realm is served at, which the run's `realm`
  // resolves to.
  realmURL: string;
  // The URLs of the realms the run's cards' modules load from (the base and
  // catalog realms), which the token lets the run read.
  readRealms: string[];
  realmServerURL: string;
  // The run's time limit: the token expires this many seconds after the run
  // first started.
  timeLimitSeconds: number;
  // The current time, in milliseconds since the epoch.
  now?: number;
}

export function mintRunToken({
  realmSecretSeed,
  run,
  realmURL,
  readRealms,
  realmServerURL,
  timeLimitSeconds,
  now = Date.now(),
}: MintRunTokenOptions): string {
  if (run.state !== 'running' || run.attempt === null || !run.startedAt) {
    throw new Error(
      `a run token is minted only for a running run's attempt; run ${run.id} is ${run.state}`,
    );
  }
  if (!Number.isFinite(timeLimitSeconds) || timeLimitSeconds <= 0) {
    throw new Error(
      `a run token needs a positive time limit, not ${timeLimitSeconds}`,
    );
  }
  let deadlineMs = Date.parse(run.startedAt) + timeLimitSeconds * 1000;
  if (deadlineMs <= now) {
    throw new Error(
      `run ${run.id}'s time limit passed at ${new Date(deadlineMs).toISOString()}, so no token is minted for it`,
    );
  }
  let claims = {
    user: run.actsAs,
    realm: realmURL,
    // A run token carries no permissions: every call's permissions are the
    // run's identity's, read fresh where the call is checked.
    permissions: [],
    sessionRoom: undefined,
    realmServerURL,
    run: { id: run.id, attempt: run.attempt, readRealms },
    // The deadline itself, not a lifetime counted from the signing clock.
    iat: Math.floor(now / 1000),
    exp: Math.floor(deadlineMs / 1000),
  };
  assertNoSecureSessionClaim(claims);
  return jwt.sign(claims, runTokenSecret(realmSecretSeed));
}

// What a run token says, when it verifies under the run-token key, within
// its expiry, and is well formed; otherwise undefined. The signature says only
// that the realm server minted it, so the caller checks the run's row with
// `automationRunForCall` before acting on it.
export function verifyRunToken(
  token: string,
  realmSecretSeed: string,
): RunTokenContext | undefined {
  let claims: jwt.JwtPayload | string;
  try {
    claims = jwt.verify(token, runTokenSecret(realmSecretSeed));
  } catch {
    return undefined;
  }
  if (typeof claims !== 'object') {
    return undefined;
  }
  return runTokenContext(claims);
}
