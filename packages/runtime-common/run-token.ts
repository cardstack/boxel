/**
 * The run token: the session an automation run's calls carry (ADR 026 §1.2).
 * The realm server mints one per run attempt, for the run's identity, and it
 * names the run and the attempt that owns it. It admits read and write in the
 * automation's realm (the token's `realm`) and read in the realms its cards'
 * modules load from (`run.readRealms`: the base and catalog realms), and
 * nothing else. Its expiry is the run's time limit, and it carries the run's
 * `writes` cap (`run.writesCap`), the most files the run may write.
 *
 * It is signed under its own key (`runTokenSecret`) rather than the bare
 * realm seed, so every verifier of ordinary sessions refuses it on its
 * signature. A realm accepts it only through `Realm.handleAutomation`, which
 * checks it against the run's row on every call, and a realm-server route
 * accepts it only where the route asks for it by name.
 *
 * Deliberately a leaf module with no imports, so the realm and the realm
 * server can share it without pulling in the runtime-common barrel.
 */

export const RUN_TOKEN_SCOPE = 'automation-run';

export interface RunTokenClaim {
  // The run's `automation_runs` id.
  id: string;
  // The queue attempt the token was minted for: the run row's `attempt` when
  // the attempt started. A call is refused once another attempt owns the run.
  attempt: number;
  // The URLs of the realms the run may read besides its own: the realms its
  // cards' modules load from.
  readRealms: string[];
  // The most files the run may write: the automation's `writes` cap.
  writesCap: number;
}

// What a verified run token says, in the shape a realm-server route or a
// realm acts on.
export interface RunTokenContext {
  runId: string;
  attempt: number;
  // The Matrix user id of the run's identity, whom every call acts as.
  actsAs: string;
  // The URL of the automation's realm.
  realm: string;
  readRealms: string[];
  writesCap: number;
  iat: number;
  exp: number;
}

/**
 * The signing key for this family: the realm secret seed under a
 * family-specific suffix, never the bare seed.
 */
export function runTokenSecret(realmSecretSeed: string): string {
  return `${realmSecretSeed}:${RUN_TOKEN_SCOPE}`;
}

/**
 * Whether a token presents itself as a run token, read from its payload
 * without verifying it. It decides only which key to verify the token
 * against and which entry point handles the request; a token that lies about
 * it fails that verification.
 */
export function presentsAsRunToken(token: string): boolean {
  let payload = token.split('.')[1];
  if (!payload) {
    return false;
  }
  try {
    let claims = JSON.parse(
      atob(payload.replace(/-/g, '+').replace(/_/g, '/')),
    ) as unknown;
    return typeof claims === 'object' && claims !== null && 'run' in claims;
  } catch {
    return false;
  }
}

/**
 * Whether a request's `Authorization` header carries a run token.
 */
export function carriesRunToken(authorization: string | null): boolean {
  if (!authorization?.startsWith('Bearer ')) {
    return false;
  }
  return presentsAsRunToken(authorization.slice('Bearer '.length));
}

/**
 * The context of a verified run token when its claims are well formed;
 * otherwise undefined. The signature and expiry are the verifier's to check
 * before this, and the run's row is the caller's to check after.
 */
export function runTokenContext(claims: {
  user?: unknown;
  realm?: unknown;
  run?: unknown;
  iat?: unknown;
  exp?: unknown;
}): RunTokenContext | undefined {
  let { user, realm, run, iat, exp } = claims;
  if (
    typeof user !== 'string' ||
    !user ||
    typeof realm !== 'string' ||
    !realm ||
    typeof iat !== 'number' ||
    typeof exp !== 'number' ||
    typeof run !== 'object' ||
    run === null
  ) {
    return undefined;
  }
  let { id, attempt, readRealms, writesCap } = run as Record<string, unknown>;
  if (
    typeof id !== 'string' ||
    !id ||
    typeof attempt !== 'number' ||
    !Number.isSafeInteger(attempt) ||
    !Array.isArray(readRealms) ||
    !readRealms.every((r) => typeof r === 'string' && r) ||
    typeof writesCap !== 'number' ||
    !Number.isSafeInteger(writesCap) ||
    writesCap < 0
  ) {
    return undefined;
  }
  return {
    runId: id,
    attempt,
    actsAs: user,
    realm,
    readRealms: readRealms as string[],
    writesCap,
    iat,
    exp,
  };
}
