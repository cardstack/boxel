import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
export class CheckpointManager {
    workspaceDir;
    gitDir;
    constructor(workspaceDir) {
        this.workspaceDir = path.resolve(workspaceDir);
        this.gitDir = path.join(this.workspaceDir, '.boxel-history');
    }
    /**
     * Initialize git repo for checkpoint tracking
     */
    init() {
        if (!fs.existsSync(this.gitDir)) {
            fs.mkdirSync(this.gitDir, { recursive: true });
        }
        const gitPath = path.join(this.gitDir, '.git');
        if (!fs.existsSync(gitPath)) {
            this.git('init');
            // Configure git for this repo
            this.git('config', 'user.email', 'boxel-cli@local');
            this.git('config', 'user.name', 'Boxel CLI');
            // Create initial empty commit so we have a valid repo
            this.git('commit', '--allow-empty', '-m', '[init] Initialize checkpoint history');
        }
    }
    /**
     * Check if checkpoint tracking is initialized
     */
    isInitialized() {
        return fs.existsSync(path.join(this.gitDir, '.git'));
    }
    /**
     * Sync workspace files to history directory
     */
    syncFilesToHistory() {
        // Get list of files to track (exclude .boxel-sync.json and .boxel-history)
        const files = this.getWorkspaceFiles();
        // Remove files from history that no longer exist
        const historyFiles = this.getHistoryFiles();
        for (const file of historyFiles) {
            if (!files.includes(file)) {
                const historyPath = path.join(this.gitDir, file);
                if (fs.existsSync(historyPath)) {
                    fs.unlinkSync(historyPath);
                }
            }
        }
        // Copy/update files to history
        for (const file of files) {
            const srcPath = path.join(this.workspaceDir, file);
            const destPath = path.join(this.gitDir, file);
            // Ensure directory exists
            const destDir = path.dirname(destPath);
            if (!fs.existsSync(destDir)) {
                fs.mkdirSync(destDir, { recursive: true });
            }
            fs.copyFileSync(srcPath, destPath);
        }
    }
    /**
     * Get list of files in workspace (excluding internal files)
     */
    getWorkspaceFiles() {
        const files = [];
        const scan = (dir, prefix = '') => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                // Skip internal directories
                if (entry.name === '.boxel-history' || entry.name === '.boxel-sync.json') {
                    continue;
                }
                if (entry.name.startsWith('.') && entry.name !== '.realm.json') {
                    continue;
                }
                const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
                if (entry.isDirectory()) {
                    scan(path.join(dir, entry.name), relPath);
                }
                else {
                    files.push(relPath);
                }
            }
        };
        scan(this.workspaceDir);
        return files;
    }
    /**
     * Get list of files in history directory
     */
    getHistoryFiles() {
        const files = [];
        const scan = (dir, prefix = '') => {
            if (!fs.existsSync(dir))
                return;
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.name === '.git')
                    continue;
                const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
                if (entry.isDirectory()) {
                    scan(path.join(dir, entry.name), relPath);
                }
                else {
                    files.push(relPath);
                }
            }
        };
        scan(this.gitDir);
        return files;
    }
    /**
     * Detect current changes in the workspace by comparing with last checkpoint
     */
    detectCurrentChanges() {
        if (!this.isInitialized()) {
            // If not initialized, all files are "added"
            const files = this.getWorkspaceFiles();
            return files.map(file => ({ file, status: 'added' }));
        }
        // Sync files to history to get current state
        this.syncFilesToHistory();
        // Get git status to see what changed
        const status = spawnSync('git', ['status', '--porcelain'], {
            cwd: this.gitDir,
            encoding: 'utf-8',
        });
        const statusOutput = status.stdout.trim();
        if (!statusOutput) {
            return []; // No changes
        }
        const changes = [];
        for (const line of statusOutput.split('\n')) {
            if (!line)
                continue;
            const statusCode = line.substring(0, 2);
            let file = line.substring(3);
            // Parse git status codes (two-character format)
            // ' M' or 'M ' = modified
            // 'A ' or 'AM' = added
            // 'D ' or ' D' = deleted
            // '??' = untracked (treat as added)
            // 'R ' = renamed (format: "R  old -> new")
            // 'C ' = copied (treat similar to added)
            // 'UU' or 'AA' or other U combos = unmerged (treat as modified)
            // 'T ' = type changed (treat as modified)
            // Handle renamed files - extract the new name
            if (statusCode.includes('R')) {
                const arrowIndex = file.indexOf(' -> ');
                if (arrowIndex !== -1) {
                    const oldFile = file.substring(0, arrowIndex);
                    const newFile = file.substring(arrowIndex + 4);
                    // Record both the deletion of old and addition of new
                    changes.push({ file: oldFile, status: 'deleted' });
                    changes.push({ file: newFile, status: 'added' });
                    continue;
                }
            }
            // Classify changes based on status code
            if (statusCode.includes('D')) {
                changes.push({ file, status: 'deleted' });
            }
            else if (statusCode.includes('A') || statusCode.includes('C') || statusCode === '??') {
                changes.push({ file, status: 'added' });
            }
            else if (statusCode.includes('M') || statusCode.includes('U') || statusCode.includes('T')) {
                changes.push({ file, status: 'modified' });
            }
        }
        return changes;
    }
    /**
     * Create a checkpoint with the current state
     */
    createCheckpoint(source, changes, customMessage) {
        if (!this.isInitialized()) {
            this.init();
        }
        // Sync files to history
        this.syncFilesToHistory();
        // Stage all changes
        this.git('add', '-A');
        // Check if there are changes to commit
        const status = spawnSync('git', ['status', '--porcelain'], {
            cwd: this.gitDir,
            encoding: 'utf-8',
        });
        if (!status.stdout.trim()) {
            return null; // No changes
        }
        // Determine if major or minor
        const isMajor = this.classifyChanges(changes);
        // Generate commit message
        const { message, description } = customMessage
            ? { message: customMessage, description: '' }
            : this.generateCommitMessage(source, changes, isMajor);
        // Create commit
        const prefix = isMajor ? '[MAJOR]' : '[minor]';
        const sourceTag = `[${source}]`;
        const fullMessage = `${prefix} ${sourceTag} ${message}${description ? '\n\n' + description : ''}`;
        this.git('commit', '-m', fullMessage);
        // Get commit info
        const hash = this.git('rev-parse', 'HEAD').trim();
        const shortHash = hash.substring(0, 7);
        return {
            hash,
            shortHash,
            message,
            description,
            date: new Date(),
            isMajor,
            filesChanged: changes.length,
            insertions: 0,
            deletions: 0,
            source,
            isMilestone: false,
        };
    }
    /**
     * Classify changes as major or minor
     */
    classifyChanges(changes) {
        // Major if:
        // - More than 3 files changed
        // - Any .gts file changed (card definition)
        // - Any file added or deleted
        // - .realm.json changed
        if (changes.length > 3)
            return true;
        for (const change of changes) {
            if (change.status === 'added' || change.status === 'deleted')
                return true;
            if (change.file.endsWith('.gts'))
                return true;
            if (change.file === '.realm.json')
                return true;
        }
        return false;
    }
    /**
     * Generate a descriptive commit message
     */
    generateCommitMessage(source, changes, isMajor) {
        const sourceLabel = source === 'local' ? 'Push' : source === 'remote' ? 'Pull' : 'Manual';
        if (changes.length === 0) {
            return { message: `${sourceLabel}: No changes detected`, description: '' };
        }
        if (changes.length === 1) {
            const change = changes[0];
            const action = change.status === 'added' ? 'Add' :
                change.status === 'deleted' ? 'Delete' : 'Update';
            return {
                message: `${sourceLabel}: ${action} ${change.file}`,
                description: ''
            };
        }
        // Group by status
        const added = changes.filter(c => c.status === 'added');
        const modified = changes.filter(c => c.status === 'modified');
        const deleted = changes.filter(c => c.status === 'deleted');
        // Generate summary
        const parts = [];
        if (added.length > 0)
            parts.push(`+${added.length}`);
        if (modified.length > 0)
            parts.push(`~${modified.length}`);
        if (deleted.length > 0)
            parts.push(`-${deleted.length}`);
        const message = `${sourceLabel}: ${changes.length} files (${parts.join(', ')})`;
        // Generate description with file list
        const lines = [];
        if (added.length > 0) {
            lines.push('Added:');
            added.forEach(c => lines.push(`  + ${c.file}`));
        }
        if (modified.length > 0) {
            lines.push('Modified:');
            modified.forEach(c => lines.push(`  ~ ${c.file}`));
        }
        if (deleted.length > 0) {
            lines.push('Deleted:');
            deleted.forEach(c => lines.push(`  - ${c.file}`));
        }
        return { message, description: lines.join('\n') };
    }
    /**
     * Get list of checkpoints (commits)
     */
    getCheckpoints(limit = 50) {
        if (!this.isInitialized()) {
            return [];
        }
        const format = '%H|%h|%s|%aI|%an';
        const log = this.git('log', `--format=${format}`, `-${limit}`);
        if (!log.trim()) {
            return [];
        }
        // Get all milestones upfront for efficiency
        const milestones = this.getAllMilestones();
        return log.trim().split('\n').map(line => {
            const [hash, shortHash, subject, dateStr] = line.split('|');
            // Parse message to extract metadata
            const isMajor = subject.includes('[MAJOR]');
            const source = subject.includes('[local]') ? 'local' :
                subject.includes('[remote]') ? 'remote' : 'manual';
            // Clean message
            const message = subject
                .replace(/\[(MAJOR|minor)\]\s*/i, '')
                .replace(/\[(local|remote|manual)\]\s*/i, '');
            // Get stats for this commit
            const stats = this.getCommitStats(hash);
            // Check if this is a milestone
            const milestoneName = milestones.get(hash);
            const isMilestone = !!milestoneName;
            return {
                hash,
                shortHash,
                message,
                description: '',
                date: new Date(dateStr),
                isMajor,
                source,
                isMilestone,
                milestoneName,
                ...stats,
            };
        });
    }
    /**
     * Get file change stats for a commit
     */
    getCommitStats(hash) {
        try {
            const stat = this.git('show', '--stat', '--format=', hash);
            const lines = stat.trim().split('\n');
            const summaryLine = lines[lines.length - 1] || '';
            const filesMatch = summaryLine.match(/(\d+) files? changed/);
            const insertMatch = summaryLine.match(/(\d+) insertions?/);
            const deleteMatch = summaryLine.match(/(\d+) deletions?/);
            return {
                filesChanged: filesMatch ? parseInt(filesMatch[1]) : 0,
                insertions: insertMatch ? parseInt(insertMatch[1]) : 0,
                deletions: deleteMatch ? parseInt(deleteMatch[1]) : 0,
            };
        }
        catch {
            return { filesChanged: 0, insertions: 0, deletions: 0 };
        }
    }
    /**
     * Get files changed in a commit
     */
    getChangedFiles(hash) {
        const output = this.git('show', '--name-only', '--format=', hash);
        return output.trim().split('\n').filter(Boolean);
    }
    /**
     * Get diff for a commit
     */
    getDiff(hash) {
        return this.git('show', '--format=', hash);
    }
    /**
     * Restore workspace to a specific checkpoint
     */
    restore(hash) {
        // First, clean the history directory (remove all tracked files)
        // This is needed because git checkout doesn't delete files added in later commits
        const currentFiles = this.getHistoryFiles();
        for (const file of currentFiles) {
            const filePath = path.join(this.gitDir, file);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }
        // Checkout the commit in history
        this.git('checkout', hash, '--', '.');
        // Copy files back to workspace
        const historyFiles = this.getHistoryFiles();
        const workspaceFiles = this.getWorkspaceFiles();
        // Remove files that don't exist in the checkpoint
        for (const file of workspaceFiles) {
            if (!historyFiles.includes(file)) {
                const filePath = path.join(this.workspaceDir, file);
                fs.unlinkSync(filePath);
            }
        }
        // Copy files from history to workspace
        for (const file of historyFiles) {
            const srcPath = path.join(this.gitDir, file);
            const destPath = path.join(this.workspaceDir, file);
            const destDir = path.dirname(destPath);
            if (!fs.existsSync(destDir)) {
                fs.mkdirSync(destDir, { recursive: true });
            }
            fs.copyFileSync(srcPath, destPath);
        }
        // Go back to HEAD
        this.git('checkout', 'HEAD', '--', '.');
    }
    /**
     * Mark a checkpoint as a milestone
     */
    markMilestone(hashOrIndex, name) {
        if (!this.isInitialized()) {
            return null;
        }
        // Resolve hash from index if needed
        let hash;
        if (typeof hashOrIndex === 'number') {
            const checkpoints = this.getCheckpoints(hashOrIndex + 1);
            if (hashOrIndex < 1 || hashOrIndex > checkpoints.length) {
                return null;
            }
            hash = checkpoints[hashOrIndex - 1].hash;
        }
        else {
            hash = hashOrIndex;
        }
        // Sanitize name for git tag (replace spaces with dashes, remove special chars)
        const tagName = `milestone/${name.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9\-_.]/g, '')}`;
        try {
            // Create annotated tag
            this.git('tag', '-a', tagName, hash, '-m', `Milestone: ${name}`);
            return { hash, name };
        }
        catch (error) {
            // Tag might already exist
            return null;
        }
    }
    /**
     * Remove a milestone marker from a checkpoint
     */
    unmarkMilestone(hashOrIndex) {
        if (!this.isInitialized()) {
            return false;
        }
        // Resolve hash from index if needed
        let hash;
        if (typeof hashOrIndex === 'number') {
            const checkpoints = this.getCheckpoints(hashOrIndex + 1);
            if (hashOrIndex < 1 || hashOrIndex > checkpoints.length) {
                return false;
            }
            hash = checkpoints[hashOrIndex - 1].hash;
        }
        else {
            hash = hashOrIndex;
        }
        // Find tags pointing to this commit
        const tags = this.getMilestoneTags(hash);
        if (tags.length === 0) {
            return false;
        }
        // Delete all milestone tags for this commit
        for (const tag of tags) {
            try {
                this.git('tag', '-d', tag);
            }
            catch {
                // Ignore errors
            }
        }
        return true;
    }
    /**
     * Get milestone tags pointing to a specific commit
     */
    getMilestoneTags(hash) {
        try {
            const output = this.git('tag', '--points-at', hash);
            return output.trim().split('\n')
                .filter(tag => tag.startsWith('milestone/'))
                .filter(Boolean);
        }
        catch {
            return [];
        }
    }
    /**
     * Get all milestone tags mapped to their commits
     */
    getAllMilestones() {
        const milestones = new Map();
        try {
            // Get all tags that start with milestone/
            const tags = this.git('tag', '-l', 'milestone/*');
            for (const tag of tags.trim().split('\n').filter(Boolean)) {
                try {
                    const hash = this.git('rev-list', '-1', tag).trim();
                    // Extract name from tag (remove 'milestone/' prefix)
                    const name = tag.replace('milestone/', '').replace(/-/g, ' ');
                    milestones.set(hash, name);
                }
                catch {
                    // Ignore invalid tags
                }
            }
        }
        catch {
            // No tags
        }
        return milestones;
    }
    /**
     * Get only milestone checkpoints
     */
    getMilestones() {
        const all = this.getCheckpoints(100);
        return all.filter(cp => cp.isMilestone);
    }
    /**
     * Execute git command
     */
    git(...args) {
        const result = spawnSync('git', args, {
            cwd: this.gitDir,
            encoding: 'utf-8',
        });
        if (result.error) {
            throw result.error;
        }
        if (result.status !== 0 && !args.includes('status')) {
            throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
        }
        return result.stdout;
    }
}
//# sourceMappingURL=checkpoint-manager.js.map