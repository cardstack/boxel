import { type RealmConfig } from '../lib/realm-config.js';
interface RealmsOptions {
    add?: string;
    remove?: string;
    purpose?: string;
    patterns?: string;
    cardTypes?: string;
    notes?: string;
    default?: boolean;
    llm?: boolean;
    init?: boolean;
}
export declare function realmsCommand(options: RealmsOptions): Promise<void>;
export declare function updateRealmConfig(realmPath: string, updates: Partial<RealmConfig>): Promise<void>;
export {};
//# sourceMappingURL=realms.d.ts.map