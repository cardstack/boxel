import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { isProtectedFile } from './realm-sync-base';

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

export class CheckpointManager {
  private workspaceDir: string;
  private gitDir: string;

  constructor(workspaceDir: string) {
    this.workspaceDir = path.resolve(workspaceDir);
    this.gitDir = path.join(this.workspaceDir, '.boxel-history');
  }

  init(): void {
    if (!fs.existsSync(this.gitDir)) {
      fs.mkdirSync(this.gitDir, { recursive: true });
    }

    const gitPath = path.join(this.gitDir, '.git');
    if (!fs.existsSync(gitPath)) {
      this.git('init');
      this.git('config', 'user.email', 'boxel-cli@local');
      this.git('config', 'user.name', 'Boxel CLI');
      this.git(
        'commit',
        '--allow-empty',
        '-m',
        '[init] Initialize checkpoint history',
      );
    }
  }

  isInitialized(): boolean {
    return fs.existsSync(path.join(this.gitDir, '.git'));
  }

  private syncFilesToHistory(): void {
    const files = this.getWorkspaceFiles();

    const historyFiles = this.getHistoryFiles();
    for (const file of historyFiles) {
      if (!files.includes(file)) {
        const historyPath = path.join(this.gitDir, file);
        if (fs.existsSync(historyPath)) {
          fs.unlinkSync(historyPath);
        }
      }
    }

    for (const file of files) {
      const srcPath = path.join(this.workspaceDir, file);
      const destPath = path.join(this.gitDir, file);

      const destDir = path.dirname(destPath);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      fs.copyFileSync(srcPath, destPath);
    }
  }

  private getWorkspaceFiles(): string[] {
    const files: string[] = [];

    const scan = (dir: string, prefix = '') => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (
          entry.name === '.boxel-history' ||
          entry.name === '.boxel-sync.json' ||
          entry.name === 'node_modules'
        ) {
          continue;
        }
        if (entry.name.startsWith('.')) {
          continue;
        }

        const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          scan(path.join(dir, entry.name), relPath);
        } else {
          files.push(relPath);
        }
      }
    };

    scan(this.workspaceDir);
    return files;
  }

  private getHistoryFiles(): string[] {
    const files: string[] = [];

    const scan = (dir: string, prefix = '') => {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === '.git') continue;

        const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          scan(path.join(dir, entry.name), relPath);
        } else {
          files.push(relPath);
        }
      }
    };

    scan(this.gitDir);
    return files;
  }

  detectCurrentChanges(): CheckpointChange[] {
    if (!this.isInitialized()) {
      const files = this.getWorkspaceFiles();
      return files.map((file) => ({ file, status: 'added' as const }));
    }

    this.syncFilesToHistory();

    const status = spawnSync('git', ['status', '--porcelain'], {
      cwd: this.gitDir,
      encoding: 'utf-8',
    });

    const statusOutput = status.stdout.trim();
    if (!statusOutput) {
      return [];
    }

    const changes: CheckpointChange[] = [];
    for (const line of statusOutput.split('\n')) {
      if (!line) continue;

      const statusCode = line.substring(0, 2);
      const file = line.substring(3);

      if (statusCode.includes('R')) {
        const arrowIndex = file.indexOf(' -> ');
        if (arrowIndex !== -1) {
          const oldFile = file.substring(0, arrowIndex);
          const newFile = file.substring(arrowIndex + 4);
          changes.push({ file: oldFile, status: 'deleted' });
          changes.push({ file: newFile, status: 'added' });
          continue;
        }
      }

      if (statusCode.includes('D')) {
        changes.push({ file, status: 'deleted' });
      } else if (
        statusCode.includes('A') ||
        statusCode.includes('C') ||
        statusCode === '??'
      ) {
        changes.push({ file, status: 'added' });
      } else if (
        statusCode.includes('M') ||
        statusCode.includes('U') ||
        statusCode.includes('T')
      ) {
        changes.push({ file, status: 'modified' });
      }
    }

    return changes;
  }

  createCheckpoint(
    source: 'local' | 'remote' | 'manual',
    changes: CheckpointChange[],
    customMessage?: string,
  ): Checkpoint | null {
    if (!this.isInitialized()) {
      this.init();
    }

    this.syncFilesToHistory();

    this.git('add', '-A');

    const status = spawnSync('git', ['status', '--porcelain'], {
      cwd: this.gitDir,
      encoding: 'utf-8',
    });

    if (!status.stdout.trim()) {
      return null;
    }

    const isMajor = this.classifyChanges(changes);

    const { message, description } = customMessage
      ? { message: customMessage, description: '' }
      : this.generateCommitMessage(source, changes, isMajor);

    const prefix = isMajor ? '[MAJOR]' : '[minor]';
    const sourceTag = `[${source}]`;
    const fullMessage = `${prefix} ${sourceTag} ${message}${description ? '\n\n' + description : ''}`;

    this.git('commit', '-m', fullMessage);

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

  private classifyChanges(changes: CheckpointChange[]): boolean {
    if (changes.length > 3) return true;

    for (const change of changes) {
      if (change.status === 'added' || change.status === 'deleted') return true;
      if (change.file.endsWith('.gts')) return true;
    }

    return false;
  }

  private generateCommitMessage(
    source: 'local' | 'remote' | 'manual',
    changes: CheckpointChange[],
    _isMajor: boolean,
  ): { message: string; description: string } {
    const sourceLabel =
      source === 'local' ? 'Push' : source === 'remote' ? 'Pull' : 'Manual';

    if (changes.length === 0) {
      return {
        message: `${sourceLabel}: No changes detected`,
        description: '',
      };
    }

    if (changes.length === 1) {
      const change = changes[0];
      const action =
        change.status === 'added'
          ? 'Add'
          : change.status === 'deleted'
            ? 'Delete'
            : 'Update';
      return {
        message: `${sourceLabel}: ${action} ${change.file}`,
        description: '',
      };
    }

    const added = changes.filter((c) => c.status === 'added');
    const modified = changes.filter((c) => c.status === 'modified');
    const deleted = changes.filter((c) => c.status === 'deleted');

    const parts: string[] = [];
    if (added.length > 0) parts.push(`+${added.length}`);
    if (modified.length > 0) parts.push(`~${modified.length}`);
    if (deleted.length > 0) parts.push(`-${deleted.length}`);

    const message = `${sourceLabel}: ${changes.length} files (${parts.join(', ')})`;

    const lines: string[] = [];
    if (added.length > 0) {
      lines.push('Added:');
      added.forEach((c) => lines.push(`  + ${c.file}`));
    }
    if (modified.length > 0) {
      lines.push('Modified:');
      modified.forEach((c) => lines.push(`  ~ ${c.file}`));
    }
    if (deleted.length > 0) {
      lines.push('Deleted:');
      deleted.forEach((c) => lines.push(`  - ${c.file}`));
    }

    return { message, description: lines.join('\n') };
  }

  getCheckpoints(limit = 50): Checkpoint[] {
    if (!this.isInitialized()) {
      return [];
    }

    const format = '%H|%h|%s|%aI|%an';
    const log = this.git('log', `--format=${format}`, `-${limit}`);

    if (!log.trim()) {
      return [];
    }

    const milestones = this.getAllMilestones();

    return log
      .trim()
      .split('\n')
      .map((line) => {
        const [hash, shortHash, subject, dateStr] = line.split('|');

        const isMajor = subject.includes('[MAJOR]');
        const source = subject.includes('[local]')
          ? ('local' as const)
          : subject.includes('[remote]')
            ? ('remote' as const)
            : ('manual' as const);

        const message = subject
          .replace(/\[(MAJOR|minor)\]\s*/i, '')
          .replace(/\[(local|remote|manual)\]\s*/i, '');

        const stats = this.getCommitStats(hash);

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

  private getCommitStats(hash: string): {
    filesChanged: number;
    insertions: number;
    deletions: number;
  } {
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
    } catch {
      return { filesChanged: 0, insertions: 0, deletions: 0 };
    }
  }

  getChangedFiles(hash: string): string[] {
    const output = this.git('show', '--name-only', '--format=', hash);
    return output.trim().split('\n').filter(Boolean);
  }

  getDiff(hash: string): string {
    return this.git('show', '--format=', hash);
  }

  restore(hash: string): void {
    const currentFiles = this.getHistoryFiles();
    for (const file of currentFiles) {
      const filePath = path.join(this.gitDir, file);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    this.git('checkout', hash, '--', '.');

    const historyFiles = this.getHistoryFiles();
    const workspaceFiles = this.getWorkspaceFiles();

    for (const file of workspaceFiles) {
      if (isProtectedFile(file)) continue;
      if (!historyFiles.includes(file)) {
        const filePath = path.join(this.workspaceDir, file);
        fs.unlinkSync(filePath);
      }
    }

    for (const file of historyFiles) {
      if (isProtectedFile(file)) continue;
      const srcPath = path.join(this.gitDir, file);
      const destPath = path.join(this.workspaceDir, file);

      const destDir = path.dirname(destPath);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      fs.copyFileSync(srcPath, destPath);
    }

    this.git('checkout', 'HEAD', '--', '.');
  }

  markMilestone(
    hashOrIndex: string | number,
    name: string,
  ): { hash: string; name: string } | null {
    if (!this.isInitialized()) {
      return null;
    }

    let hash: string;
    if (typeof hashOrIndex === 'number') {
      const checkpoints = this.getCheckpoints(hashOrIndex + 1);
      if (hashOrIndex < 1 || hashOrIndex > checkpoints.length) {
        return null;
      }
      hash = checkpoints[hashOrIndex - 1].hash;
    } else {
      hash = hashOrIndex;
    }

    const tagName = `milestone/${name.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9\-_.]/g, '')}`;

    try {
      this.git('tag', '-a', tagName, hash, '-m', `Milestone: ${name}`);
      return { hash, name };
    } catch {
      return null;
    }
  }

  unmarkMilestone(hashOrIndex: string | number): boolean {
    if (!this.isInitialized()) {
      return false;
    }

    let hash: string;
    if (typeof hashOrIndex === 'number') {
      const checkpoints = this.getCheckpoints(hashOrIndex + 1);
      if (hashOrIndex < 1 || hashOrIndex > checkpoints.length) {
        return false;
      }
      hash = checkpoints[hashOrIndex - 1].hash;
    } else {
      hash = hashOrIndex;
    }

    const tags = this.getMilestoneTags(hash);
    if (tags.length === 0) {
      return false;
    }

    for (const tag of tags) {
      try {
        this.git('tag', '-d', tag);
      } catch {
        // Ignore errors
      }
    }

    return true;
  }

  private getMilestoneTags(hash: string): string[] {
    try {
      const output = this.git('tag', '--points-at', hash);
      return output
        .trim()
        .split('\n')
        .filter((tag) => tag.startsWith('milestone/'))
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  private getAllMilestones(): Map<string, string> {
    const milestones = new Map<string, string>();
    try {
      const tags = this.git('tag', '-l', 'milestone/*');
      for (const tag of tags.trim().split('\n').filter(Boolean)) {
        try {
          const hash = this.git('rev-list', '-1', tag).trim();
          const name = tag.replace('milestone/', '').replace(/-/g, ' ');
          milestones.set(hash, name);
        } catch {
          // Ignore invalid tags
        }
      }
    } catch {
      // No tags
    }
    return milestones;
  }

  getMilestones(): Checkpoint[] {
    const all = this.getCheckpoints(100);
    return all.filter((cp) => cp.isMilestone);
  }

  private git(...args: string[]): string {
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
