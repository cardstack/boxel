export interface RealmConfig {
    path: string;
    name?: string;
    purpose?: string;
    patterns?: string[];
    cardTypes?: string[];
    notes?: string;
}
export interface WorkspacesConfig {
    defaultRealm?: string;
    realms: RealmConfig[];
}
export declare function findConfigPath(startDir?: string): string | null;
export declare function getConfigPath(dir?: string): string;
export declare function loadConfig(configPath?: string): WorkspacesConfig | null;
export declare function saveConfig(config: WorkspacesConfig, configPath?: string): void;
export declare function initConfig(dir?: string): WorkspacesConfig;
export declare function addRealm(config: WorkspacesConfig, realm: RealmConfig): WorkspacesConfig;
export declare function removeRealm(config: WorkspacesConfig, realmPath: string): WorkspacesConfig;
export declare function getRealmForFile(config: WorkspacesConfig, filename: string): RealmConfig | null;
export declare function getRealmForCardType(config: WorkspacesConfig, cardType: string): RealmConfig | null;
export declare function formatRealmSummary(config: WorkspacesConfig): string;
export declare function generateLLMGuidance(config: WorkspacesConfig): string;
//# sourceMappingURL=realm-config.d.ts.map