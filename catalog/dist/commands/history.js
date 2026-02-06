import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { CheckpointManager } from '../lib/checkpoint-manager.js';
/**
 * Scan workspace directory to build a changes array for manual checkpoints.
 * Marks all current files as 'modified' since we're snapshotting the current state.
 */
function scanWorkspaceForChanges(workspaceDir) {
    const changes = [];
    const scan = (dir, prefix = '') => {
        if (!fs.existsSync(dir))
            return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            // Skip internal files
            if (entry.name.startsWith('.boxel-') || entry.name === '.git')
                continue;
            if (entry.name.startsWith('.') && entry.name !== '.realm.json')
                continue;
            const fullPath = path.join(dir, entry.name);
            const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                scan(fullPath, relativePath);
            }
            else {
                changes.push({ file: relativePath, status: 'modified' });
            }
        }
    };
    scan(workspaceDir);
    return changes;
}
// ANSI escape codes for terminal control
const ESC = '\x1b';
const CLEAR_SCREEN = `${ESC}[2J${ESC}[H`;
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;
const BOLD = `${ESC}[1m`;
const DIM = `${ESC}[2m`;
const RESET = `${ESC}[0m`;
const FG_CYAN = `${ESC}[36m`;
const FG_YELLOW = `${ESC}[33m`;
const FG_GREEN = `${ESC}[32m`;
const FG_RED = `${ESC}[31m`;
const FG_MAGENTA = `${ESC}[35m`;
const BG_BLUE = `${ESC}[44m`;
const FG_WHITE = `${ESC}[37m`;
export async function historyCommand(workspaceRef, options) {
    const workspaceDir = path.resolve(workspaceRef || '.');
    if (!fs.existsSync(workspaceDir)) {
        console.error(`Directory not found: ${workspaceDir}`);
        process.exit(1);
    }
    const manager = new CheckpointManager(workspaceDir);
    // Handle --message: create a manual checkpoint
    if (options.message) {
        if (!manager.isInitialized()) {
            manager.init();
        }
        // Detect current changes to create an accurate checkpoint
        const changes = manager.detectCurrentChanges();
        const checkpoint = manager.createCheckpoint('manual', changes, options.message);
        if (checkpoint) {
            console.log(`${FG_GREEN}✓${RESET} ${FG_YELLOW}📍${RESET} Checkpoint created: ${FG_YELLOW}${checkpoint.shortHash}${RESET}`);
            console.log(`  ${checkpoint.message}`);
        }
        else {
            console.log(`${FG_YELLOW}No changes to checkpoint${RESET}`);
        }
        return;
    }
    if (!manager.isInitialized()) {
        console.error('No checkpoint history found for this workspace.');
        console.error('Checkpoints are created automatically during sync operations.');
        process.exit(1);
    }
    const checkpoints = manager.getCheckpoints(100);
    if (checkpoints.length === 0) {
        console.log('No checkpoints found.');
        return;
    }
    if (options.restore) {
        // Check if a number or hash was provided for quick restore
        if (typeof options.restore === 'string') {
            const input = options.restore;
            let targetCheckpoint;
            // Check if it's a number (1-based index)
            const num = parseInt(input);
            if (!isNaN(num) && num >= 1 && num <= checkpoints.length) {
                targetCheckpoint = checkpoints[num - 1];
            }
            else {
                // Try to match by hash
                targetCheckpoint = checkpoints.find(cp => cp.hash.startsWith(input) || cp.shortHash === input);
            }
            if (targetCheckpoint) {
                await quickRestore(manager, targetCheckpoint);
            }
            else {
                console.error(`Checkpoint not found: ${input}`);
                console.error(`Use a number (1-${checkpoints.length}) or a commit hash.`);
                process.exit(1);
            }
        }
        else {
            await interactiveRestore(manager, checkpoints);
        }
    }
    else {
        displayHistory(checkpoints);
    }
}
function formatSource(source) {
    if (source === 'local')
        return `${FG_GREEN}LOCAL (you pushed)${RESET}`;
    if (source === 'remote')
        return `${FG_CYAN}SERVER (external change)${RESET}`;
    return `${FG_MAGENTA}MANUAL${RESET}`;
}
async function quickRestore(manager, checkpoint) {
    console.log(`\n${BOLD}Restoring to:${RESET} ${checkpoint.shortHash} - ${checkpoint.message}`);
    console.log(`${BOLD}Source:${RESET} ${formatSource(checkpoint.source)}`);
    console.log(`${BOLD}Date:${RESET} ${formatDate(checkpoint.date)}\n`);
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return new Promise((resolve) => {
        rl.question(`${FG_YELLOW}This will overwrite current files. Continue? (y/N) ${RESET}`, (answer) => {
            rl.close();
            if (answer.toLowerCase() === 'y') {
                try {
                    manager.restore(checkpoint.hash);
                    console.log(`\n${FG_GREEN}✓ Restored to ${checkpoint.shortHash}${RESET}`);
                    console.log(`${DIM}Run 'boxel sync . --prefer-local' to push to server${RESET}\n`);
                }
                catch (error) {
                    console.error(`\n${FG_RED}Error restoring:${RESET}`, error);
                }
            }
            else {
                console.log(`\n${DIM}Restore cancelled${RESET}\n`);
            }
            resolve();
        });
    });
}
function displayHistory(checkpoints) {
    console.log(`\n${BOLD}Checkpoint History${RESET}  ${DIM}(${FG_GREEN}⇆${RESET}${DIM}=local edit, ${FG_CYAN}⇅${RESET}${DIM}=server change, ${FG_YELLOW}⭐${RESET}${DIM}=milestone)${RESET}\n`);
    checkpoints.forEach((cp, i) => {
        const num = i + 1;
        const numLabel = num <= 9 ? `${DIM}${num}${RESET}` : ` `;
        const majorTag = cp.isMajor ? `${FG_YELLOW}[MAJOR]${RESET}` : `${DIM}[minor]${RESET}`;
        const sourceTag = cp.source === 'local' ? `${FG_GREEN}⇆ LOCAL${RESET}` :
            cp.source === 'remote' ? `${FG_CYAN}⇅ SERVER${RESET}` : `${FG_MAGENTA}● MANUAL${RESET}`;
        const date = formatDate(cp.date);
        const stats = `${DIM}(${cp.filesChanged} files)${RESET}`;
        const milestoneTag = cp.isMilestone ? `${FG_YELLOW}⭐${RESET} ${FG_MAGENTA}[${cp.milestoneName}]${RESET} ` : '';
        console.log(`${numLabel} ${FG_YELLOW}${cp.shortHash}${RESET} ${milestoneTag}${sourceTag} ${majorTag} ${cp.message} ${stats}`);
        console.log(`   ${DIM}${date}${RESET}\n`);
    });
    console.log(`${DIM}Quick restore: boxel history . -r <number>${RESET}`);
    console.log(`${DIM}Interactive:   boxel history . -r${RESET}`);
    console.log(`${DIM}Mark milestone: boxel milestone . <number> -n "name"${RESET}\n`);
}
async function interactiveRestore(manager, checkpoints) {
    let selectedIndex = 0;
    let showDiff = false;
    // Setup terminal
    process.stdout.write(HIDE_CURSOR);
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
    }
    const render = () => {
        const termHeight = process.stdout.rows || 24;
        const listHeight = termHeight - 12; // Reserve space for header and details
        process.stdout.write(CLEAR_SCREEN);
        // Header
        console.log(`${BOLD}${BG_BLUE}${FG_WHITE} Boxel Checkpoint Navigator ${RESET}\n`);
        console.log(`${DIM}Use ↑/↓ or 1-9 to select, Enter to restore, D for diff, Q to quit${RESET}\n`);
        // Calculate visible range
        const start = Math.max(0, selectedIndex - Math.floor(listHeight / 2));
        const end = Math.min(checkpoints.length, start + listHeight);
        // List checkpoints
        for (let i = start; i < end; i++) {
            const cp = checkpoints[i];
            const isSelected = i === selectedIndex;
            const num = i + 1;
            const numStr = num <= 9 ? `${num}` : ' ';
            const prefix = isSelected ? `${FG_CYAN}▶${RESET}` : ` `;
            const numLabel = isSelected ? `${BOLD}${numStr}${RESET}` : `${DIM}${numStr}${RESET}`;
            const majorTag = cp.isMajor ? `${FG_YELLOW}●${RESET}` : `${DIM}○${RESET}`;
            const sourceIcon = cp.source === 'local' ? `${FG_GREEN}⇆LOCAL${RESET}` :
                cp.source === 'remote' ? `${FG_CYAN}⇅SRVR${RESET}` : `${FG_MAGENTA}◆MAN${RESET}`;
            const milestoneIcon = cp.isMilestone ? `${FG_YELLOW}⭐${RESET}` : '';
            const line = isSelected
                ? `${prefix}${numLabel} ${BOLD}${cp.shortHash}${RESET} ${milestoneIcon}${majorTag} ${sourceIcon} ${BOLD}${cp.message}${RESET}`
                : `${prefix}${numLabel} ${DIM}${cp.shortHash}${RESET} ${milestoneIcon}${majorTag} ${sourceIcon} ${cp.message}`;
            console.log(line);
        }
        // Scrollbar indicator
        if (checkpoints.length > listHeight) {
            const scrollPos = Math.floor((selectedIndex / checkpoints.length) * 100);
            console.log(`\n${DIM}[${scrollPos}% of ${checkpoints.length} checkpoints]${RESET}`);
        }
        // Details panel
        const selected = checkpoints[selectedIndex];
        console.log(`\n${'─'.repeat(60)}`);
        console.log(`${BOLD}Selected:${RESET} ${selected.shortHash} - ${selected.message}`);
        if (selected.isMilestone) {
            console.log(`${BOLD}Milestone:${RESET} ${FG_YELLOW}⭐${RESET} ${FG_MAGENTA}${selected.milestoneName}${RESET}`);
        }
        console.log(`${BOLD}Date:${RESET} ${formatDate(selected.date)}`);
        console.log(`${BOLD}Type:${RESET} ${selected.isMajor ? 'Major' : 'Minor'} | ${BOLD}Source:${RESET} ${formatSource(selected.source)}`);
        console.log(`${BOLD}Changes:${RESET} ${selected.filesChanged} files`);
        // Show changed files
        const files = manager.getChangedFiles(selected.hash);
        if (files.length > 0) {
            console.log(`${BOLD}Files:${RESET}`);
            files.slice(0, 5).forEach(f => console.log(`  ${DIM}${f}${RESET}`));
            if (files.length > 5) {
                console.log(`  ${DIM}... and ${files.length - 5} more${RESET}`);
            }
        }
        // Show diff if enabled
        if (showDiff) {
            console.log(`\n${BOLD}Diff:${RESET}`);
            const diff = manager.getDiff(selected.hash);
            const diffLines = diff.split('\n').slice(0, 20);
            diffLines.forEach(line => {
                if (line.startsWith('+') && !line.startsWith('+++')) {
                    console.log(`${FG_GREEN}${line}${RESET}`);
                }
                else if (line.startsWith('-') && !line.startsWith('---')) {
                    console.log(`${FG_RED}${line}${RESET}`);
                }
                else {
                    console.log(`${DIM}${line}${RESET}`);
                }
            });
            if (diff.split('\n').length > 20) {
                console.log(`${DIM}... (diff truncated)${RESET}`);
            }
        }
    };
    render();
    return new Promise((resolve) => {
        const cleanup = () => {
            process.stdout.write(SHOW_CURSOR);
            if (process.stdin.isTTY) {
                process.stdin.setRawMode(false);
            }
            process.stdin.removeListener('keypress', onKeypress);
        };
        const onKeypress = async (str, key) => {
            if (key.name === 'up' || key.name === 'k') {
                selectedIndex = Math.max(0, selectedIndex - 1);
                render();
            }
            else if (key.name === 'down' || key.name === 'j') {
                selectedIndex = Math.min(checkpoints.length - 1, selectedIndex + 1);
                render();
            }
            else if (key.name === 'pageup') {
                selectedIndex = Math.max(0, selectedIndex - 10);
                render();
            }
            else if (key.name === 'pagedown') {
                selectedIndex = Math.min(checkpoints.length - 1, selectedIndex + 10);
                render();
            }
            else if (key.name === 'd') {
                showDiff = !showDiff;
                render();
            }
            else if (str && str >= '1' && str <= '9') {
                const num = parseInt(str) - 1;
                if (num < checkpoints.length) {
                    selectedIndex = num;
                    render();
                }
            }
            else if (key.name === 'return') {
                cleanup();
                console.log(CLEAR_SCREEN);
                const selected = checkpoints[selectedIndex];
                console.log(`\n${BOLD}Restoring to checkpoint:${RESET} ${selected.shortHash}`);
                console.log(`${selected.message}\n`);
                // Confirm
                const rl = readline.createInterface({
                    input: process.stdin,
                    output: process.stdout,
                });
                rl.question(`${FG_YELLOW}This will overwrite current files. Continue? (y/N) ${RESET}`, (answer) => {
                    rl.close();
                    if (answer.toLowerCase() === 'y') {
                        try {
                            manager.restore(selected.hash);
                            console.log(`\n${FG_GREEN}✓ Restored to ${selected.shortHash}${RESET}`);
                            console.log(`${DIM}Run 'boxel sync .' to push these changes to remote${RESET}\n`);
                        }
                        catch (error) {
                            console.error(`\n${FG_RED}Error restoring:${RESET}`, error);
                        }
                    }
                    else {
                        console.log(`\n${DIM}Restore cancelled${RESET}\n`);
                    }
                    resolve();
                });
                return;
            }
            else if (key.name === 'q' || (key.ctrl && key.name === 'c')) {
                cleanup();
                console.log(CLEAR_SCREEN);
                resolve();
            }
        };
        process.stdin.on('keypress', onKeypress);
    });
}
function formatDate(date) {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (days > 7) {
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    }
    else if (days > 0) {
        return `${days} day${days > 1 ? 's' : ''} ago`;
    }
    else if (hours > 0) {
        return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    }
    else if (minutes > 0) {
        return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    }
    else {
        return 'just now';
    }
}
//# sourceMappingURL=history.js.map