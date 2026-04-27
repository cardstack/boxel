import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FG_YELLOW, FG_CYAN, FG_MAGENTA, DIM, BOLD, RESET } from './colors';
import {
  matrixLogin,
  getRealmServerToken as fetchRealmServerToken,
  getRealmTokens,
  addRealmToMatrixAccountData,
  type MatrixAuth,
} from './auth';

const DEFAULT_CONFIG_DIR = path.join(os.homedir(), '.boxel-cli');
const PROFILES_FILENAME = 'profiles.json';

export const NO_ACTIVE_PROFILE_ERROR =
  'No active profile. Run `boxel profile add` to create one.';

export interface Profile {
  displayName: string;
  matrixUrl: string;
  realmServerUrl: string;
  password: string; // Stored in plaintext - file should have restricted permissions, this will be updated in CS-10642
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

export class ProfileManager {
  private config: ProfilesConfig;
  private configDir: string;
  private profilesFile: string;

  constructor(configDir?: string) {
    this.configDir = configDir || DEFAULT_CONFIG_DIR;
    this.profilesFile = path.join(this.configDir, PROFILES_FILENAME);
    this.config = this.loadConfig();
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

  async addProfile(
    matrixId: string,
    password: string,
    displayName?: string,
    matrixUrl?: string,
    realmServerUrl?: string,
  ): Promise<void> {
    const env = getEnvironmentFromMatrixId(matrixId);
    const username = getUsernameFromMatrixId(matrixId);

    if (env === 'unknown' && (!matrixUrl || !realmServerUrl)) {
      throw new Error(
        `Unknown domain in Matrix ID "${matrixId}". You must provide explicit --matrix-url and --realm-server-url for non-standard domains.`,
      );
    }

    const defaultMatrixUrl =
      env === 'production'
        ? 'https://matrix.boxel.ai'
        : 'https://matrix-staging.stack.cards';
    const defaultRealmUrl =
      env === 'production'
        ? 'https://app.boxel.ai/'
        : 'https://realms-staging.stack.cards/';

    const domain = getDomainFromMatrixId(matrixId);
    const profile: Profile = {
      displayName: displayName || `${username} \u00b7 ${domain}`,
      matrixUrl: matrixUrl || defaultMatrixUrl,
      realmServerUrl: realmServerUrl || defaultRealmUrl,
      password,
    };

    this.config.profiles[matrixId] = profile;

    if (!this.config.activeProfile) {
      this.config.activeProfile = matrixId;
    }

    this.saveConfig();
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

  async getActiveCredentials(): Promise<{
    matrixUrl: string;
    username: string;
    password: string;
    realmServerUrl: string;
    profileId: string | null;
  } | null> {
    const active = this.getActiveProfile();
    if (active && active.profile.password) {
      return {
        matrixUrl: active.profile.matrixUrl,
        username: getUsernameFromMatrixId(active.id),
        password: active.profile.password,
        realmServerUrl: active.profile.realmServerUrl,
        profileId: active.id,
      };
    }

    const matrixUrl = process.env.MATRIX_URL;
    const username = process.env.MATRIX_USERNAME;
    const password = process.env.MATRIX_PASSWORD;
    const realmServerUrl = process.env.REALM_SERVER_URL;

    if (matrixUrl && username && password && realmServerUrl) {
      return {
        matrixUrl,
        username,
        password,
        realmServerUrl,
        profileId: null,
      };
    }

    return null;
  }

  async getPassword(profileId: string): Promise<string | null> {
    const profile = this.config.profiles[profileId];
    return profile?.password || null;
  }

  async updatePassword(profileId: string, password: string): Promise<boolean> {
    if (!this.config.profiles[profileId]) {
      return false;
    }
    this.config.profiles[profileId].password = password;
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

  private async loginToMatrix(): Promise<MatrixAuth> {
    let active = this.getActiveProfile();
    if (!active) {
      throw new Error('No active profile');
    }
    let { id, profile } = active;
    let username = getUsernameFromMatrixId(id);
    return matrixLogin(profile.matrixUrl, username, profile.password);
  }

  async getOrRefreshServerToken(): Promise<string> {
    let cached = this.getRealmServerToken();
    if (cached) {
      return cached;
    }
    let matrixAuth = await this.loginToMatrix();
    let active = this.getActiveProfile()!;
    let realmServerUrl = active.profile.realmServerUrl.replace(/\/$/, '');
    let token = await fetchRealmServerToken(matrixAuth, realmServerUrl);
    this.setRealmServerToken(token);
    return token;
  }

  async refreshServerToken(): Promise<string> {
    let matrixAuth = await this.loginToMatrix();
    let active = this.getActiveProfile()!;
    let realmServerUrl = active.profile.realmServerUrl.replace(/\/$/, '');
    let token = await fetchRealmServerToken(matrixAuth, realmServerUrl);
    this.setRealmServerToken(token);
    return token;
  }

  private findRealmTokenForUrl(url: string): string | undefined {
    let active = this.getActiveProfile();
    let realmTokens = active?.profile.realmTokens;
    if (!realmTokens) {
      return undefined;
    }
    for (let [realmUrl, token] of Object.entries(realmTokens)) {
      if (url.startsWith(realmUrl) && token) {
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

  async addToUserRealms(realmUrl: string): Promise<void> {
    let matrixAuth = await this.loginToMatrix();
    await addRealmToMatrixAccountData(matrixAuth, realmUrl);
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

    if (this.config.profiles[matrixId]) {
      // Update password if it changed
      if (this.config.profiles[matrixId].password !== password) {
        this.config.profiles[matrixId].password = password;
        this.saveConfig();
      }
      return { profileId: matrixId, created: false };
    }

    await this.addProfile(
      matrixId,
      password,
      undefined,
      matrixUrl,
      realmServerUrl,
    );
    return { profileId: matrixId, created: true };
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
    } else if (process.env.MATRIX_USERNAME) {
      console.log(
        `\n${BOLD}Using environment variables${RESET} (no profile active)`,
      );
      console.log(`  ${DIM}Username:${RESET} ${process.env.MATRIX_USERNAME}`);
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
