export interface SyncCommandOptionsInput {
    preferLocal?: boolean;
    preferRemote?: boolean;
    preferNewest?: boolean;
    delete?: boolean;
    dryRun?: boolean;
}
export declare function syncCommand(workspaceRef: string, explicitUrl: string, options: SyncCommandOptionsInput): Promise<void>;
//# sourceMappingURL=sync.d.ts.map