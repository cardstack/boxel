import { MatrixClient } from './matrix-client.js';
interface SyncManifest {
    workspaceUrl: string;
    lastSyncTime: number;
    files: Record<string, {
        localHash: string;
        remoteMtime: number;
    }>;
}
interface ResolvedWorkspace {
    localDir: string;
    workspaceUrl: string;
    manifest?: SyncManifest;
}
/**
 * Resolve workspace reference to local dir and URL.
 *
 * Formats:
 *   .                     -> current dir (must have .boxel-sync.json)
 *   ./path                -> local path (must have .boxel-sync.json)
 *   @user/workspace       -> lookup from realm-auth, use default local dir
 *   https://...           -> explicit URL
 */
export declare function resolveWorkspace(ref: string, matrixClient?: MatrixClient): Promise<ResolvedWorkspace>;
interface WorkspaceInfo {
    url: string;
    permissions: string[];
}
export declare function listUserWorkspaces(matrixClient: MatrixClient): Promise<WorkspaceInfo[]>;
/**
 * Get all user workspaces with their sync status
 */
export declare function getAllWorkspacesStatus(matrixClient: MatrixClient): Promise<Array<{
    url: string;
    shortName: string;
    localDir: string | null;
    hasSyncManifest: boolean;
    permissions: string[];
}>>;
export {};
//# sourceMappingURL=workspace-resolver.d.ts.map