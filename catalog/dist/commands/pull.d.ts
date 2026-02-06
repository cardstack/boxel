export interface PullCommandOptions {
    delete?: boolean;
    dryRun?: boolean;
}
export declare function pullCommand(workspaceUrl: string, localDir: string, options: PullCommandOptions): Promise<void>;
//# sourceMappingURL=pull.d.ts.map