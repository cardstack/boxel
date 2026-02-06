export interface EditLock {
    files: string[];
    since: number;
    agent?: string;
}
export declare function getEditLockPath(localDir: string): string;
export declare function loadEditLock(localDir: string): EditLock | null;
export declare function saveEditLock(localDir: string, lock: EditLock): void;
export declare function clearEditLock(localDir: string): void;
export declare function addToEditLock(localDir: string, files: string[], agent?: string): EditLock;
export declare function removeFromEditLock(localDir: string, files?: string[]): EditLock | null;
export declare function isFileBeingEdited(localDir: string, file: string): boolean;
export declare function getEditingFiles(localDir: string): string[];
//# sourceMappingURL=edit-lock.d.ts.map