import { resolveWorkspace } from '../lib/workspace-resolver.js';
import { addToEditLock, loadEditLock, removeFromEditLock, clearEditLock } from '../lib/edit-lock.js';
export async function editCommand(workspaceRef, files, options) {
    const resolved = await resolveWorkspace(workspaceRef);
    if (!resolved.localDir) {
        console.error('Edit command requires a local directory.');
        process.exit(1);
    }
    const localDir = resolved.localDir;
    // List mode
    if (options.list) {
        const lock = loadEditLock(localDir);
        if (!lock || lock.files.length === 0) {
            console.log('No files currently being edited.');
        }
        else {
            console.log('Files being edited (watch will skip these):');
            for (const file of lock.files) {
                console.log(`  - ${file}`);
            }
            console.log(`\nSince: ${new Date(lock.since).toLocaleString()}`);
            if (lock.agent) {
                console.log(`Agent: ${lock.agent}`);
            }
        }
        return;
    }
    // Clear mode
    if (options.clear) {
        clearEditLock(localDir);
        console.log('Cleared edit lock. Watch will sync all files again.');
        return;
    }
    // Done mode - remove specific files or all
    if (options.done) {
        if (files.length > 0) {
            const lock = removeFromEditLock(localDir, files);
            console.log(`Released edit lock for: ${files.join(', ')}`);
            if (lock && lock.files.length > 0) {
                console.log(`Still editing: ${lock.files.join(', ')}`);
            }
        }
        else {
            clearEditLock(localDir);
            console.log('Released all edit locks. Watch will sync all files again.');
        }
        return;
    }
    // Add files to edit lock
    if (files.length === 0) {
        console.error('Please specify files to mark as being edited.');
        console.error('Usage: boxel edit . file1.gts file2.gts');
        console.error('       boxel edit . --list');
        console.error('       boxel edit . --done file1.gts');
        console.error('       boxel edit . --clear');
        process.exit(1);
    }
    const lock = addToEditLock(localDir, files, options.agent || 'user');
    console.log(`🔒 Edit lock set for ${files.length} file(s):`);
    for (const file of files) {
        console.log(`  - ${file}`);
    }
    console.log(`\nWatch mode will skip these files until you run:`);
    console.log(`  boxel edit ${workspaceRef} --done`);
    console.log(`  boxel edit ${workspaceRef} --done ${files[0]}`);
}
//# sourceMappingURL=edit.js.map