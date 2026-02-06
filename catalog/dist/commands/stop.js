import { execSync } from 'child_process';
export async function stopCommand() {
    console.log('🛑 Stopping all Boxel watchers and trackers...\n');
    // Check platform compatibility
    if (process.platform === 'win32') {
        console.log('  The stop command is only supported on Unix-like systems (macOS, Linux).');
        console.log('  On Windows, use Task Manager to end boxel processes.');
        return;
    }
    const stopped = [];
    try {
        // Find boxel watch and track processes
        // Match both development mode (tsx src/index.ts) and installed mode (boxel or node...boxel)
        // Use more specific pattern with word boundaries to avoid false positives
        const result = execSync(`ps aux | grep -E '(tsx[[:space:]].*src/index\\.ts[[:space:]]+(watch|track)|[[:space:]]boxel[[:space:]]+(watch|track)|node[[:space:]].*boxel[[:space:]]+(watch|track))' | grep -v grep | grep -v '[[:space:]]stop'`, { encoding: 'utf-8' }).trim();
        if (result) {
            const lines = result.split('\n').filter(Boolean);
            const seenPids = new Set();
            for (const line of lines) {
                const parts = line.split(/\s+/);
                const pid = parts[1];
                // Skip if we've already processed this PID (avoid duplicates)
                if (seenPids.has(pid))
                    continue;
                seenPids.add(pid);
                // Parse the command to extract type and workspace
                const isWatch = line.includes(' watch');
                const isTrack = line.includes(' track');
                if (!isWatch && !isTrack)
                    continue;
                const type = isWatch ? 'watch' : 'track';
                // Extract workspace path - look for path after watch/track
                let workspace = '.';
                const cmdMatch = line.match(/(?:watch|track)\s+([^\s]+)/);
                if (cmdMatch && cmdMatch[1] && !cmdMatch[1].startsWith('-')) {
                    workspace = cmdMatch[1];
                }
                try {
                    process.kill(parseInt(pid), 'SIGINT');
                    stopped.push({ pid, type, workspace });
                }
                catch {
                    // Process may have already exited
                }
            }
        }
    }
    catch {
        // No processes found (grep returns non-zero)
    }
    if (stopped.length === 0) {
        console.log('  No running watchers or trackers found.');
    }
    else {
        for (const proc of stopped) {
            const icon = proc.type === 'watch' ? '⇅ ' : '⇆ ';
            const typeStr = proc.type.padEnd(5); // "watch" or "track"
            console.log(`  ${icon} Stopped: boxel ${typeStr} ${proc.workspace} (PID ${proc.pid})`);
        }
        console.log(`\n✓ Stopped ${stopped.length} process${stopped.length > 1 ? 'es' : ''}`);
    }
}
//# sourceMappingURL=stop.js.map