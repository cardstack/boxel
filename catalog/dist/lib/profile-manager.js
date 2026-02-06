import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
const CONFIG_DIR = path.join(os.homedir(), '.boxel-cli');
const PROFILES_FILE = path.join(CONFIG_DIR, 'profiles.json');
// ANSI color codes
const FG_GREEN = '\x1b[32m';
const FG_YELLOW = '\x1b[33m';
const FG_CYAN = '\x1b[36m';
const FG_MAGENTA = '\x1b[35m';
const FG_RED = '\x1b[31m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';
/**
 * Extract environment from Matrix user ID
 * @example @ctse:stack.cards -> staging
 * @example @ctse:boxel.ai -> production
 */
export function getEnvironmentFromMatrixId(matrixId) {
    if (matrixId.endsWith(':stack.cards'))
        return 'staging';
    if (matrixId.endsWith(':boxel.ai'))
        return 'production';
    return 'unknown';
}
/**
 * Extract username from Matrix user ID
 * @example @ctse:stack.cards -> ctse
 */
export function getUsernameFromMatrixId(matrixId) {
    const match = matrixId.match(/^@([^:]+):/);
    return match ? match[1] : matrixId;
}
/**
 * Get domain from Matrix user ID
 * @example @ctse:stack.cards -> stack.cards
 * @example @ctse:boxel.ai -> boxel.ai
 */
export function getDomainFromMatrixId(matrixId) {
    const match = matrixId.match(/:([^:]+)$/);
    return match ? match[1] : 'unknown';
}
/**
 * Get environment emoji/label for display
 */
export function getEnvironmentLabel(env) {
    switch (env) {
        case 'staging': return '🧪 stack.cards';
        case 'production': return '⚡ boxel.ai';
        default: return '❓ unknown';
    }
}
/**
 * Get short environment label (uses domain)
 */
export function getEnvironmentShortLabel(env) {
    switch (env) {
        case 'staging': return 'stack.cards';
        case 'production': return 'boxel.ai';
        default: return 'unknown';
    }
}
/**
 * Format profile for display in command output
 * @example [ctse · staging]
 */
export function formatProfileBadge(matrixId) {
    const username = getUsernameFromMatrixId(matrixId);
    const env = getEnvironmentShortLabel(getEnvironmentFromMatrixId(matrixId));
    return `${DIM}[${RESET}${FG_CYAN}${username}${RESET} ${DIM}·${RESET} ${FG_MAGENTA}${env}${RESET}${DIM}]${RESET}`;
}
export class ProfileManager {
    config;
    constructor() {
        this.config = this.loadConfig();
    }
    ensureConfigDir() {
        if (!fs.existsSync(CONFIG_DIR)) {
            fs.mkdirSync(CONFIG_DIR, { recursive: true });
        }
    }
    loadConfig() {
        if (fs.existsSync(PROFILES_FILE)) {
            try {
                const data = fs.readFileSync(PROFILES_FILE, 'utf-8');
                return JSON.parse(data);
            }
            catch {
                // Corrupted file, start fresh
            }
        }
        return { profiles: {}, activeProfile: null };
    }
    saveConfig() {
        this.ensureConfigDir();
        fs.writeFileSync(PROFILES_FILE, JSON.stringify(this.config, null, 2), { mode: 0o600 });
        // Ensure file permissions are restricted (owner read/write only)
        try {
            fs.chmodSync(PROFILES_FILE, 0o600);
        }
        catch {
            // Ignore permission errors on Windows
        }
    }
    /**
     * Get all profile IDs
     */
    listProfiles() {
        return Object.keys(this.config.profiles);
    }
    /**
     * Get a profile by ID
     */
    getProfile(profileId) {
        return this.config.profiles[profileId];
    }
    /**
     * Get the active profile ID
     */
    getActiveProfileId() {
        return this.config.activeProfile;
    }
    /**
     * Get the active profile
     */
    getActiveProfile() {
        const id = this.config.activeProfile;
        if (!id)
            return null;
        const profile = this.config.profiles[id];
        if (!profile)
            return null;
        return { id, profile };
    }
    /**
     * Add a new profile
     */
    async addProfile(matrixId, password, displayName, matrixUrl, realmServerUrl) {
        const env = getEnvironmentFromMatrixId(matrixId);
        const username = getUsernameFromMatrixId(matrixId);
        // Default URLs based on environment
        const defaultMatrixUrl = env === 'production'
            ? 'https://matrix.boxel.ai'
            : 'https://matrix-staging.stack.cards';
        const defaultRealmUrl = env === 'production'
            ? 'https://app.boxel.ai/'
            : 'https://realms-staging.stack.cards/';
        const domain = getDomainFromMatrixId(matrixId);
        const profile = {
            displayName: displayName || `${username} · ${domain}`,
            matrixUrl: matrixUrl || defaultMatrixUrl,
            realmServerUrl: realmServerUrl || defaultRealmUrl,
            password,
        };
        this.config.profiles[matrixId] = profile;
        // If no active profile, make this one active
        if (!this.config.activeProfile) {
            this.config.activeProfile = matrixId;
        }
        this.saveConfig();
    }
    /**
     * Remove a profile
     */
    async removeProfile(profileId) {
        if (!this.config.profiles[profileId]) {
            return false;
        }
        delete this.config.profiles[profileId];
        // If this was the active profile, clear it
        if (this.config.activeProfile === profileId) {
            const remaining = Object.keys(this.config.profiles);
            this.config.activeProfile = remaining.length > 0 ? remaining[0] : null;
        }
        this.saveConfig();
        return true;
    }
    /**
     * Switch to a different profile
     */
    switchProfile(profileId) {
        if (!this.config.profiles[profileId]) {
            return false;
        }
        this.config.activeProfile = profileId;
        this.saveConfig();
        return true;
    }
    /**
     * Get credentials for the active profile
     * Falls back to environment variables if no profile is active
     */
    async getActiveCredentials() {
        // First check for active profile
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
        // Fall back to environment variables
        const matrixUrl = process.env.MATRIX_URL;
        const username = process.env.MATRIX_USERNAME;
        const password = process.env.MATRIX_PASSWORD;
        let realmServerUrl = process.env.REALM_SERVER_URL;
        if (matrixUrl && username && password) {
            // Derive realm server URL from Matrix URL if not explicitly set
            if (!realmServerUrl) {
                try {
                    const matrixUrlObj = new URL(matrixUrl);
                    // Common pattern: matrix.X.Y -> app.X.Y or matrix-staging.X.Y -> realms-staging.X.Y
                    if (matrixUrlObj.hostname.startsWith('matrix.')) {
                        realmServerUrl = `${matrixUrlObj.protocol}//app.${matrixUrlObj.hostname.slice(7)}/`;
                    }
                    else if (matrixUrlObj.hostname.startsWith('matrix-staging.')) {
                        realmServerUrl = `${matrixUrlObj.protocol}//realms-staging.${matrixUrlObj.hostname.slice(15)}/`;
                    }
                    else if (matrixUrlObj.hostname.startsWith('matrix-')) {
                        // matrix-X.Y.Z -> X.Y.Z (generic fallback)
                        realmServerUrl = `${matrixUrlObj.protocol}//${matrixUrlObj.hostname.slice(7)}/`;
                    }
                }
                catch {
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
    /**
     * Get password for a specific profile
     */
    async getPassword(profileId) {
        const profile = this.config.profiles[profileId];
        return profile?.password || null;
    }
    /**
     * Update password for a profile
     */
    async updatePassword(profileId, password) {
        if (!this.config.profiles[profileId]) {
            return false;
        }
        this.config.profiles[profileId].password = password;
        this.saveConfig();
        return true;
    }
    /**
     * Update profile display name
     */
    updateDisplayName(profileId, displayName) {
        if (!this.config.profiles[profileId]) {
            return false;
        }
        this.config.profiles[profileId].displayName = displayName;
        this.saveConfig();
        return true;
    }
    /**
     * Migrate from .env file to profile
     * Returns the created profile ID or null if no env vars found
     */
    async migrateFromEnv() {
        const matrixUrl = process.env.MATRIX_URL;
        const username = process.env.MATRIX_USERNAME;
        const password = process.env.MATRIX_PASSWORD;
        const realmServerUrl = process.env.REALM_SERVER_URL;
        if (!matrixUrl || !username || !password || !realmServerUrl) {
            return null;
        }
        // Determine environment from URL
        const isProduction = matrixUrl.includes('boxel.ai');
        const domain = isProduction ? 'boxel.ai' : 'stack.cards';
        const matrixId = `@${username}:${domain}`;
        // Don't duplicate if profile already exists
        if (this.config.profiles[matrixId]) {
            return matrixId;
        }
        await this.addProfile(matrixId, password, undefined, matrixUrl, realmServerUrl);
        return matrixId;
    }
    /**
     * Print current profile status
     */
    printStatus() {
        const active = this.getActiveProfile();
        if (active) {
            const env = getEnvironmentFromMatrixId(active.id);
            console.log(`\n${BOLD}Active Profile:${RESET} ${formatProfileBadge(active.id)}`);
            console.log(`  ${DIM}Display Name:${RESET} ${active.profile.displayName}`);
            console.log(`  ${DIM}Matrix URL:${RESET} ${active.profile.matrixUrl}`);
            console.log(`  ${DIM}Realm Server:${RESET} ${active.profile.realmServerUrl}`);
        }
        else if (process.env.MATRIX_USERNAME) {
            console.log(`\n${BOLD}Using environment variables${RESET} (no profile active)`);
            console.log(`  ${DIM}Username:${RESET} ${process.env.MATRIX_USERNAME}`);
        }
        else {
            console.log(`\n${FG_YELLOW}No active profile and no environment variables set.${RESET}`);
            console.log(`Run ${FG_CYAN}boxel profile add${RESET} to create a profile.`);
        }
    }
}
// Singleton instance
let _instance = null;
export function getProfileManager() {
    if (!_instance) {
        _instance = new ProfileManager();
    }
    return _instance;
}
//# sourceMappingURL=profile-manager.js.map