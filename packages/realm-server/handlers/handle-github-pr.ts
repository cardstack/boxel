import type Koa from 'koa';
import { fetchRequestFromContext, setContextResponse } from '../middleware';
import { createPullRequest } from '../lib/github';
import type { CreateRoutesArgs } from '../routes';
import { SupportedMimeType } from '@cardstack/runtime-common';

export interface CreateGitHubPRRequestBody {
  data: {
    type: 'github-pr';
    attributes: {
      listingName: string;
      listingId?: string;
      snapshotId: string;
      branch: string;
      baseBranch?: string;
      files: Array<{
        path: string;
        content: string;
      }>;
    };
  };
}

export interface GitHubPRResponseBody {
  data: {
    type: 'github-pr';
    id: string;
    attributes: {
      prUrl: string;
      prNumber: number;
      branch: string;
      sha: string;
      status: 'open' | 'merged' | 'closed' | 'failed';
    };
  };
}

const DEFAULT_REPO = 'cardstack/boxel-catalog';
const DEFAULT_BASE_BRANCH = 'main';

export default function handleGitHubPRRequest(
  _args: CreateRoutesArgs,
): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let request = await fetchRequestFromContext(ctxt);
    let body: CreateGitHubPRRequestBody;

    try {
      body = (await request.json()) as CreateGitHubPRRequestBody;
    } catch (e) {
      let response = new Response(
        JSON.stringify({ errors: [{ detail: 'Invalid JSON body' }] }),
        {
          status: 400,
          headers: { 'Content-Type': SupportedMimeType.JSONAPI },
        },
      );
      await setContextResponse(ctxt, response);
      return;
    }

    if (body.data?.type !== 'github-pr') {
      let response = new Response(
        JSON.stringify({
          errors: [{ detail: 'Expected data.type to be "github-pr"' }],
        }),
        {
          status: 400,
          headers: { 'Content-Type': SupportedMimeType.JSONAPI },
        },
      );
      await setContextResponse(ctxt, response);
      return;
    }

    const { listingName, listingId, snapshotId, branch, baseBranch, files } =
      body.data.attributes;

    if (!files || files.length === 0) {
      let response = new Response(
        JSON.stringify({
          errors: [{ detail: 'At least one file is required' }],
        }),
        {
          status: 400,
          headers: { 'Content-Type': SupportedMimeType.JSONAPI },
        },
      );
      await setContextResponse(ctxt, response);
      return;
    }

    if (!branch) {
      let response = new Response(
        JSON.stringify({
          errors: [{ detail: 'Branch name is required' }],
        }),
        {
          status: 400,
          headers: { 'Content-Type': SupportedMimeType.JSONAPI },
        },
      );
      await setContextResponse(ctxt, response);
      return;
    }

    const repo = process.env.GITHUB_TARGET_REPO || DEFAULT_REPO;

    try {
      const result = await createPullRequest({
        repo,
        branch,
        baseBranch: baseBranch || DEFAULT_BASE_BRANCH,
        title: `Add listing: ${listingName || listingId || snapshotId}`,
        body: generatePRBody({
          listingName,
          listingId,
          snapshotId,
          files,
        }),
        files,
      });

      const responseBody: GitHubPRResponseBody = {
        data: {
          type: 'github-pr',
          id: snapshotId,
          attributes: {
            prUrl: result.prUrl,
            prNumber: result.prNumber,
            branch: result.branch,
            sha: result.sha,
            status: 'open',
          },
        },
      };

      let response = new Response(JSON.stringify(responseBody), {
        status: 201,
        headers: { 'Content-Type': SupportedMimeType.JSONAPI },
      });
      await setContextResponse(ctxt, response);
    } catch (error: any) {
      console.error('GitHub PR creation failed:', error);

      let errorMessage = error.message || 'Failed to create GitHub PR';
      if (error.status === 401 || error.status === 403) {
        errorMessage =
          'GitHub authentication failed. Check GITHUB_TOKEN configuration.';
      } else if (error.status === 404) {
        errorMessage = `Repository not found: ${repo}`;
      } else if (error.status === 422) {
        errorMessage = `Validation failed: ${error.message}`;
      }

      let response = new Response(
        JSON.stringify({
          errors: [{ detail: errorMessage, status: error.status || 500 }],
        }),
        {
          status: error.status || 500,
          headers: { 'Content-Type': SupportedMimeType.JSONAPI },
        },
      );
      await setContextResponse(ctxt, response);
    }
  };
}

function generatePRBody(params: {
  listingName?: string;
  listingId?: string;
  snapshotId: string;
  files: Array<{ path: string }>;
}): string {
  const fileList = params.files.map((f) => `- \`${f.path}\``).join('\n');

  return `## Listing Submission

**Listing:** ${params.listingName || params.listingId || 'Unknown'}  
**Snapshot ID:** ${params.snapshotId}

### Files included (${params.files.length}):
${fileList}

---
*Auto-generated by Boxel*`;
}
