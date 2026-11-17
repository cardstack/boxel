const GITHUB_API_BASE = 'https://api.github.com';
const COMMITS_PER_PAGE = 100;
const COMMIT_PAGES_READ = 10;
const GITHUB_TEAM_REVIEWERS = ['ecosystem-team'];

export interface OpenPullRequestParams {
  owner: string;
  repo: string;
  title: string;
  head: string;
  base: string;
  body?: string;
}

export interface OpenPullRequestResult {
  number: number;
  html_url: string;
}

export interface CreateBranchParams {
  owner: string;
  repo: string;
  branch: string;
  fromBranch: string;
}

export interface CreateBranchResult {
  ref: string;
  sha: string;
}

export interface WriteFileToBranchParams {
  owner: string;
  repo: string;
  branch: string;
  path: string;
  content: string;
  message: string;
}

export interface WriteFileToBranchResult {
  commitSha: string;
}

export interface WriteFilesToBranchParams {
  owner: string;
  repo: string;
  branch: string;
  files: { path: string; content: string; isBinary?: boolean }[];
  message: string;
  // When set, the commit makes this folder mirror `files` exactly: any blob
  // already on the branch under the folder whose path isn't among `files` is
  // deleted in the same commit. Without it, a rewrite of an existing branch
  // layers onto the previous tree and stale paths survive.
  syncFolder?: string;
  // When set with `syncFolder`, the write is refused if this branch already
  // holds anything by the folder's name.
  folderMustBeNewOn?: string;
  // When set with `syncFolder`, the write is refused if a commit on the
  // branch that touches the folder ends its message with a
  // `[boxel-submitter:…]` tag other than this one. The caller puts the tag
  // at the end of `message`.
  submitterTag?: string;
}

export interface WriteFilesToBranchResult {
  commitSha: string;
}

export interface GitHubClient {
  openPullRequest(
    params: OpenPullRequestParams,
  ): Promise<OpenPullRequestResult>;
  createBranch(params: CreateBranchParams): Promise<CreateBranchResult>;
  writeFileToBranch(
    params: WriteFileToBranchParams,
  ): Promise<WriteFileToBranchResult>;
  writeFilesToBranch(
    params: WriteFilesToBranchParams,
  ): Promise<WriteFilesToBranchResult>;
}

// GitHub answers a rate-limited request with a 403 or a 429. Its guidance
// for secondary limits is to wait for `retry-after`, else until
// `x-ratelimit-reset` when `x-ratelimit-remaining` is 0, else at least a
// minute, growing the wait on each further refusal.
const MAX_RATE_LIMIT_RETRIES = 3;
const DEFAULT_RATE_LIMIT_WAIT_MS = 60_000;
// A wait longer than this (a spent primary quota can reset up to an hour
// away) fails the step instead, so the user can retry later.
const MAX_RATE_LIMIT_WAIT_MS = 5 * 60_000;

export interface OctokitGitHubClientOptions {
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export class OctokitGitHubClient implements GitHubClient {
  private token: string | undefined;
  private sleep: (ms: number) => Promise<void>;
  private now: () => number;

  constructor(
    token: string | undefined,
    options: OctokitGitHubClientOptions = {},
  ) {
    this.token = token;
    this.sleep =
      options.sleep ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? Date.now;
  }

  async openPullRequest(
    params: OpenPullRequestParams,
  ): Promise<OpenPullRequestResult> {
    let createdPR = await this.request<{
      number: number;
      html_url: string;
    }>({
      action: 'open pull request',
      method: 'POST',
      path: `/repos/${params.owner}/${params.repo}/pulls`,
      body: params,
    });

    await this.request({
      action: 'request reviewers',
      method: 'POST',
      path: `/repos/${params.owner}/${params.repo}/pulls/${createdPR.number}/requested_reviewers`,
      body: {
        team_reviewers: GITHUB_TEAM_REVIEWERS,
      },
    });

    return {
      number: createdPR.number,
      html_url: createdPR.html_url,
    };
  }

  async createBranch(params: CreateBranchParams): Promise<CreateBranchResult> {
    let fromBranch = normalizeBranchName(params.fromBranch);
    let branch = normalizeBranchName(params.branch);

    if (!fromBranch) {
      throw new Error('fromBranch is required');
    }

    if (!branch) {
      throw new Error('branch is required');
    }

    let sourceRef = await this.request<{
      object: { sha: string };
    }>({
      action: 'get source branch ref',
      method: 'GET',
      path: `/repos/${params.owner}/${params.repo}/git/ref/heads/${encodeURIComponent(fromBranch)}`,
    });

    let createdRef = await this.request<{
      ref: string;
      object: { sha: string };
    }>({
      action: 'create branch',
      method: 'POST',
      path: `/repos/${params.owner}/${params.repo}/git/refs`,
      body: {
        ref: `refs/heads/${branch}`,
        sha: sourceRef.object.sha,
      },
    });

    return {
      ref: createdRef.ref,
      sha: createdRef.object.sha,
    };
  }

  async writeFileToBranch(
    params: WriteFileToBranchParams,
  ): Promise<WriteFileToBranchResult> {
    return this.writeFilesToBranch({
      owner: params.owner,
      repo: params.repo,
      branch: params.branch,
      files: [{ path: params.path, content: params.content }],
      message: params.message,
    });
  }

  async writeFilesToBranch(
    params: WriteFilesToBranchParams,
  ): Promise<WriteFilesToBranchResult> {
    let branch = normalizeBranchName(params.branch);

    if (!branch) {
      throw new Error('branch is required');
    }
    if (!params.message?.trim()) {
      throw new Error('message is required');
    }
    if (!Array.isArray(params.files) || params.files.length === 0) {
      throw new Error('files are required');
    }

    let normalizedFiles = params.files
      .map((file) => ({
        path: file.path?.trim(),
        content: file.content ?? '',
        isBinary: file.isBinary ?? false,
      }))
      .filter((file) => !!file.path) as {
      path: string;
      content: string;
      isBinary: boolean;
    }[];
    if (normalizedFiles.length === 0) {
      throw new Error('at least one file path is required');
    }

    let branchRef = await this.request<{
      object: { sha: string };
    }>({
      action: 'get branch ref',
      method: 'GET',
      path: `/repos/${params.owner}/${params.repo}/git/ref/heads/${encodeURIComponent(branch)}`,
    });
    let parentCommitSha = branchRef.object.sha;

    let parentCommit = await this.request<{
      tree: { sha: string };
    }>({
      action: 'get parent commit',
      method: 'GET',
      path: `/repos/${params.owner}/${params.repo}/git/commits/${parentCommitSha}`,
    });
    let baseTreeSha = parentCommit.tree.sha;

    if (params.syncFolder && params.folderMustBeNewOn) {
      let base = normalizeBranchName(params.folderMustBeNewOn);
      let baseRef = await this.request<{ object: { sha: string } }>({
        action: 'get base branch ref',
        method: 'GET',
        path: `/repos/${params.owner}/${params.repo}/git/ref/heads/${encodeURIComponent(base)}`,
      });
      let baseCommit = await this.request<{ tree: { sha: string } }>({
        action: 'get base commit',
        method: 'GET',
        path: `/repos/${params.owner}/${params.repo}/git/commits/${baseRef.object.sha}`,
      });
      if (
        await this.pathExists(
          params.owner,
          params.repo,
          baseCommit.tree.sha,
          params.syncFolder,
        )
      ) {
        throw new Error(
          `folder '${params.syncFolder}' already exists on ${base}`,
        );
      }
    }

    if (params.syncFolder && params.submitterTag) {
      for (let page = 1; ; page++) {
        // Far past any submission's history: refuse instead of reading on.
        if (page > COMMIT_PAGES_READ) {
          throw new Error(
            `folder '${params.syncFolder}' on ${branch} has too long a history to tell whose it is`,
          );
        }
        let commits = await this.request<{ commit: { message: string } }[]>({
          action: 'list commits touching the folder',
          method: 'GET',
          path: `/repos/${params.owner}/${params.repo}/commits?sha=${encodeURIComponent(branch)}&path=${encodeURIComponent(params.syncFolder)}&per_page=${COMMITS_PER_PAGE}&page=${page}`,
        });
        for (let { commit } of commits) {
          let tag = commit.message.match(/\[boxel-submitter:([0-9a-f]+)\]\s*$/);
          if (tag && tag[1] !== params.submitterTag) {
            throw new Error(
              `folder '${params.syncFolder}' on ${branch} holds another submitter's files`,
            );
          }
        }
        if (commits.length < COMMITS_PER_PAGE) {
          break;
        }
      }
    }

    // One blob at a time: GitHub's secondary rate limits penalize concurrent
    // requests that create content, and a listing can have many files.
    let tree: {
      path: string;
      mode: '100644';
      type: 'blob';
      sha: string | null;
    }[] = [];
    for (let file of normalizedFiles) {
      let blob = await this.request<{ sha: string }>({
        action: 'create blob',
        method: 'POST',
        path: `/repos/${params.owner}/${params.repo}/git/blobs`,
        body: {
          content: file.content,
          encoding: file.isBinary ? 'base64' : 'utf-8',
        },
      });
      tree.push({
        path: file.path,
        mode: '100644',
        type: 'blob',
        sha: blob.sha,
      });
    }

    if (params.syncFolder) {
      let keptPaths = new Set(normalizedFiles.map((file) => file.path));
      let existingPaths = await this.listBlobPathsUnder(
        params.owner,
        params.repo,
        baseTreeSha,
        params.syncFolder,
      );
      for (let path of existingPaths) {
        if (!keptPaths.has(path)) {
          // a null sha is the Git Data API's deletion entry
          tree.push({ path, mode: '100644', type: 'blob', sha: null });
        }
      }
    }

    let createdTree = await this.request<{
      sha: string;
    }>({
      action: 'create tree',
      method: 'POST',
      path: `/repos/${params.owner}/${params.repo}/git/trees`,
      body: {
        base_tree: baseTreeSha,
        tree,
      },
    });

    let createdCommit = await this.request<{
      sha: string;
    }>({
      action: 'create commit',
      method: 'POST',
      path: `/repos/${params.owner}/${params.repo}/git/commits`,
      body: {
        message: params.message.trim(),
        tree: createdTree.sha,
        parents: [parentCommitSha],
      },
    });

    await this.request({
      action: 'update branch ref',
      method: 'PATCH',
      path: `/repos/${params.owner}/${params.repo}/git/refs/heads/${encodeURIComponent(branch)}`,
      body: {
        sha: createdCommit.sha,
        force: false,
      },
    });

    return { commitSha: createdCommit.sha };
  }

  // Walks segment-by-segment to the folder's own tree before listing it
  // recursively, so only the folder's subtree — never the whole repo — is
  // subject to the recursive listing (and its truncation limit). Returns []
  // when the folder doesn't exist on the branch yet.
  // Whether the tree holds anything, file or folder, at `path`. A listing
  // GitHub cut short counts as holding it.
  private async pathExists(
    owner: string,
    repo: string,
    rootTreeSha: string,
    path: string,
  ): Promise<boolean> {
    let treeSha = rootTreeSha;
    let segments = path.split('/').filter(Boolean);
    for (let [index, segment] of segments.entries()) {
      let { tree, truncated } = await this.request<{
        tree: { path: string; type: string; sha: string }[];
        truncated?: boolean;
      }>({
        action: 'get tree',
        method: 'GET',
        path: `/repos/${owner}/${repo}/git/trees/${treeSha}`,
      });
      let entry = tree.find((e) => e.path === segment);
      if (!entry) {
        return !!truncated;
      }
      if (index === segments.length - 1 || entry.type !== 'tree') {
        return true;
      }
      treeSha = entry.sha;
    }
    return false;
  }

  private async listBlobPathsUnder(
    owner: string,
    repo: string,
    rootTreeSha: string,
    folder: string,
  ): Promise<string[]> {
    let segments = folder.split('/').filter(Boolean);
    let treeSha = rootTreeSha;
    for (let segment of segments) {
      let { tree } = await this.request<{
        tree: { path: string; type: string; sha: string }[];
      }>({
        action: 'get tree',
        method: 'GET',
        path: `/repos/${owner}/${repo}/git/trees/${treeSha}`,
      });
      let entry = tree.find((e) => e.path === segment && e.type === 'tree');
      if (!entry) {
        return [];
      }
      treeSha = entry.sha;
    }
    let { tree, truncated } = await this.request<{
      tree: { path: string; type: string }[];
      truncated?: boolean;
    }>({
      action: 'get folder tree',
      method: 'GET',
      path: `/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`,
    });
    if (truncated) {
      throw new Error(
        `tree listing for "${folder}" was truncated; refusing to compute deletions from an incomplete listing`,
      );
    }
    let prefix = segments.join('/');
    return tree
      .filter((e) => e.type === 'blob')
      .map((e) => `${prefix}/${e.path}`);
  }

  private getToken(): string {
    if (!this.token) {
      throw new Error('SUBMISSION_BOT_GITHUB_TOKEN is not set');
    }
    return this.token;
  }

  private async request<T = unknown>({
    action,
    method,
    path,
    body,
  }: {
    action: string;
    method: 'GET' | 'POST' | 'PATCH';
    path: string;
    body?: unknown;
  }): Promise<T> {
    let token = this.getToken();
    let response: Response;

    for (let attempt = 0; ; attempt++) {
      try {
        response = await fetch(`${GITHUB_API_BASE}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Type': 'application/json',
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (error) {
        throw toGitHubError(action, error);
      }

      if (response.ok) {
        break;
      }

      let payload = await readErrorPayload(response);
      if (
        attempt < MAX_RATE_LIMIT_RETRIES &&
        isRateLimited(response, payload)
      ) {
        let waitMs = rateLimitWaitMs(response, attempt, this.now());
        if (waitMs <= MAX_RATE_LIMIT_WAIT_MS) {
          await this.sleep(waitMs);
          continue;
        }
      }
      throw new Error(
        `Failed to ${action} (${response.status}): ${JSON.stringify(payload)}`,
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }

    let text = await response.text();
    if (!text) {
      return undefined as T;
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      return text as T;
    }
  }
}

export function createGitHubClientFromEnv(): GitHubClient {
  let token = process.env.SUBMISSION_BOT_GITHUB_TOKEN?.trim();
  if (!token) {
    throw new Error(
      'SUBMISSION_BOT_GITHUB_TOKEN must be set before starting bot-runner',
    );
  }
  return new OctokitGitHubClient(token);
}

function normalizeBranchName(branch: string): string {
  return branch
    .trim()
    .replace(/^refs\/heads\//, '')
    .replace(/^origin\//, '');
}

async function readErrorPayload(response: Response): Promise<unknown> {
  let text = await response.text();
  if (!text) {
    return { message: response.statusText };
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function isRateLimited(response: Response, payload: unknown): boolean {
  if (response.status === 429) {
    return true;
  }
  if (response.status !== 403) {
    return false;
  }
  if (
    response.headers.has('retry-after') ||
    response.headers.get('x-ratelimit-remaining') === '0'
  ) {
    return true;
  }
  let message =
    payload && typeof payload === 'object' && 'message' in payload
      ? String((payload as { message: unknown }).message)
      : String(payload);
  return /rate limit/i.test(message);
}

function rateLimitWaitMs(
  response: Response,
  attempt: number,
  nowMs: number,
): number {
  let retryAfter = Number(response.headers.get('retry-after') ?? NaN);
  if (Number.isFinite(retryAfter) && retryAfter >= 0) {
    return retryAfter * 1000;
  }
  if (response.headers.get('x-ratelimit-remaining') === '0') {
    let resetSeconds = Number(response.headers.get('x-ratelimit-reset') ?? NaN);
    if (Number.isFinite(resetSeconds)) {
      return Math.max(0, resetSeconds * 1000 - nowMs);
    }
  }
  return DEFAULT_RATE_LIMIT_WAIT_MS * 2 ** attempt;
}

function toGitHubError(action: string, error: unknown): Error {
  let payload = error instanceof Error ? error.message : String(error);
  return new Error(`Failed to ${action} (unknown): ${JSON.stringify(payload)}`);
}
