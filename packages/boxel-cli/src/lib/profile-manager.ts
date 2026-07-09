import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
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

export interface ProfileManagerDeps {
  matrixLogin?: typeof matrixLogin;
  promptPassword?: (question: string) => Promise<string>;
  isTty?: () => boolean;
}

const DEFAULT_CONFIG_DIR = path.join(os.homedir(), '.boxel-cli');
const PROFILES_FILENAME = 'profiles.json';

/**
 * Tokens issued by the realm server carry a 7-day TTL. Re-mint when
 * there's less than a day left so a long-running operation (or a
 * downstream consumer that bakes the token into a static header, like
 * opencode's passthrough provider) doesn't get a 401 mid-flight.
 *
 * Decode-only — we don't verify the signature; the realm server does
 * that on every request. We only care about the `exp` claim.
 */
const SERVER_TOKEN_EXPIRY_SAFETY_MARGIN_SEC = 86400; // 1 day

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

  constructor(configDir?: string, deps?: ProfileManagerDeps) {
    this.configDir = configDir || DEFAULT_CONFIG_DIR;
    this.profilesFile = path.join(this.configDir, PROFILES_FILENAME);
    this.config = this.loadConfig();
    this.matrixLoginFn = deps?.matrixLogin ?? matrixLogin;
    this.promptPasswordFn = deps?.promptPassword ?? defaultPromptPassword;
    this.isTtyFn = deps?.isTty ?? (() => Boolean(process.stdin.isTTY));
  }

  private ensureConfigDir(): void {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
  }

  private loadConfig(): ProfilesConfig {
    const defaultConfig: ProfilesConfig = { profiles: {}, activeProfile: null };

    if (fs.existsSync(this.profilesFile)) {
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
            return { profiles, activeProfile };
          }
        }
      } catch {
        // Corrupted file, start fresh
      }
    }
    return defaultConfig;
  }

  private saveConfig(): void {
    this.ensureConfigDir();
    fs.writeFileSync(this.profilesFile, JSON.stringify(this.config, null, 2), {
      mode: 0o600,
    });
    try {
      fs.chmodSync(this.profilesFile, 0o600);
    } catch {
      // Ignore permission errors on Windows
    }
  }

  listProfiles(): string[] {
    return Object.keys(this.config.profiles);
  }

  getProfile(profileId: string): Profile | undefined {
    return this.config.profiles[profileId];
  }

  getActiveProfileId(): string | null {
    return this.config.activeProfile;
  }

  getActiveProfile(): { id: string; profile: Profile } | null {
    const id = this.config.activeProfile;
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
  // directly by tests, and as the "store" half of `addProfile`.
  // When re-authing an existing profile we keep its cached realm tokens \u2014 a
  // fresh access token doesn't invalidate the realm-server JWT. But if the
  // matrix or realm-server URL changed, the cached tokens were minted against
  // the old servers and must be dropped.
  async addProfileWithAuth(
    matrixId: string,
    auth: MatrixAuth,
    displayName?: string,
    realmServerUrl?: string,
  ): Promise<void> {
    const slots = this.resolveProfileSlots(
      matrixId,
      displayName,
      auth.matrixUrl,
      realmServerUrl,
    );

    const existing = this.config.profiles[matrixId];
    const urlsChanged =
      !!existing &&
      (existing.matrixUrl !== slots.matrixUrl ||
        existing.realmServerUrl !== slots.realmServerUrl);
    const profile: Profile = {
      displayName: slots.displayName,
      matrixUrl: slots.matrixUrl,
      realmServerUrl: slots.realmServerUrl,
      matrixAccessToken: auth.accessToken,
      matrixUserId: auth.userId,
      matrixDeviceId: auth.deviceId,
      realmTokens: urlsChanged ? undefined : existing?.realmTokens,
      realmServerToken: urlsChanged ? undefined : existing?.realmServerToken,
    };

    this.config.profiles[matrixId] = profile;

    if (!this.config.activeProfile) {
      this.config.activeProfile = matrixId;
    }

    this.saveConfig();
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

    delete this.config.profiles[profileId];

    if (this.config.activeProfile === profileId) {
      const remaining = Object.keys(this.config.profiles);
      this.config.activeProfile = remaining.length > 0 ? remaining[0] : null;
    }

    this.saveConfig();
    return true;
  }

  switchProfile(profileId: string): boolean {
    if (!this.config.profiles[profileId]) {
      return false;
    }
    this.config.activeProfile = profileId;
    this.saveConfig();
    return true;
  }

  updateDisplayName(profileId: string, displayName: string): boolean {
    if (!this.config.profiles[profileId]) {
      return false;
    }
    this.config.profiles[profileId].displayName = displayName;
    this.saveConfig();
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
    let changed = false;
    if (urls.matrixUrl && urls.matrixUrl !== profile.matrixUrl) {
      profile.matrixUrl = urls.matrixUrl;
      changed = true;
    }
    if (urls.realmServerUrl && urls.realmServerUrl !== profile.realmServerUrl) {
      profile.realmServerUrl = urls.realmServerUrl;
      changed = true;
    }
    if (changed) {
      profile.realmTokens = undefined;
      profile.realmServerToken = undefined;
      this.saveConfig();
    }
    return changed;
  }

  setRealmToken(realmUrl: string, token: string): void {
    let active = this.getActiveProfile();
    if (!active) {
      return;
    }
    if (!active.profile.realmTokens) {
      active.profile.realmTokens = {};
    }
    active.profile.realmTokens[realmUrl] = token;
    this.saveConfig();
  }

  getRealmToken(realmUrl: string): string | undefined {
    let active = this.getActiveProfile();
    return active?.profile.realmTokens?.[realmUrl];
  }

  setRealmServerToken(token: string): void {
    let active = this.getActiveProfile();
    if (!active) {
      return;
    }
    active.profile.realmServerToken = token;
    this.saveConfig();
  }

  getRealmServerToken(): string | undefined {
    let active = this.getActiveProfile();
    return active?.profile.realmServerToken;
  }

  // Return the Matrix credentials stored for a profile. Sync — reads only
  // the in-memory `this.config`, which is populated by the constructor.
  // Throws when the profile has no stored token yet (e.g. a pre-CS-10725
  // profile still on disk from before the password→token swap).
  getStoredMatrixAuth(profileId?: string): MatrixAuth {
    const targetId = profileId ?? this.config.activeProfile ?? undefined;
    const profile = targetId ? this.config.profiles[targetId] : undefined;
    if (!targetId || !profile) {
      throw new Error(NO_ACTIVE_PROFILE_ERROR);
    }
    if (!profile.matrixAccessToken) {
      throw new Error(
        `Profile "${targetId}" has no stored Matrix access token. ` +
          `Run \`boxel profile add\` to re-authenticate.`,
      );
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
    const targetId = profileId ?? this.config.activeProfile ?? undefined;
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
    await this.addProfileWithAuth(
      targetId,
      auth,
      profile.displayName,
      profile.realmServerUrl,
    );
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
      let response = await fetch(input, { ...init, headers });

      if (response.status !== 401) {
        return response;
      }
    }

    // Either no cached realm token (e.g. server token was expired during
    // prefetch) or the request got a 401. Refresh everything and retry.
    let active = this.getActiveProfile();
    if (active) {
      active.profile.realmTokens = {};
      active.profile.realmServerToken = undefined;
      this.saveConfig();
    }
    await this.fetchAndStoreAllRealmTokens();
    token = this.findRealmTokenForUrl(url);
    if (!token) {
      throw new Error(
        `No realm token available for ${url}. The realm may not be accessible.`,
      );
    }
    let headers = this.buildHeaders(input, init, token);
    let response = await fetch(input, { ...init, headers });

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

    const isProduction = matrixUrl.includes('boxel.ai');
    const domain = isProduction ? 'boxel.ai' : 'stack.cards';
    const matrixId = `@${username}:${domain}`;

    const created = !this.config.profiles[matrixId];
    await this.addProfile(
      matrixId,
      password,
      undefined,
      matrixUrl,
      realmServerUrl,
    );
    return { profileId: matrixId, created };
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
