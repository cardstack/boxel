export interface Checkpoint {
    hash: string;
    shortHash: string;
    message: string;
    description: string;
    date: Date;
    isMajor: boolean;
    filesChanged: number;
    insertions: number;
    deletions: number;
    source: 'local' | 'remote' | 'manual';
    isMilestone: boolean;
    milestoneName?: string;
}
export interface CheckpointChange {
    file: string;
    status: 'added' | 'modified' | 'deleted';
}
export declare class CheckpointManager {
    private workspaceDir;
    private gitDir;
    constructor(workspaceDir: string);
    /**
     * Initialize git repo for checkpoint tracking
     */
    init(): void;
    /**
     * Check if checkpoint tracking is initialized
     */
    isInitialized(): boolean;
    /**
     * Sync workspace files to history directory
     */
    private syncFilesToHistory;
    /**
     * Get list of files in workspace (excluding internal files)
     */
    private getWorkspaceFiles;
    /**
     * Get list of files in history directory
     */
    private getHistoryFiles;
    /**
     * Detect current changes in the workspace by comparing with last checkpoint
     */
    detectCurrentChanges(): CheckpointChange[];
    /**
     * Create a checkpoint with the current state
     */
    createCheckpoint(source: 'local' | 'remote' | 'manual', changes: CheckpointChange[], customMessage?: string): Checkpoint | null;
    /**
     * Classify changes as major or minor
     */
    private classifyChanges;
    /**
     * Generate a descriptive commit message
     */
    private generateCommitMessage;
    /**
     * Get list of checkpoints (commits)
     */
    getCheckpoints(limit?: number): Checkpoint[];
    /**
     * Get file change stats for a commit
     */
    private getCommitStats;
    /**
     * Get files changed in a commit
     */
    getChangedFiles(hash: string): string[];
    /**
     * Get diff for a commit
     */
    getDiff(hash: string): string;
    /**
     * Restore workspace to a specific checkpoint
     */
    restore(hash: string): void;
    /**
     * Mark a checkpoint as a milestone
     */
    markMilestone(hashOrIndex: string | number, name: string): {
        hash: string;
        name: string;
    } | null;
    /**
     * Remove a milestone marker from a checkpoint
     */
    unmarkMilestone(hashOrIndex: string | number): boolean;
    /**
     * Get milestone tags pointing to a specific commit
     */
    private getMilestoneTags;
    /**
     * Get all milestone tags mapped to their commits
     */
    private getAllMilestones;
    /**
     * Get only milestone checkpoints
     */
    getMilestones(): Checkpoint[];
    /**
     * Execute git command
     */
    private git;
}
//# sourceMappingURL=checkpoint-manager.d.ts.map