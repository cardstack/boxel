const GITHUB_API_BASE = 'https://api.github.com';
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
  files: { path: string; content: string }[];
  message: string;
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

export class OctokitGitHubClient implements GitHubClient {
  constructor(private token: string | undefined) {}

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
      }))
      .filter((file) => !!file.path) as { path: string; content: string }[];
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

    let tree = await Promise.all(
      normalizedFiles.map(async (file) => {
        let blob = await this.request<{ sha: string }>({
          action: 'create blob',
          method: 'POST',
          path: `/repos/${params.owner}/${params.repo}/git/blobs`,
          body: {
            content: file.content,
            encoding: 'utf-8',
          },
        });

        return {
          path: file.path,
          mode: '100644' as const,
          type: 'blob' as const,
          sha: blob.sha,
        };
      }),
    );

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

    if (!response.ok) {
      let payload = await readErrorPayload(response);
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

function toGitHubError(action: string, error: unknown): Error {
  let payload = error instanceof Error ? error.message : String(error);
  return new Error(
    `Failed to ${action} (unknown): ${JSON.stringify(payload)}`,
  );
}
