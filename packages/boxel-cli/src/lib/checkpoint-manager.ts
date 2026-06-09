import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { isProtectedFile } from './realm-sync-base.ts';

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

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export class CheckpointManager {
  private workspaceDir: string;
  private gitDir: string;

  constructor(workspaceDir: string) {
    this.workspaceDir = path.resolve(workspaceDir);
    this.gitDir = path.join(this.workspaceDir, '.boxel-history');
  }

  async init(): Promise<void> {
    if (!(await pathExists(this.gitDir))) {
      await fs.mkdir(this.gitDir, { recursive: true });
    }

    const gitPath = path.join(this.gitDir, '.git');
    if (!(await pathExists(gitPath))) {
      await this.git('init');
      await this.git('config', 'user.email', 'boxel-cli@local');
      await this.git('config', 'user.name', 'Boxel CLI');
      await this.git(
        'commit',
        '--allow-empty',
        '-m',
        '[init] Initialize checkpoint history',
      );
    }
  }

  async isInitialized(): Promise<boolean> {
    return pathExists(path.join(this.gitDir, '.git'));
  }

  private async syncFilesToHistory(): Promise<void> {
    const files = await this.getWorkspaceFiles();
    const fileSet = new Set(files);

    const historyFiles = await this.getHistoryFiles();
    await Promise.all(
      historyFiles.map(async (file) => {
        if (!fileSet.has(file)) {
          const historyPath = path.join(this.gitDir, file);
          try {
            await fs.unlink(historyPath);
          } catch (err: any) {
            if (err.code !== 'ENOENT') throw err;
          }
        }
      }),
    );

    await Promise.all(
      files.map(async (file) => {
        const srcPath = path.join(this.workspaceDir, file);
        const destPath = path.join(this.gitDir, file);

        const destDir = path.dirname(destPath);
        await fs.mkdir(destDir, { recursive: true });

        await fs.copyFile(srcPath, destPath);
      }),
    );
  }

  private async getWorkspaceFiles(): Promise<string[]> {
    const files: string[] = [];

    const scan = async (dir: string, prefix = ''): Promise<void> => {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch (err: any) {
        if (err.code === 'ENOENT') return;
        throw err;
      }

      await Promise.all(
        entries.map(async (entry) => {
          if (
            entry.name === '.boxel-history' ||
            entry.name === '.boxel-sync.json' ||
            entry.name === 'node_modules'
          ) {
            return;
          }
          if (entry.name.startsWith('.')) {
            return;
          }

          const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;

          if (entry.isDirectory()) {
            await scan(path.join(dir, entry.name), relPath);
          } else {
            files.push(relPath);
          }
        }),
      );
    };

    await scan(this.workspaceDir);
    return files;
  }

  private async getHistoryFiles(): Promise<string[]> {
    const files: string[] = [];

    const scan = async (dir: string, prefix = ''): Promise<void> => {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch (err: any) {
        if (err.code === 'ENOENT') return;
        throw err;
      }

      await Promise.all(
        entries.map(async (entry) => {
          if (entry.name === '.git') return;

          const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;

          if (entry.isDirectory()) {
            await scan(path.join(dir, entry.name), relPath);
          } else {
            files.push(relPath);
          }
        }),
      );
    };

    await scan(this.gitDir);
    return files;
  }

  async detectCurrentChanges(): Promise<CheckpointChange[]> {
    if (!(await this.isInitialized())) {
      const files = await this.getWorkspaceFiles();
      return files.map((file) => ({ file, status: 'added' as const }));
    }

    await this.syncFilesToHistory();

    // Do not trim leading whitespace: porcelain lines look like " M file"
    // for unstaged modifications, and the leading space is part of the
    // two-char status code.
    const statusOutput = (await this.git('status', '--porcelain')).replace(
      /\n+$/,
      '',
    );
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

  async createCheckpoint(
    source: 'local' | 'remote' | 'manual',
    changes: CheckpointChange[],
    customMessage?: string,
  ): Promise<Checkpoint | null> {
    if (!(await this.isInitialized())) {
      await this.init();
    }

    await this.syncFilesToHistory();

    await this.git('add', '-A');

    const statusOutput = await this.git('status', '--porcelain');
    if (!statusOutput.trim()) {
      return null;
    }

    const isMajor = this.classifyChanges(changes);

    const { message, description } = customMessage
      ? { message: customMessage, description: '' }
      : this.generateCommitMessage(source, changes, isMajor);

    const prefix = isMajor ? '[MAJOR]' : '[minor]';
    const sourceTag = `[${source}]`;
    const fullMessage = `${prefix} ${sourceTag} ${message}${description ? '\n\n' + description : ''}`;

    await this.git('commit', '-m', fullMessage);

    const hash = (await this.git('rev-parse', 'HEAD')).trim();
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

  async getCheckpoints(limit = 50): Promise<Checkpoint[]> {
    if (!(await this.isInitialized())) {
      return [];
    }

    const format = '%H|%h|%s|%aI|%an';
    const log = await this.git('log', `--format=${format}`, `-${limit}`);

    if (!log.trim()) {
      return [];
    }

    const milestones = await this.getAllMilestones();

    const lines = log
      .trim()
      .split('\n')
      // The `[init]` bootstrap commit created by init() is an internal
      // bookkeeping commit, not a user-visible checkpoint.
      .filter((line) => {
        const subject = line.split('|')[2] ?? '';
        return !subject.startsWith('[init]');
      });

    return Promise.all(
      lines.map((line) => this.parseCheckpointLine(line, milestones)),
    );
  }

  private async parseCheckpointLine(
    line: string,
    milestones: Map<string, string>,
  ): Promise<Checkpoint> {
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

    const stats = await this.getCommitStats(hash);

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
  }

  private async getCommitStats(hash: string): Promise<{
    filesChanged: number;
    insertions: number;
    deletions: number;
  }> {
    try {
      const stat = await this.git('show', '--stat', '--format=', hash);
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

  async getChangedFiles(hash: string): Promise<string[]> {
    const output = await this.git('show', '--name-only', '--format=', hash);
    return output.trim().split('\n').filter(Boolean);
  }

  async getDiff(hash: string): Promise<string> {
    return this.git('show', '--format=', hash);
  }

  async restore(hash: string): Promise<void> {
    const currentFiles = await this.getHistoryFiles();
    await Promise.all(
      currentFiles.map(async (file) => {
        const filePath = path.join(this.gitDir, file);
        try {
          await fs.unlink(filePath);
        } catch (err: any) {
          if (err.code !== 'ENOENT') throw err;
        }
      }),
    );

    await this.git('checkout', hash, '--', '.');

    const historyFiles = await this.getHistoryFiles();
    const historyFileSet = new Set(historyFiles);
    const workspaceFiles = await this.getWorkspaceFiles();

    await Promise.all(
      workspaceFiles.map(async (file) => {
        if (isProtectedFile(file)) return;
        if (!historyFileSet.has(file)) {
          const filePath = path.join(this.workspaceDir, file);
          try {
            await fs.unlink(filePath);
          } catch (err: any) {
            if (err.code !== 'ENOENT') throw err;
          }
        }
      }),
    );

    await Promise.all(
      historyFiles.map(async (file) => {
        if (isProtectedFile(file)) return;
        const srcPath = path.join(this.gitDir, file);
        const destPath = path.join(this.workspaceDir, file);

        const destDir = path.dirname(destPath);
        await fs.mkdir(destDir, { recursive: true });

        await fs.copyFile(srcPath, destPath);
      }),
    );

    await this.git('checkout', 'HEAD', '--', '.');
  }

  async markMilestone(
    hashOrIndex: string | number,
    name: string,
  ): Promise<{ hash: string; name: string } | null> {
    if (!(await this.isInitialized())) {
      return null;
    }

    let hash: string;
    if (typeof hashOrIndex === 'number') {
      const checkpoints = await this.getCheckpoints(hashOrIndex + 1);
      if (hashOrIndex < 1 || hashOrIndex > checkpoints.length) {
        return null;
      }
      hash = checkpoints[hashOrIndex - 1].hash;
    } else {
      hash = hashOrIndex;
    }

    const tagName = `milestone/${name.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9\-_.]/g, '')}`;

    try {
      await this.git('tag', '-a', tagName, hash, '-m', `Milestone: ${name}`);
      return { hash, name };
    } catch {
      return null;
    }
  }

  async unmarkMilestone(hashOrIndex: string | number): Promise<boolean> {
    if (!(await this.isInitialized())) {
      return false;
    }

    let hash: string;
    if (typeof hashOrIndex === 'number') {
      const checkpoints = await this.getCheckpoints(hashOrIndex + 1);
      if (hashOrIndex < 1 || hashOrIndex > checkpoints.length) {
        return false;
      }
      hash = checkpoints[hashOrIndex - 1].hash;
    } else {
      hash = hashOrIndex;
    }

    const tags = await this.getMilestoneTags(hash);
    if (tags.length === 0) {
      return false;
    }

    for (const tag of tags) {
      try {
        await this.git('tag', '-d', tag);
      } catch {
        // Ignore errors
      }
    }

    return true;
  }

  private async getMilestoneTags(hash: string): Promise<string[]> {
    try {
      const output = await this.git('tag', '--points-at', hash);
      return output
        .trim()
        .split('\n')
        .filter((tag) => tag.startsWith('milestone/'))
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  private async getAllMilestones(): Promise<Map<string, string>> {
    const milestones = new Map<string, string>();
    try {
      const tags = await this.git('tag', '-l', 'milestone/*');
      for (const tag of tags.trim().split('\n').filter(Boolean)) {
        try {
          const hash = (await this.git('rev-list', '-1', tag)).trim();
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

  async getMilestones(): Promise<Checkpoint[]> {
    if (!(await this.isInitialized())) {
      return [];
    }
    const milestones = await this.getAllMilestones();
    if (milestones.size === 0) {
      return [];
    }

    // Enumerate from the milestone tags directly so the result is complete
    // regardless of how deep the tagged checkpoints sit in history. `--no-walk`
    // limits `git log` to just the listed commits — no traversal, no implicit
    // cap.
    const format = '%H|%h|%s|%aI|%an';
    const log = await this.git(
      'log',
      '--no-walk',
      `--format=${format}`,
      ...milestones.keys(),
    );

    if (!log.trim()) {
      return [];
    }

    return Promise.all(
      log
        .trim()
        .split('\n')
        .map((line) => this.parseCheckpointLine(line, milestones)),
    );
  }

  private git(...args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn('git', args, {
        cwd: this.gitDir,
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString('utf-8');
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString('utf-8');
      });

      child.on('error', (err) => reject(err));

      child.on('close', (code) => {
        if (code !== 0 && !args.includes('status')) {
          reject(new Error(`git ${args.join(' ')} failed: ${stderr}`));
          return;
        }
        resolve(stdout);
      });
    });
  }
}
