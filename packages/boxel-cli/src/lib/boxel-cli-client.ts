import {
  createRealm as coreCreateRealm,
} from '../commands/realm/create';
import { getProfileManager, type ProfileManager } from './profile-manager';

export interface CreateRealmOptions {
  endpoint: string;
  name: string;
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
  static async ensureProfile(): Promise<void> {
    await getProfileManager().migrateFromEnv();
  }

  async createRealm(options: CreateRealmOptions): Promise<CreateRealmResult> {
    let result = await coreCreateRealm(options.endpoint, options.name, {
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
