import { Octokit } from '@octokit/rest';

type CreatePullRequest = Octokit['rest']['pulls']['create'];
type RequestReviewers = Octokit['rest']['pulls']['requestReviewers'];
type AddLabels = Octokit['rest']['issues']['addLabels'];

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

const HARDCODED_REVIEWER = 'tintinthong';

export interface OpenPullRequestOptions {
  label: string;
}

export interface GitHubClient {
  openPullRequest(
    params: OpenPullRequestParams,
    options: OpenPullRequestOptions,
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
  private octokit: Octokit | undefined;

  constructor(private token: string | undefined) {}

  async openPullRequest(
    params: OpenPullRequestParams,
    options: OpenPullRequestOptions,
  ): Promise<OpenPullRequestResult> {
    let octokit = this.getClient();
    let label = options.label?.trim();
    if (!label) {
      throw new Error('label is required');
    }
    try {
      let prParams: Parameters<CreatePullRequest>[0] = {
        ...params,
      };
      let response = await octokit.rest.pulls.create(prParams);
      await octokit.rest.pulls.requestReviewers({
        owner: prParams.owner,
        repo: prParams.repo,
        pull_number: response.data.number,
        reviewers: [HARDCODED_REVIEWER],
      } as Parameters<RequestReviewers>[0]);
      await octokit.rest.issues.addLabels({
        owner: prParams.owner,
        repo: prParams.repo,
        issue_number: response.data.number,
        labels: [label],
      } as Parameters<AddLabels>[0]);
      return {
        number: response.data.number,
        html_url: response.data.html_url,
      };
    } catch (error: any) {
      throw toGitHubError('open pull request', error);
    }
  }

  async createBranch(params: CreateBranchParams): Promise<CreateBranchResult> {
    let octokit = this.getClient();
    let fromBranch = normalizeBranchName(params.fromBranch);
    let branch = normalizeBranchName(params.branch);

    if (!fromBranch) {
      throw new Error('fromBranch is required');
    }

    if (!branch) {
      throw new Error('branch is required');
    }

    try {
      let sourceRef = await octokit.rest.git.getRef({
        owner: params.owner,
        repo: params.repo,
        ref: `heads/${fromBranch}`,
      });
      let createdRef = await octokit.rest.git.createRef({
        owner: params.owner,
        repo: params.repo,
        ref: `refs/heads/${branch}`,
        sha: sourceRef.data.object.sha,
      });

      return {
        ref: createdRef.data.ref,
        sha: createdRef.data.object.sha,
      };
    } catch (error: any) {
      throw toGitHubError('create branch', error);
    }
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
    let octokit = this.getClient();
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

    try {
      let branchRef = await octokit.rest.git.getRef({
        owner: params.owner,
        repo: params.repo,
        ref: `heads/${branch}`,
      });
      let parentCommitSha = branchRef.data.object.sha;

      let parentCommit = await octokit.rest.git.getCommit({
        owner: params.owner,
        repo: params.repo,
        commit_sha: parentCommitSha,
      });
      let baseTreeSha = parentCommit.data.tree.sha;

      let tree = await Promise.all(
        normalizedFiles.map(async (file) => {
          let blob = await octokit.rest.git.createBlob({
            owner: params.owner,
            repo: params.repo,
            content: file.content,
            encoding: 'utf-8',
          });
          return {
            path: file.path,
            mode: '100644' as const,
            type: 'blob' as const,
            sha: blob.data.sha,
          };
        }),
      );

      let createdTree = await octokit.rest.git.createTree({
        owner: params.owner,
        repo: params.repo,
        base_tree: baseTreeSha,
        tree,
      });

      let createdCommit = await octokit.rest.git.createCommit({
        owner: params.owner,
        repo: params.repo,
        message: params.message.trim(),
        tree: createdTree.data.sha,
        parents: [parentCommitSha],
      });

      await octokit.rest.git.updateRef({
        owner: params.owner,
        repo: params.repo,
        ref: `heads/${branch}`,
        sha: createdCommit.data.sha,
        force: false,
      });

      return { commitSha: createdCommit.data.sha };
    } catch (error: any) {
      throw toGitHubError('write files to branch', error);
    }
  }

  private getClient(): Octokit {
    if (!this.token) {
      throw new Error('SUBMISSION_BOT_GITHUB_TOKEN is not set');
    }
    if (!this.octokit) {
      this.octokit = new Octokit({ auth: this.token });
    }
    return this.octokit;
  }
}

export function createGitHubClientFromEnv(): GitHubClient {
  return new OctokitGitHubClient(process.env.SUBMISSION_BOT_GITHUB_TOKEN);
}

function normalizeBranchName(branch: string): string {
  return branch
    .trim()
    .replace(/^refs\/heads\//, '')
    .replace(/^origin\//, '');
}

function toGitHubError(action: string, error: any): Error {
  let status =
    typeof error?.status === 'number' ? String(error.status) : 'unknown';
  let payload =
    error?.response?.data !== undefined ? error.response.data : error?.message;
  return new Error(
    `Failed to ${action} (${status}): ${JSON.stringify(payload)}`,
  );
}
