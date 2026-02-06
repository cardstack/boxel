import * as fs from 'fs';
import * as path from 'path';
const LOCK_FILE = '.boxel-editing.json';
export function getEditLockPath(localDir) {
    return path.join(localDir, LOCK_FILE);
}
export function loadEditLock(localDir) {
    const lockPath = getEditLockPath(localDir);
    if (!fs.existsSync(lockPath)) {
        return null;
    }
    try {
        return JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
    }
    catch {
        return null;
    }
}
export function saveEditLock(localDir, lock) {
    const lockPath = getEditLockPath(localDir);
    fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2));
}
export function clearEditLock(localDir) {
    const lockPath = getEditLockPath(localDir);
    if (fs.existsSync(lockPath)) {
        fs.unlinkSync(lockPath);
    }
}
export function addToEditLock(localDir, files, agent) {
    const existing = loadEditLock(localDir);
    const lock = existing || { files: [], since: Date.now(), agent };
    for (const file of files) {
        if (!lock.files.includes(file)) {
            lock.files.push(file);
        }
    }
    if (!existing) {
        lock.since = Date.now();
        lock.agent = agent;
    }
    saveEditLock(localDir, lock);
    return lock;
}
export function removeFromEditLock(localDir, files) {
    const lock = loadEditLock(localDir);
    if (!lock)
        return null;
    if (!files) {
        // Clear all
        clearEditLock(localDir);
        return null;
    }
    lock.files = lock.files.filter(f => !files.includes(f));
    if (lock.files.length === 0) {
        clearEditLock(localDir);
        return null;
    }
    saveEditLock(localDir, lock);
    return lock;
}
export function isFileBeingEdited(localDir, file) {
    const lock = loadEditLock(localDir);
    if (!lock)
        return false;
    return lock.files.includes(file);
}
export function getEditingFiles(localDir) {
    const lock = loadEditLock(localDir);
    return lock?.files || [];
}
//# sourceMappingURL=edit-lock.js.map