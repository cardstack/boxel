import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import { FG_YELLOW, FG_CYAN, FG_MAGENTA, DIM, BOLD, RESET } from './colors.ts';
import {
  matrixLogin,
  MatrixAuthError,
  getRealmServerToken as fetchRealmServerToken,
  getRealmTokens,
  addRealmToMatrixAccountData,
  removeRealmFromMatrixAccountData,
  getUserRealmsFromMatrixAccountData,
  type MatrixAuth,
} from './auth.ts';
import { promptPassword as defaultPromptPassword } from './prompt.ts';
import type { RealmAuthenticator } from './realm-authenticator.ts';
import { realmFetch } from './realm-fetch.ts';

export interface ProfileManagerDeps {
  matrixLogin?: typeof matrixLogin;
  promptPassword?: (question: string) => Promise<string>;
  isTty?: () => boolean;
  // Moves the written profiles file into place.
  renameFile?: (from: string, to: string) => void;
}

// What a rename over the profiles file throws on Windows while another
// program has the file open.
const RENAME_REFUSED_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);

const DEFAULT_CONFIG_DIR = path.join(os.homedir(), '.boxel-cli');
const PROFILES_FILENAME = 'profiles.json';

/**
 * Re-mint a realm-server token when this little of its life is left, so a
 * long-running operation (or a downstream consumer that bakes the token into
 * a static header, like opencode's passthrough provider) doesn't get a 401
 * mid-flight. Sized to outlast a single slow command, not to be a fraction of
 * the token's lifetime — keep it well under the server's session TTL
 * (`SESSION_TOKEN_TTL`), because a margin at or above that TTL makes every
 * freshly minted token look already-expired and forces a re-mint on every
 * call.
 *
 * Decode-only — we don't verify the signature; the realm server does
 * that on every request. We only care about the `exp` claim.
 */
const SERVER_TOKEN_EXPIRY_SAFETY_MARGIN_SEC = 300; // 5 minutes

function isJwtNearExpiry(
  token: string,
  safetyMarginSec = SERVER_TOKEN_EXPIRY_SAFETY_MARGIN_SEC,
): boolean {
  // Tokens are cached verbatim from the realm server's `Authorization`
  // response header, so they're prefixed with `Bearer ` — strip it before
  // decoding or jsonwebtoken returns null and we'd refresh on every call.
  let raw = token.replace(/^Bearer\s+/i, '');
  let decoded = jwt.decode(raw) as { exp?: number } | null;
  if (!decoded?.exp) return true; // unparseable / missing exp → treat as expired
  let nowSec = Math.floor(Date.now() / 1000);
  return decoded.exp - nowSec < safetyMarginSec;
}

export const NO_ACTIVE_PROFILE_ERROR =
  'No active profile. Run `boxel profile add` to create one.';

// The error for a profile asked for by name that isn't saved. It lists the
// saved profiles, as `boxel profile list` would, so the caller can see the
// right ID without running it.
export function unknownProfileMessage(
  profileId: string,
  savedProfileIds: string[],
): string {
  if (savedProfileIds.length === 0) {
    return `No profile named "${profileId}", and no profiles are saved. Run \`boxel profile add\` to create one.`;
  }
  return (
    `No profile named "${profileId}". Saved profiles: ${savedProfileIds.join(', ')}. ` +
    `Run \`boxel profile list\` to see your profiles.`
  );
}

function noSessionMessage(profileId: string): string {
  return (
    `Profile "${profileId}" has no stored Matrix access token. ` +
    `Run \`boxel profile add\` to re-authenticate.`
  );
}

type ProfilesFileRead =
  | { kind: 'missing' }
  | { kind: 'ok'; config: ProfilesConfig }
  | { kind: 'unreadable'; message: string };

/**
 * Bootstrap realms (the base realm) are registered — and tokened by
 * `_realm-auth` — under a `https://cardstack.com/<name>/` alias, but are
 * served over HTTP at `<realm-server>/<name>/`. Returns the `<name>` for
 * an aliased realm URL so token lookup can mirror the realm server's own
 * aliasing; undefined for every other realm URL.
 */
function aliasedRealmName(realmUrl: string): string | undefined {
  let match = realmUrl.match(/^https:\/\/cardstack\.com\/([^/]+)\/$/);
  return match?.[1];
}

export interface Profile {
  displayName: string;
  matrixUrl: string;
  realmServerUrl: string;
  matrixAccessToken: string;
  matrixUserId: string;
  matrixDeviceId: string;
  realmTokens?: Record<string, string>;
  realmServerToken?: string;
  // A session signed in on the secure origin, through the browser (`boxel
  // keys sign-in`). Only it can authorize a change to the user's keys; the
  // `realmServerToken` above, from the CLI's ordinary sign-in, can't.
  secureSession?: SecureSessionRecord;
}

export interface SecureSessionRecord {
  token: string;
  userId: string;
  expiresAt: string;
}

export interface ProfilesConfig {
  profiles: Record<string, Profile>;
  activeProfile: string | null;
}

export type Environment = 'staging' | 'production' | 'local' | 'unknown';

/**
 * Extract environment from Matrix user ID
 * @example @ctse:stack.cards -> staging
 * @example @ctse:boxel.ai -> production
 */
export function getEnvironmentFromMatrixId(matrixId: string): Environment {
  if (matrixId.endsWith(':stack.cards')) return 'staging';
  if (matrixId.endsWith(':boxel.ai')) return 'production';
  if (matrixId.endsWith(':localhost')) return 'local';
  return 'unknown';
}

/**
 * Extract username from Matrix user ID
 * @example @ctse:stack.cards -> ctse
 */
export function getUsernameFromMatrixId(matrixId: string): string {
  const match = matrixId.match(/^@([^:]+):/);
  return match ? match[1] : matrixId;
}

/**
 * Get domain from Matrix user ID
 * @example @ctse:stack.cards -> stack.cards
 */
export function getDomainFromMatrixId(matrixId: string): string {
  const match = matrixId.match(/:([^:]+)$/);
  return match ? match[1] : 'unknown';
}

/**
 * Get environment label for display (uses domain)
 */
export function getEnvironmentLabel(env: Environment): string {
  switch (env) {
    case 'staging':
      return 'stack.cards';
    case 'production':
      return 'boxel.ai';
    case 'local':
      return 'localhost';
    default:
      return 'unknown';
  }
}

/**
 * Format profile for display in command output
 * @example [ctse · stack.cards]
 */
export function formatProfileBadge(matrixId: string): string {
  const username = getUsernameFromMatrixId(matrixId);
  const domain = getDomainFromMatrixId(matrixId);
  return `${DIM}[${RESET}${FG_CYAN}${username}${RESET} ${DIM}\u00b7${RESET} ${FG_MAGENTA}${domain}${RESET}${DIM}]${RESET}`;
}

export class ProfileManager implements RealmAuthenticator {
  private config: ProfilesConfig;
  private configDir: string;
  private profilesFile: string;
  private matrixLoginFn: typeof matrixLogin;
  private promptPasswordFn: (question: string) => Promise<string>;
  private isTtyFn: () => boolean;
  private renameFileFn: (from: string, to: string) => void;
  // Set when a profiles file exists on disk but couldn't be read as a profiles
  // store (unparseable, or a shape we don't recognize). The manager still
  // starts empty so `profile add` can recover, but discovery callers must be
  // able to tell "couldn't read the store" apart from "no profiles yet" —
  // otherwise an unreadable store reads as an absent profile.
  private loadError: string | null = null;
  // The profile this process acts as when one was picked for it
  // (`selectProfile`, which `--profile` and `BOXEL_PROFILE` reach). Never
  // written to the profiles file: the active profile there stays whatever it
  // was.
  private selectedProfileId: string | null = null;

  constructor(configDir?: string, deps?: ProfileManagerDeps) {
    this.configDir = configDir || DEFAULT_CONFIG_DIR;
    this.profilesFile = path.join(this.configDir, PROFILES_FILENAME);
    this.config = this.loadConfig();
    this.matrixLoginFn = deps?.matrixLogin ?? matrixLogin;
    this.promptPasswordFn = deps?.promptPassword ?? defaultPromptPassword;
    this.isTtyFn = deps?.isTty ?? (() => Boolean(process.stdin.isTTY));
    this.renameFileFn = deps?.renameFile ?? fs.renameSync;
  }

  private ensureConfigDir(): void {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
  }

  private readProfilesFile(): ProfilesFileRead {
    // A missing file is the genuine "no profiles yet" case, not a load error.
    if (!fs.existsSync(this.profilesFile)) {
      return { kind: 'missing' };
    }

    try {
      const data = fs.readFileSync(this.profilesFile, 'utf-8');
      const parsed: unknown = JSON.parse(data);

      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const candidate = parsed as Record<string, unknown>;
        const profiles =
          candidate.profiles &&
          typeof candidate.profiles === 'object' &&
          !Array.isArray(candidate.profiles)
            ? (candidate.profiles as ProfilesConfig['profiles'])
            : null;
        const activeProfile =
          candidate.activeProfile === null ||
          typeof candidate.activeProfile === 'string'
            ? (candidate.activeProfile as string | null)
            : null;

        if (profiles) {
          return { kind: 'ok', config: { profiles, activeProfile } };
        }
      }
      // The file existed and parsed, but isn't a profiles store we recognize.
      return {
        kind: 'unreadable',
        message:
          `Profiles file at ${this.profilesFile} is not a recognizable profiles store; ` +
          `starting with no profiles.`,
      };
    } catch (err) {
      return {
        kind: 'unreadable',
        message:
          `Could not read profiles file at ${this.profilesFile}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  private loadConfig(): ProfilesConfig {
    let read = this.readProfilesFile();
    if (read.kind === 'ok') {
      return read.config;
    }
    if (read.kind === 'unreadable') {
      // Start empty so `profile add` can recover, but remember the failure so
      // discovery can report it.
      this.loadError = read.message;
    }
    return { profiles: {}, activeProfile: null };
  }

  // Non-null when a profiles file exists but couldn't be loaded — see
  // `loadError`. Discovery callers (`profile list`) report it rather than
  // presenting an unreadable store as an empty one.
  getLoadError(): string | null {
    return this.loadError;
  }

  // Make a change to the profiles store and save it. The change is applied
  // twice: to this process's copy, and then to the profiles file as it is now,
  // re-read, before that is written back. A change touches only the fields it
  // is about, and decides from what it's applied to, so whatever another
  // process saved since this one loaded the file is kept: a switch, a
  // sign-in, a token, a profile it added or removed.
  //
  // This process's copy isn't refreshed from the file, so the profile a
  // running command acts as never changes under it. Nothing locks the file:
  // two saves that overlap in the moment between one's read and its write can
  // still lose one of the two changes.
  private commit(change: (config: ProfilesConfig) => void): void {
    change(this.config);
    this.ensureConfigDir();
    let read = this.readProfilesFile();
    let toWrite: ProfilesConfig;
    if (read.kind === 'unreadable') {
      // Replaced outright, which is how `profile add` recovers from an
      // unreadable file.
      toWrite = this.config;
    } else {
      toWrite =
        read.kind === 'ok'
          ? read.config
          : { profiles: {}, activeProfile: null };
      change(toWrite);
    }
    this.writeProfilesFile(toWrite);
  }

  // Change fields of one saved profile. A profile that another process
  // removed since this one loaded the file stays removed.
  private updateProfile(
    profileId: string,
    update: (profile: Profile) => void,
  ): void {
    this.commit((config) => {
      let profile = config.profiles[profileId];
      if (profile) {
        update(profile);
      }
    });
  }

  // Change fields of the profile this process acts as (see
  // `getActiveProfileId`), when there is one.
  private updateActiveProfile(update: (profile: Profile) => void): void {
    let active = this.getActiveProfile();
    if (active) {
      this.updateProfile(active.id, update);
    }
  }

  // Replace the profiles file by a rename, so a process reading it never sees
  // it half-written. Where the rename is refused (on Windows, while another
  // program has the file open) the file is written in place instead. The
  // temporary file holds tokens, so it doesn't outlive this call.
  private writeProfilesFile(config: ProfilesConfig): void {
    let data = JSON.stringify(config, null, 2);
    let tempFile = `${this.profilesFile}.${process.pid}.${randomUUID()}.tmp`;
    try {
      // `wx` makes a new file, so `mode` applies: only the owner can read it.
      fs.writeFileSync(tempFile, data, { mode: 0o600, flag: 'wx' });
      try {
        this.renameFileFn(tempFile, this.profilesFile);
      } catch (err) {
        let code = (err as NodeJS.ErrnoException).code;
        if (!code || !RENAME_REFUSED_CODES.has(code)) {
          throw err;
        }
        fs.writeFileSync(this.profilesFile, data, { mode: 0o600 });
      }
    } finally {
      fs.rmSync(tempFile, { force: true });
    }
  }

  listProfiles(): string[] {
    return Object.keys(this.config.profiles);
  }

  getProfile(profileId: string): Profile | undefined {
    return this.config.profiles[profileId];
  }

  // Act as `profileId` for the rest of this process, whatever the active
  // profile is. Nothing is written: the active profile in the profiles file,
  // which every other terminal and session uses, stays as it was. Tokens
  // minted from here on are saved to this profile's entry.
  //
  // Throws, without selecting anything, when the profiles file can't be read,
  // when no profile has this exact ID, or when it has no stored session.
  selectProfile(profileId: string): void {
    if (this.loadError) {
      throw new Error(this.loadError);
    }
    let profile = this.config.profiles[profileId];
    if (!profile) {
      throw new Error(unknownProfileMessage(profileId, this.listProfiles()));
    }
    if (!profile.matrixAccessToken) {
      throw new Error(noSessionMessage(profileId));
    }
    this.selectedProfileId = profileId;
  }

  // The ID of the profile this process acts as: the one `selectProfile`
  // picked, or else the active profile from the profiles file.
  getActiveProfileId(): string | null {
    return this.selectedProfileId ?? this.config.activeProfile;
  }

  // The profile this process acts as. See `getActiveProfileId`.
  getActiveProfile(): { id: string; profile: Profile } | null {
    const id = this.getActiveProfileId();
    if (!id) return null;
    const profile = this.config.profiles[id];
    if (!profile) return null;
    return { id, profile };
  }

  // Resolve {matrixUrl, realmServerUrl, displayName} from environment defaults
  // and caller-provided overrides. Shared by `addProfile` and
  // `addProfileWithAuth` so both paths agree on naming + URL inference.
  private resolveProfileSlots(
    matrixId: string,
    displayName: string | undefined,
    matrixUrl: string | undefined,
    realmServerUrl: string | undefined,
  ): {
    matrixUrl: string;
    realmServerUrl: string;
    displayName: string;
    username: string;
  } {
    const env = getEnvironmentFromMatrixId(matrixId);
    const username = getUsernameFromMatrixId(matrixId);

    if (env === 'unknown' && (!matrixUrl || !realmServerUrl)) {
      throw new Error(
        `Unknown domain in Matrix ID "${matrixId}". You must provide explicit --matrix-url and --realm-server-url for non-standard domains.`,
      );
    }

    let defaultMatrixUrl: string;
    let defaultRealmUrl: string;
    if (env === 'production') {
      defaultMatrixUrl = 'https://matrix.boxel.ai';
      defaultRealmUrl = 'https://app.boxel.ai/';
    } else if (env === 'local') {
      defaultMatrixUrl = 'http://localhost:8008';
      defaultRealmUrl = 'https://localhost:4201/';
    } else {
      defaultMatrixUrl = 'https://matrix-staging.stack.cards';
      defaultRealmUrl = 'https://realms-staging.stack.cards/';
    }

    const domain = getDomainFromMatrixId(matrixId);
    return {
      matrixUrl: matrixUrl || defaultMatrixUrl,
      realmServerUrl: realmServerUrl || defaultRealmUrl,
      displayName: displayName || `${username} \u00b7 ${domain}`,
      username,
    };
  }

  // Persist a profile from an already-acquired MatrixAuth. The token is
  // stored; the original password (if any) never reaches this function. Used
  // directly by tests, and as the "store" half of `addProfile`. The profile
  // becomes the active one when no profile is.
  async addProfileWithAuth(
    matrixId: string,
    auth: MatrixAuth,
    displayName?: string,
    realmServerUrl?: string,
    // A secure session the same sign-in gave this profile, which replaces any
    // it had.
    secureSession?: SecureSessionRecord,
  ): Promise<void> {
    const slots = this.resolveProfileSlots(
      matrixId,
      displayName,
      auth.matrixUrl,
      realmServerUrl,
    );

    this.commit((config) => {
      // When re-authing an existing profile we keep its cached realm tokens \u2014
      // a fresh access token doesn't invalidate the realm-server JWT. But if
      // the matrix or realm-server URL changed, the cached tokens were minted
      // against the old servers and must be dropped.
      const existing = config.profiles[matrixId];
      const urlsChanged =
        !!existing &&
        (existing.matrixUrl !== slots.matrixUrl ||
          existing.realmServerUrl !== slots.realmServerUrl);
      config.profiles[matrixId] = {
        displayName: slots.displayName,
        matrixUrl: slots.matrixUrl,
        realmServerUrl: slots.realmServerUrl,
        matrixAccessToken: auth.accessToken,
        matrixUserId: auth.userId,
        matrixDeviceId: auth.deviceId,
        realmTokens: urlsChanged ? undefined : existing?.realmTokens,
        realmServerToken: urlsChanged ? undefined : existing?.realmServerToken,
        // The key-management sign-in is for this profile's realm server, so
        // it carries over a re-authentication against the same one.
        secureSession:
          secureSession ?? (urlsChanged ? undefined : existing?.secureSession),
      };
      if (!config.activeProfile) {
        config.activeProfile = matrixId;
      }
    });
  }

  async addProfile(
    matrixId: string,
    password: string,
    displayName?: string,
    matrixUrl?: string,
    realmServerUrl?: string,
  ): Promise<void> {
    // On re-auth, default omitted args to the existing profile's stored
    // values so we don't silently reset display name or URLs to defaults.
    const existing = this.config.profiles[matrixId];
    const slots = this.resolveProfileSlots(
      matrixId,
      displayName ?? existing?.displayName,
      matrixUrl ?? existing?.matrixUrl,
      realmServerUrl ?? existing?.realmServerUrl,
    );

    const auth = await this.matrixLoginFn(
      slots.matrixUrl,
      slots.username,
      password,
    );

    if (auth.userId !== matrixId) {
      throw new Error(
        `Matrix returned userId "${auth.userId}" but profile was added as "${matrixId}". ` +
          `Check the Matrix ID and try again.`,
      );
    }

    await this.addProfileWithAuth(
      matrixId,
      auth,
      slots.displayName,
      slots.realmServerUrl,
    );
  }

  async removeProfile(profileId: string): Promise<boolean> {
    if (!this.config.profiles[profileId]) {
      return false;
    }

    this.commit((config) => {
      delete config.profiles[profileId];
      if (config.activeProfile === profileId) {
        const remaining = Object.keys(config.profiles);
        config.activeProfile = remaining.length > 0 ? remaining[0] : null;
      }
    });
    return true;
  }

  switchProfile(profileId: string): boolean {
    if (!this.config.profiles[profileId]) {
      return false;
    }
    this.commit((config) => {
      if (config.profiles[profileId]) {
        config.activeProfile = profileId;
      }
    });
    return true;
  }

  updateDisplayName(profileId: string, displayName: string): boolean {
    if (!this.config.profiles[profileId]) {
      return false;
    }
    this.updateProfile(profileId, (profile) => {
      profile.displayName = displayName;
    });
    return true;
  }

  // Update one or both server URLs for an existing profile. Cached realm
  // tokens (and the realm-server token) are tied to the previous servers,
  // so they're cleared whenever URLs actually change.
  // Returns true iff at least one URL changed.
  updateUrls(
    profileId: string,
    urls: { matrixUrl?: string; realmServerUrl?: string },
  ): boolean {
    const profile = this.config.profiles[profileId];
    if (!profile) {
      return false;
    }
    let differs = (p: Profile) =>
      (!!urls.matrixUrl && urls.matrixUrl !== p.matrixUrl) ||
      (!!urls.realmServerUrl && urls.realmServerUrl !== p.realmServerUrl);
    if (!differs(profile)) {
      return false;
    }
    this.updateProfile(profileId, (p) => {
      if (!differs(p)) {
        return;
      }
      p.matrixUrl = urls.matrixUrl || p.matrixUrl;
      p.realmServerUrl = urls.realmServerUrl || p.realmServerUrl;
      p.realmTokens = undefined;
      p.realmServerToken = undefined;
      p.secureSession = undefined;
    });
    return true;
  }

  setRealmToken(realmUrl: string, token: string): void {
    this.updateActiveProfile((profile) => {
      profile.realmTokens = { ...profile.realmTokens, [realmUrl]: token };
    });
  }

  getRealmToken(realmUrl: string): string | undefined {
    let active = this.getActiveProfile();
    return active?.profile.realmTokens?.[realmUrl];
  }

  setRealmServerToken(token: string): void {
    this.updateActiveProfile((profile) => {
      profile.realmServerToken = token;
    });
  }

  getRealmServerToken(): string | undefined {
    let active = this.getActiveProfile();
    return active?.profile.realmServerToken;
  }

  setSecureSession(session: SecureSessionRecord): void {
    this.updateActiveProfile((profile) => {
      profile.secureSession = session;
    });
  }

  // The active profile's secure session, while it lasts.
  getSecureSession(): SecureSessionRecord | undefined {
    let session = this.getActiveProfile()?.profile.secureSession;
    if (!session || Date.parse(session.expiresAt) <= Date.now()) {
      return undefined;
    }
    return session;
  }

  // Forget the secure session this process holds. One that another process
  // signed in since this one loaded the profiles file is kept.
  clearSecureSession(): void {
    let held = this.getActiveProfile()?.profile.secureSession?.token;
    if (!held) {
      return;
    }
    this.updateActiveProfile((profile) => {
      if (profile.secureSession?.token === held) {
        profile.secureSession = undefined;
      }
    });
  }

  // Return the Matrix credentials stored for a profile. Sync — reads only
  // the in-memory `this.config`, which is populated by the constructor.
  // Throws when the profile has no stored token yet (e.g. a pre-CS-10725
  // profile still on disk from before the password→token swap).
  getStoredMatrixAuth(profileId?: string): MatrixAuth {
    const targetId = profileId ?? this.getActiveProfileId() ?? undefined;
    const profile = targetId ? this.config.profiles[targetId] : undefined;
    if (!targetId || !profile) {
      throw new Error(NO_ACTIVE_PROFILE_ERROR);
    }
    if (!profile.matrixAccessToken) {
      throw new Error(noSessionMessage(targetId));
    }
    return {
      accessToken: profile.matrixAccessToken,
      userId: profile.matrixUserId,
      deviceId: profile.matrixDeviceId,
      matrixUrl: profile.matrixUrl,
    };
  }

  // When the stored access token gets rejected by Matrix (revoked, expired,
  // server-side device deletion), prompt the user for their password on a
  // TTY, run matrixLogin again, persist the new tokens, and return the
  // refreshed MatrixAuth. Non-TTY contexts get a clear "re-add the profile"
  // error instead of hanging on a prompt that can never be answered.
  async reAuthenticate(profileId?: string): Promise<MatrixAuth> {
    const targetId = profileId ?? this.getActiveProfileId() ?? undefined;
    const profile = targetId ? this.config.profiles[targetId] : undefined;
    if (!targetId || !profile) {
      throw new Error(NO_ACTIVE_PROFILE_ERROR);
    }

    if (!this.isTtyFn()) {
      throw new Error(
        `Stored Matrix token for "${targetId}" is no longer valid. ` +
          `Run \`boxel profile add -u ${targetId} -p <password>\` to re-authenticate.`,
      );
    }

    console.log(
      `\n${FG_YELLOW}Stored Matrix session for ${formatProfileBadge(targetId)} has expired.${RESET}`,
    );
    const password = await this.promptPasswordFn(`Password for ${targetId}: `);
    if (!password) {
      throw new Error('Re-authentication cancelled: password is required.');
    }

    const username = getUsernameFromMatrixId(targetId);
    const auth = await this.matrixLoginFn(
      profile.matrixUrl,
      username,
      password,
    );
    // Only the Matrix session changes. Which profile is active is left alone,
    // so a command acting as a selected profile doesn't make it the active
    // one, and so are the profile's realm tokens: a fresh access token
    // doesn't invalidate them.
    this.updateProfile(targetId, (p) => {
      p.matrixAccessToken = auth.accessToken;
      p.matrixUserId = auth.userId;
      p.matrixDeviceId = auth.deviceId;
    });
    return this.getStoredMatrixAuth(targetId);
  }

  // Wrap a realm-server-token fetch in the standard "if Matrix says 401,
  // re-auth and retry once" recovery. Centralised so getOrRefreshServerToken
  // and refreshServerToken share the same behaviour.
  private async fetchRealmServerTokenWithReauth(): Promise<string> {
    const matrixAuth = this.getStoredMatrixAuth();
    const active = this.getActiveProfile()!;
    const realmServerUrl = active.profile.realmServerUrl.replace(/\/$/, '');
    try {
      const token = await fetchRealmServerToken(matrixAuth, realmServerUrl);
      this.setRealmServerToken(token);
      return token;
    } catch (e) {
      if (!(e instanceof MatrixAuthError)) {
        throw e;
      }
      const freshAuth = await this.reAuthenticate();
      const token = await fetchRealmServerToken(freshAuth, realmServerUrl);
      this.setRealmServerToken(token);
      return token;
    }
  }

  async getOrRefreshServerToken(): Promise<string> {
    let cached = this.getRealmServerToken();
    if (cached && !isJwtNearExpiry(cached)) {
      return cached;
    }
    return this.fetchRealmServerTokenWithReauth();
  }

  async refreshServerToken(): Promise<string> {
    return this.fetchRealmServerTokenWithReauth();
  }

  // Mint a long-lived realm-server token for a consumer that will hold the bare
  // string and cannot re-mint when it lapses. Deliberately not cached: the
  // cached slot feeds the CLI's own fetch wrappers, which recover from a 401 and
  // so should keep taking the shorter default rather than inherit this one's
  // lifetime.
  async mintExtendedServerToken(): Promise<string> {
    const matrixAuth = this.getStoredMatrixAuth();
    const active = this.getActiveProfile()!;
    const realmServerUrl = active.profile.realmServerUrl.replace(/\/$/, '');
    try {
      return await fetchRealmServerToken(matrixAuth, realmServerUrl, {
        extendedLifetime: true,
      });
    } catch (e) {
      if (!(e instanceof MatrixAuthError)) {
        throw e;
      }
      const freshAuth = await this.reAuthenticate();
      return fetchRealmServerToken(freshAuth, realmServerUrl, {
        extendedLifetime: true,
      });
    }
  }

  private findRealmTokenForUrl(url: string): string | undefined {
    let active = this.getActiveProfile();
    if (!active?.profile.realmTokens) {
      return undefined;
    }
    let serverUrl = active.profile.realmServerUrl.replace(/\/+$/, '') + '/';
    for (let [realmUrl, token] of Object.entries(active.profile.realmTokens)) {
      if (!token) {
        continue;
      }
      if (url.startsWith(realmUrl)) {
        return token;
      }
      let aliasedName = aliasedRealmName(realmUrl);
      if (aliasedName && url.startsWith(`${serverUrl}${aliasedName}/`)) {
        return token;
      }
    }
    return undefined;
  }

  private async fetchAndStoreAllRealmTokens(): Promise<void> {
    let serverToken = await this.getOrRefreshServerToken();
    let active = this.getActiveProfile()!;
    let realmServerUrl = active.profile.realmServerUrl.replace(/\/$/, '');
    let tokens = await getRealmTokens(realmServerUrl, serverToken);
    for (let [realmUrl, token] of Object.entries(tokens)) {
      this.setRealmToken(realmUrl, token);
    }
  }

  // The realm, among those the active profile holds a token for, that serves
  // `url`: the longest whose URL `url` starts with, as it is served. A
  // bootstrap realm's token is keyed by its `https://cardstack.com/<name>/`
  // id and served at `<realm server>/<name>/`, which is what this answers.
  async realmUrlFor(url: string): Promise<string | undefined> {
    let find = () => {
      let active = this.getActiveProfile();
      if (!active) {
        return undefined;
      }
      let serverUrl = active.profile.realmServerUrl.replace(/\/+$/, '') + '/';
      return Object.entries(active.profile.realmTokens ?? {})
        .filter(([, token]) => token)
        .flatMap(([realmUrl]) => {
          let aliasedName = aliasedRealmName(realmUrl);
          let served = aliasedName ? `${serverUrl}${aliasedName}/` : realmUrl;
          return [realmUrl, served]
            .filter((prefix) => url.startsWith(prefix))
            .map((prefix) => ({ prefix, served }));
        })
        .sort((a, b) => b.prefix.length - a.prefix.length)[0]?.served;
    };
    let found = find();
    if (found) {
      return found;
    }
    try {
      await this.fetchAndStoreAllRealmTokens();
    } catch {
      return undefined;
    }
    return find();
  }

  async getRealmTokenForUrl(url: string): Promise<string | undefined> {
    let realmToken = this.findRealmTokenForUrl(url);
    if (realmToken) {
      return realmToken;
    }

    try {
      await this.fetchAndStoreAllRealmTokens();
    } catch {
      // Token prefetch failed (e.g. expired server token) — caller will handle 401 retry
      return undefined;
    }
    return this.findRealmTokenForUrl(url);
  }

  private buildHeaders(
    input: string | URL | Request,
    init: RequestInit | undefined,
    token: string,
  ): Headers {
    let baseHeaders =
      input instanceof Request ? new Headers(input.headers) : new Headers();
    let initHeaders = new Headers(init?.headers);
    for (let [key, value] of initHeaders) {
      baseHeaders.set(key, value);
    }
    if (!baseHeaders.has('Authorization')) {
      baseHeaders.set('Authorization', token);
    }
    return baseHeaders;
  }

  async authedRealmFetch(
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> {
    let url =
      input instanceof Request
        ? input.url
        : input instanceof URL
          ? input.href
          : input;

    let token = await this.getRealmTokenForUrl(url);
    if (token) {
      let headers = this.buildHeaders(input, init, token);
      let response = await realmFetch(input, { ...init, headers });

      if (response.status !== 401) {
        return response;
      }
    }

    // Either no cached realm token (e.g. server token was expired during
    // prefetch) or the request got a 401. Refresh everything and retry.
    let active = this.getActiveProfile();
    if (active) {
      // Forget the tokens this process holds. Any that another process minted
      // since this one loaded the profiles file are kept.
      let heldRealmTokens = { ...active.profile.realmTokens };
      let heldServerToken = active.profile.realmServerToken;
      this.updateActiveProfile((profile) => {
        let realmTokens = { ...profile.realmTokens };
        for (let [realmUrl, token] of Object.entries(heldRealmTokens)) {
          if (realmTokens[realmUrl] === token) {
            delete realmTokens[realmUrl];
          }
        }
        profile.realmTokens = realmTokens;
        if (profile.realmServerToken === heldServerToken) {
          profile.realmServerToken = undefined;
        }
      });
    }
    await this.fetchAndStoreAllRealmTokens();
    token = this.findRealmTokenForUrl(url);
    if (!token) {
      throw new Error(
        `No realm token available for ${url}. The realm may not be accessible.`,
      );
    }
    let headers = this.buildHeaders(input, init, token);
    let response = await realmFetch(input, { ...init, headers });

    return response;
  }

  async authedRealmServerFetch(
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> {
    let token = await this.getOrRefreshServerToken();
    let headers = this.buildHeaders(input, init, token);
    let response = await fetch(input, { ...init, headers });

    if (response.status === 401) {
      token = await this.refreshServerToken();
      headers = this.buildHeaders(input, init, token);
      response = await fetch(input, { ...init, headers });
    }

    return response;
  }

  async fetchAndStoreRealmToken(
    realmUrl: string,
    serverToken: string,
  ): Promise<string | undefined> {
    let active = this.getActiveProfile()!;
    let realmServerUrl = active.profile.realmServerUrl.replace(/\/$/, '');
    let tokens = await getRealmTokens(realmServerUrl, serverToken);
    let token = tokens[realmUrl];
    if (token) {
      this.setRealmToken(realmUrl, token);
    }
    return token;
  }

  // Run a Matrix call that uses the stored access token, falling back to
  // interactive re-auth + retry on a 401 (revoked / expired token).
  private async withMatrixAuthRecovery<T>(
    fn: (matrixAuth: MatrixAuth) => Promise<T>,
  ): Promise<T> {
    try {
      return await fn(this.getStoredMatrixAuth());
    } catch (e) {
      if (!(e instanceof MatrixAuthError)) {
        throw e;
      }
      const freshAuth = await this.reAuthenticate();
      return fn(freshAuth);
    }
  }

  async addToUserRealms(realmUrl: string): Promise<void> {
    await this.withMatrixAuthRecovery((auth) =>
      addRealmToMatrixAccountData(auth, realmUrl),
    );
  }

  async removeFromUserRealms(realmUrl: string): Promise<boolean> {
    return this.withMatrixAuthRecovery((auth) =>
      removeRealmFromMatrixAccountData(auth, realmUrl),
    );
  }

  async getUserRealms(): Promise<string[]> {
    return this.withMatrixAuthRecovery((auth) =>
      getUserRealmsFromMatrixAccountData(auth),
    );
  }

  async migrateFromEnv(): Promise<{
    profileId: string;
    created: boolean;
  } | null> {
    const matrixUrl = process.env.MATRIX_URL;
    const username = process.env.MATRIX_USERNAME;
    const password = process.env.MATRIX_PASSWORD;
    const realmServerUrl = process.env.REALM_SERVER_URL;

    if (!matrixUrl || !username || !password || !realmServerUrl) {
      return null;
    }

    // The homeserver names the account it signs in. Its server name can
    // differ from the hostname in MATRIX_URL, so the profile is keyed by the
    // user id the sign-in returns.
    const auth = await this.matrixLoginFn(matrixUrl, username, password);
    const matrixId = auth.userId;

    const existing = this.config.profiles[matrixId];
    await this.addProfileWithAuth(
      matrixId,
      auth,
      existing?.displayName,
      realmServerUrl,
    );
    return { profileId: matrixId, created: !existing };
  }

  printStatus(): void {
    const active = this.getActiveProfile();
    if (active) {
      console.log(
        `\n${BOLD}Active Profile:${RESET} ${formatProfileBadge(active.id)}`,
      );
      console.log(
        `  ${DIM}Display Name:${RESET} ${active.profile.displayName}`,
      );
      console.log(`  ${DIM}Matrix URL:${RESET} ${active.profile.matrixUrl}`);
      console.log(
        `  ${DIM}Realm Server:${RESET} ${active.profile.realmServerUrl}`,
      );
    } else {
      console.log(
        `\n${FG_YELLOW}No active profile and no environment variables set.${RESET}`,
      );
      console.log(
        `Run ${FG_CYAN}boxel profile add${RESET} to create a profile.`,
      );
    }
  }
}

// Singleton instance — callers needing a custom configDir should use
// `new ProfileManager(dir)` directly.
let _instance: ProfileManager | null = null;

export function getProfileManager(): ProfileManager {
  if (!_instance) {
    _instance = new ProfileManager();
  }
  return _instance;
}

/**
 * Reset the singleton (useful for testing)
 */
export function resetProfileManager(): void {
  _instance = null;
}

/**
 * Replace the singleton with a ProfileManager using a custom config directory.
 * Useful for tests that need an isolated profile without touching the real
 * ~/.boxel-cli/profiles.json.
 */
export function setProfileManager(configDir: string): void {
  _instance = new ProfileManager(configDir);
}
