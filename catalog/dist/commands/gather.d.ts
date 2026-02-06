interface GatherOptions {
    source: string;
    subfolder?: string;
    branch?: string;
    dryRun?: boolean;
    noCheckpoint?: boolean;
}
export declare function gatherCommand(workspace: string, options: GatherOptions): Promise<void>;
export {};
//# sourceMappingURL=gather.d.ts.map