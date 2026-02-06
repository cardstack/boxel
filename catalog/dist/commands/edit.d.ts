interface EditOptions {
    list?: boolean;
    clear?: boolean;
    done?: boolean;
    agent?: string;
}
export declare function editCommand(workspaceRef: string, files: string[], options: EditOptions): Promise<void>;
export {};
//# sourceMappingURL=edit.d.ts.map