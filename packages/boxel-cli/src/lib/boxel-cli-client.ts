import { createRealm as coreCreateRealm } from '../commands/realm/create';
import { getProfileManager, type ProfileManager } from './profile-manager';

export interface CreateRealmOptions {
  /** URL slug for the realm (lowercase, numbers, hyphens). */
  realmName: string;
  /** Human-readable display name. */
  displayName: string;
  backgroundURL?: string;
  iconURL?: string;
  /** Wait for the realm to pass its readiness check (default: true). */
  waitForReady?: boolean;
}

export interface CreateRealmResult {
  realmUrl: string;
  created: boolean;
  // TODO: Remove once pull/push/sync/search are added to BoxelCLIClient.
  // Callers should not manage tokens directly — this is transitional glue
  // until the factory uses BoxelCLIClient for all realm operations.
  authorization: string;
}

export class BoxelCLIClient {
  private pm: ProfileManager;

  constructor(pm?: ProfileManager) {
    this.pm = pm ?? getProfileManager();
  }

  /**
   * Ensure a boxel profile exists, migrating from env vars if needed.
   * Call once at process startup (e.g. factory entrypoint) before any
   * BoxelCLIClient operations.
   */
  static async ensureProfile(opts?: {
    realmServerUrl?: string;
  }): Promise<void> {
    if (opts?.realmServerUrl && !process.env.REALM_SERVER_URL) {
      process.env.REALM_SERVER_URL = opts.realmServerUrl;
    }
    let pm = getProfileManager();
    let result = await pm.migrateFromEnv();
    if (result?.created) {
      pm.switchProfile(result.profileId);
    }
  }

  /**
   * Returns the active profile's identifying info, or null if no profile
   * is active. Intended for callers that need to validate profile state.
   */
  getActiveProfile(): { matrixId: string; realmServerUrl: string } | null {
    let active = this.pm.getActiveProfile();
    if (!active) return null;
    return {
      matrixId: active.id,
      realmServerUrl: active.profile.realmServerUrl,
    };
  }

  async createRealm(options: CreateRealmOptions): Promise<CreateRealmResult> {
    let result = await coreCreateRealm(options.realmName, options.displayName, {
      background: options.backgroundURL,
      icon: options.iconURL,
      profileManager: this.pm,
      waitForReady: options.waitForReady !== false,
    });

    return {
      realmUrl: result.realmUrl,
      created: result.created,
      authorization: result.realmToken ?? '',
    };
  }
}
