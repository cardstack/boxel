import { Octokit } from '@octokit/rest';

let octokit: Octokit | undefined;

export function getGitHub(): Octokit {
  if (!process.env.GITHUB_TOKEN) {
    throw new Error('GITHUB_TOKEN is not set');
  }

  if (!octokit) {
    octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  }

  return octokit;
}

export interface GitHubPRFile {
  path: string;
  content: string;
}

export interface CreatePRParams {
  repo: string; // e.g., "cardstack/boxel-catalog"
  branch: string;
  baseBranch: string;
  title: string;
  body?: string;
  files: GitHubPRFile[];
}

export interface CreatePRResult {
  prUrl: string;
  prNumber: number;
  branch: string;
  sha: string;
}

const DEFAULT_REPO = 'cardstack/boxel-catalog';
const DEFAULT_BASE_BRANCH = 'main';

/**
 * Creates a branch, commits files, and opens a PR to the target repository.
 */
export async function createPullRequest(
  params: CreatePRParams,
): Promise<CreatePRResult> {
  const gh = getGitHub();

  const repo = params.repo || process.env.GITHUB_TARGET_REPO || DEFAULT_REPO;
  const baseBranch =
    params.baseBranch || process.env.GITHUB_BASE_BRANCH || DEFAULT_BASE_BRANCH;
  const [owner, repoName] = repo.split('/');

  if (!owner || !repoName) {
    throw new Error(`Invalid repo format: ${repo}. Expected "owner/repo"`);
  }

  // 1. Get the SHA of the base branch
  const { data: refData } = await gh.git.getRef({
    owner,
    repo: repoName,
    ref: `heads/${baseBranch}`,
  });
  const baseSha = refData.object.sha;

  // 2. Create a new branch from the base branch
  try {
    await gh.git.createRef({
      owner,
      repo: repoName,
      ref: `refs/heads/${params.branch}`,
      sha: baseSha,
    });
  } catch (error: any) {
    // Branch might already exist - if so, that's okay for now
    if (error.status !== 422) {
      throw error;
    }
  }

  // 3. Create blobs for each file
  const blobs = await Promise.all(
    params.files.map(async (file) => {
      const { data } = await gh.git.createBlob({
        owner,
        repo: repoName,
        content: Buffer.from(file.content).toString('base64'),
        encoding: 'base64',
      });
      return { path: file.path, sha: data.sha };
    }),
  );

  // 4. Create a tree with all the files
  const { data: treeData } = await gh.git.createTree({
    owner,
    repo: repoName,
    base_tree: baseSha,
    tree: blobs.map((blob) => ({
      path: blob.path,
      mode: '100644',
      type: 'blob',
      sha: blob.sha,
    })),
  });

  // 5. Create a commit
  const { data: commitData } = await gh.git.createCommit({
    owner,
    repo: repoName,
    message: params.title,
    tree: treeData.sha,
    parents: [baseSha],
  });

  // 6. Update the branch reference to point to the new commit
  await gh.git.updateRef({
    owner,
    repo: repoName,
    ref: `heads/${params.branch}`,
    sha: commitData.sha,
  });

  // 7. Create the pull request
  const { data: prData } = await gh.pulls.create({
    owner,
    repo: repoName,
    title: params.title,
    body: params.body || '',
    head: params.branch,
    base: baseBranch,
  });

  return {
    prUrl: prData.html_url,
    prNumber: prData.number,
    branch: params.branch,
    sha: commitData.sha,
  };
}
