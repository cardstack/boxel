import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const DEFAULT_CONFIG_DIR = path.join(os.homedir(), '.boxel-cli');
const PROFILES_FILENAME = 'profiles.json';

// ANSI color codes
const FG_YELLOW = '\x1b[33m';
const FG_CYAN = '\x1b[36m';
const FG_MAGENTA = '\x1b[35m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

export interface Profile {
  displayName: string;
  matrixUrl: string;
  realmServerUrl: string;
  password: string; // Stored in plaintext - file should have restricted permissions
}

export interface ProfilesConfig {
  profiles: Record<string, Profile>;
  activeProfile: string | null;
}

export type Environment = 'staging' | 'production' | 'unknown';

/**
 * Extract environment from Matrix user ID
 * @example @ctse:stack.cards -> staging
 * @example @ctse:boxel.ai -> production
 */
export function getEnvironmentFromMatrixId(matrixId: string): Environment {
  if (matrixId.endsWith(':stack.cards')) return 'staging';
  if (matrixId.endsWith(':boxel.ai')) return 'production';
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
 * Get environment emoji/label for display
 */
export function getEnvironmentLabel(env: Environment): string {
  switch (env) {
    case 'staging':
      return 'stack.cards';
    case 'production':
      return 'boxel.ai';
    default:
      return 'unknown';
  }
}

/**
 * Get short environment label (uses domain)
 */
export function getEnvironmentShortLabel(env: Environment): string {
  switch (env) {
    case 'staging':
      return 'stack.cards';
    case 'production':
      return 'boxel.ai';
    default:
      return 'unknown';
  }
}

/**
 * Format profile for display in command output
 * @example [ctse · staging]
 */
export function formatProfileBadge(matrixId: string): string {
  const username = getUsernameFromMatrixId(matrixId);
  const env = getEnvironmentShortLabel(getEnvironmentFromMatrixId(matrixId));
  return `${DIM}[${RESET}${FG_CYAN}${username}${RESET} ${DIM}\u00b7${RESET} ${FG_MAGENTA}${env}${RESET}${DIM}]${RESET}`;
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
    if (fs.existsSync(this.profilesFile)) {
      try {
        const data = fs.readFileSync(this.profilesFile, 'utf-8');
        return JSON.parse(data);
      } catch {
        // Corrupted file, start fresh
      }
    }
    return { profiles: {}, activeProfile: null };
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
    let realmServerUrl = process.env.REALM_SERVER_URL;

    if (matrixUrl && username && password) {
      if (!realmServerUrl) {
        try {
          const matrixUrlObj = new URL(matrixUrl);
          if (matrixUrlObj.hostname.startsWith('matrix.')) {
            realmServerUrl = `${matrixUrlObj.protocol}//app.${matrixUrlObj.hostname.slice(7)}/`;
          } else if (matrixUrlObj.hostname.startsWith('matrix-staging.')) {
            realmServerUrl = `${matrixUrlObj.protocol}//realms-staging.${matrixUrlObj.hostname.slice(15)}/`;
          } else if (matrixUrlObj.hostname.startsWith('matrix-')) {
            realmServerUrl = `${matrixUrlObj.protocol}//${matrixUrlObj.hostname.slice(7)}/`;
          }
        } catch {
          // Invalid URL, will return null below
        }
      }

      if (realmServerUrl) {
        return {
          matrixUrl,
          username,
          password,
          realmServerUrl,
          profileId: null,
        };
      }
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

  async migrateFromEnv(): Promise<string | null> {
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
      return matrixId;
    }

    await this.addProfile(
      matrixId,
      password,
      undefined,
      matrixUrl,
      realmServerUrl,
    );
    return matrixId;
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

// Singleton instance
let _instance: ProfileManager | null = null;

export function getProfileManager(configDir?: string): ProfileManager {
  if (!_instance) {
    _instance = new ProfileManager(configDir);
  }
  return _instance;
}

/**
 * Reset the singleton (useful for testing)
 */
export function resetProfileManager(): void {
  _instance = null;
}
