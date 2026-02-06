import { CheckpointManager } from '../lib/checkpoint-manager.js';
import * as path from 'path';
import * as fs from 'fs';
// ANSI color codes
const FG_GREEN = '\x1b[32m';
const FG_YELLOW = '\x1b[33m';
const FG_CYAN = '\x1b[36m';
const FG_MAGENTA = '\x1b[35m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';
export async function milestoneCommand(workspace, options, checkpointRef) {
    // Resolve workspace path
    const workspaceDir = path.resolve(workspace);
    // Check if it's a synced workspace
    const manifestPath = path.join(workspaceDir, '.boxel-sync.json');
    if (!fs.existsSync(manifestPath)) {
        console.error('Error: No .boxel-sync.json found. Run sync first to establish tracking.');
        process.exit(1);
    }
    const manager = new CheckpointManager(workspaceDir);
    if (!manager.isInitialized()) {
        console.error('Error: No checkpoint history found. Checkpoints are created during sync/watch.');
        process.exit(1);
    }
    // List milestones
    if (options.list) {
        const milestones = manager.getMilestones();
        if (milestones.length === 0) {
            console.log('\nNo milestones marked yet.\n');
            console.log(`Use ${FG_CYAN}boxel milestone . <number> "name"${RESET} to mark a checkpoint as milestone.`);
            console.log(`Use ${FG_CYAN}boxel history .${RESET} to see available checkpoints.\n`);
            return;
        }
        console.log(`\n${BOLD}Milestones${RESET}\n`);
        for (const cp of milestones) {
            const sourceIcon = cp.source === 'local' ? '↑' : cp.source === 'remote' ? '↓' : '●';
            const sourceColor = cp.source === 'local' ? FG_GREEN : cp.source === 'remote' ? FG_CYAN : FG_MAGENTA;
            console.log(`  ${FG_YELLOW}⭐${RESET} ` +
                `${FG_YELLOW}${cp.shortHash}${RESET} ` +
                `${sourceColor}${sourceIcon}${RESET} ` +
                `${FG_MAGENTA}[${cp.milestoneName}]${RESET} ` +
                `${cp.message}`);
            console.log(`     ${DIM}${formatRelativeTime(cp.date)}${RESET}`);
        }
        console.log();
        return;
    }
    // Remove milestone
    if (options.remove !== undefined) {
        const ref = typeof options.remove === 'string' && !isNaN(parseInt(options.remove))
            ? parseInt(options.remove)
            : options.remove;
        const success = manager.unmarkMilestone(ref);
        if (success) {
            console.log(`${FG_GREEN}✓${RESET} Milestone removed`);
        }
        else {
            console.error('Error: Could not remove milestone. Checkpoint may not be marked as a milestone.');
            process.exit(1);
        }
        return;
    }
    // Mark milestone - need checkpoint reference and name
    if (!checkpointRef) {
        console.error('Error: Please specify a checkpoint number or hash.');
        console.log(`\nUsage: boxel milestone . <number|hash> "Milestone name"`);
        console.log(`\nExamples:`);
        console.log(`  boxel milestone . 1 "Initial release"      Mark most recent checkpoint`);
        console.log(`  boxel milestone . 3 "Before refactor"      Mark third checkpoint`);
        console.log(`  boxel milestone . a9d6f62 "Working state"  Mark by hash`);
        console.log(`\nUse ${FG_CYAN}boxel history .${RESET} to see available checkpoints.`);
        process.exit(1);
    }
    const name = options.name;
    if (!name) {
        console.error('Error: Please provide a milestone name with --name or -n.');
        console.log(`\nUsage: boxel milestone . ${checkpointRef} -n "Milestone name"`);
        process.exit(1);
    }
    // Parse checkpoint reference (number or hash)
    const ref = !isNaN(parseInt(checkpointRef)) ? parseInt(checkpointRef) : checkpointRef;
    const result = manager.markMilestone(ref, name);
    if (result) {
        console.log(`\n${FG_GREEN}✓${RESET} ${FG_YELLOW}⭐${RESET} Milestone created: ${FG_MAGENTA}${name}${RESET}`);
        console.log(`  Checkpoint: ${FG_YELLOW}${result.hash.substring(0, 7)}${RESET}`);
        console.log();
    }
    else {
        console.error('Error: Could not mark milestone. Check that the checkpoint exists.');
        process.exit(1);
    }
}
function formatRelativeTime(date) {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    if (diffSecs < 60)
        return 'just now';
    if (diffMins < 60)
        return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24)
        return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7)
        return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    return date.toLocaleDateString();
}
//# sourceMappingURL=milestone.js.map