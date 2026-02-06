export interface PushCommandOptions {
    delete?: boolean;
    dryRun?: boolean;
    force?: boolean;
}
export declare function pushCommand(localDir: string, workspaceUrl: string, options: PushCommandOptions): Promise<void>;
//# sourceMappingURL=push.d.ts.map