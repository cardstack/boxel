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

const HARDCODED_REVIEWER = 'tintinthong';
const HARDCODED_PR_HEAD_BRANCH = 'test-submissions';

export interface OpenPullRequestOptions {
  label: string;
}

export interface GitHubClient {
  openPullRequest(
    params: OpenPullRequestParams,
    options: OpenPullRequestOptions,
  ): Promise<OpenPullRequestResult>;
  createBranch(params: CreateBranchParams): Promise<CreateBranchResult>;
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
      // TODO: remove temporary hardcoded reviewer/head overrides once
      // submission branch creation is fully wired through bot-runner.
      let prParams: Parameters<CreatePullRequest>[0] = {
        ...params,
        head: HARDCODED_PR_HEAD_BRANCH,
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
  let status = typeof error?.status === 'number' ? String(error.status) : 'unknown';
  let payload =
    error?.response?.data !== undefined ? error.response.data : error?.message;
  return new Error(
    `Failed to ${action} (${status}): ${JSON.stringify(payload)}`,
  );
}
