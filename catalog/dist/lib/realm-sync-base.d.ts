import { MatrixClient } from './matrix-client.js';
import { RealmAuthClient } from './realm-auth-client.js';
export declare const SupportedMimeType: {
    readonly CardJson: "application/vnd.card+json";
    readonly CardSource: "application/vnd.card+source";
    readonly DirectoryListing: "application/vnd.api+json";
    readonly Mtimes: "application/vnd.api+json";
};
export interface SyncOptions {
    workspaceUrl: string;
    localDir: string;
    dryRun?: boolean;
}
export declare abstract class RealmSyncBase {
    protected options: SyncOptions;
    protected matrixClient: MatrixClient;
    protected realmAuthClient: RealmAuthClient;
    protected normalizedRealmUrl: string;
    private ignoreCache;
    constructor(options: SyncOptions, matrixUrl: string, username: string, password: string);
    initialize(): Promise<void>;
    private normalizeRealmUrl;
    protected buildDirectoryUrl(dir?: string): string;
    protected buildFileUrl(relativePath: string): string;
    protected getRemoteFileList(dir?: string): Promise<Map<string, boolean>>;
    protected getRemoteMtimes(): Promise<Map<string, number>>;
    protected getLocalFileListWithMtimes(dir?: string): Promise<Map<string, {
        path: string;
        mtime: number;
    }>>;
    protected getLocalFileList(dir?: string): Promise<Map<string, string>>;
    protected uploadFile(relativePath: string, localPath: string): Promise<void>;
    protected downloadFile(relativePath: string, localPath: string): Promise<void>;
    protected deleteFile(relativePath: string): Promise<void>;
    protected deleteLocalFile(localPath: string): Promise<void>;
    private getIgnoreInstance;
    private shouldIgnoreFile;
    private shouldIgnoreRemoteFile;
    abstract sync(): Promise<void>;
}
export declare function validateMatrixEnvVars(workspaceUrl: string): Promise<{
    matrixUrl: string;
    username: string;
    password: string;
}>;
//# sourceMappingURL=realm-sync-base.d.ts.map