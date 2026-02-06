interface ShareOptions {
    milestone?: string;
    target: string;
    subfolder?: string;
    branch?: string;
    title?: string;
    dryRun?: boolean;
    noPr?: boolean;
}
export declare function shareCommand(workspace: string, options: ShareOptions): Promise<void>;
export {};
//# sourceMappingURL=share.d.ts.map