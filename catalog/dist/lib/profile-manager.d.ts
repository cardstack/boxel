export interface Profile {
    displayName: string;
    matrixUrl: string;
    realmServerUrl: string;
    password: string;
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
export declare function getEnvironmentFromMatrixId(matrixId: string): Environment;
/**
 * Extract username from Matrix user ID
 * @example @ctse:stack.cards -> ctse
 */
export declare function getUsernameFromMatrixId(matrixId: string): string;
/**
 * Get domain from Matrix user ID
 * @example @ctse:stack.cards -> stack.cards
 * @example @ctse:boxel.ai -> boxel.ai
 */
export declare function getDomainFromMatrixId(matrixId: string): string;
/**
 * Get environment emoji/label for display
 */
export declare function getEnvironmentLabel(env: Environment): string;
/**
 * Get short environment label (uses domain)
 */
export declare function getEnvironmentShortLabel(env: Environment): string;
/**
 * Format profile for display in command output
 * @example [ctse · staging]
 */
export declare function formatProfileBadge(matrixId: string): string;
export declare class ProfileManager {
    private config;
    constructor();
    private ensureConfigDir;
    private loadConfig;
    private saveConfig;
    /**
     * Get all profile IDs
     */
    listProfiles(): string[];
    /**
     * Get a profile by ID
     */
    getProfile(profileId: string): Profile | undefined;
    /**
     * Get the active profile ID
     */
    getActiveProfileId(): string | null;
    /**
     * Get the active profile
     */
    getActiveProfile(): {
        id: string;
        profile: Profile;
    } | null;
    /**
     * Add a new profile
     */
    addProfile(matrixId: string, password: string, displayName?: string, matrixUrl?: string, realmServerUrl?: string): Promise<void>;
    /**
     * Remove a profile
     */
    removeProfile(profileId: string): Promise<boolean>;
    /**
     * Switch to a different profile
     */
    switchProfile(profileId: string): boolean;
    /**
     * Get credentials for the active profile
     * Falls back to environment variables if no profile is active
     */
    getActiveCredentials(): Promise<{
        matrixUrl: string;
        username: string;
        password: string;
        realmServerUrl: string;
        profileId: string | null;
    } | null>;
    /**
     * Get password for a specific profile
     */
    getPassword(profileId: string): Promise<string | null>;
    /**
     * Update password for a profile
     */
    updatePassword(profileId: string, password: string): Promise<boolean>;
    /**
     * Update profile display name
     */
    updateDisplayName(profileId: string, displayName: string): boolean;
    /**
     * Migrate from .env file to profile
     * Returns the created profile ID or null if no env vars found
     */
    migrateFromEnv(): Promise<string | null>;
    /**
     * Print current profile status
     */
    printStatus(): void;
}
export declare function getProfileManager(): ProfileManager;
//# sourceMappingURL=profile-manager.d.ts.map