import { Webhooks } from '@octokit/webhooks';
import type {
  EmitterWebhookEvent,
  EmitterWebhookEventName,
} from '@octokit/webhooks';
import type {
  PREventContent,
  PRReviewEventContent,
} from 'https://cardstack.com/base/matrix-event';
import {
  APP_BOXEL_PR_EVENT_TYPE,
  APP_BOXEL_PR_REVIEW_EVENT_TYPE,
} from './matrix-constants';
import { branchNameToMatrixRoomId } from './github-webhook';

export type GitHubWebhookEventName = Extract<
  EmitterWebhookEventName,
  'pull_request' | 'pull_request_review'
>;

export type ParsedGitHubWebhookEvent =
  | {
      eventType: 'pull_request';
      payload: EmitterWebhookEvent<'pull_request'>['payload'];
    }
  | {
      eventType: 'pull_request_review';
      payload: EmitterWebhookEvent<'pull_request_review'>['payload'];
    };

export type GitHubWebhookHandledResult = {
  github: {
    eventType: GitHubWebhookEventName;
    actionType?: string;
    branchName?: string;
    baseBranchName?: string;
    messageBody?: string;
  };
  matrix: {
    roomId?: string;
    eventType?: string;
    eventContent?: PREventContent | PRReviewEventContent;
  };
};

function isSupportedEventType(value: string): value is GitHubWebhookEventName {
  return value === 'pull_request' || value === 'pull_request_review';
}

export function parseGitHubWebhookEvent(args: {
  eventType: string;
  payload: unknown;
}): ParsedGitHubWebhookEvent {
  if (!isSupportedEventType(args.eventType)) {
    throw new Error(`Unsupported webhook event type: ${args.eventType}`);
  }
  if (!args.payload || typeof args.payload !== 'object') {
    throw new Error('Invalid webhook payload');
  }

  if (args.eventType === 'pull_request') {
    return {
      eventType: 'pull_request',
      payload: args.payload as EmitterWebhookEvent<'pull_request'>['payload'],
    };
  }

  return {
    eventType: 'pull_request_review',
    payload:
      args.payload as EmitterWebhookEvent<'pull_request_review'>['payload'],
  };
}

export async function handleGitHubWebhookEvent(args: {
  secret: string;
  deliveryId: string;
  event: ParsedGitHubWebhookEvent;
}): Promise<GitHubWebhookHandledResult> {
  let result: GitHubWebhookHandledResult = {
    github: { eventType: args.event.eventType },
    matrix: {},
  };
  let webhooks = new Webhooks({ secret: args.secret });

  webhooks.on('pull_request', async ({ payload }) => {
    result.github.actionType = payload.action;
    result.github.branchName = payload.pull_request?.head?.ref;
    result.github.baseBranchName = payload.pull_request?.base?.ref;
    if (
      payload.action !== 'opened' &&
      payload.action !== 'closed' &&
      payload.action !== 'reopened' &&
      payload.action !== 'synchronize'
    ) {
      throw new Error(`Unsupported pull_request action: ${payload.action}`);
    }
    let action: PREventContent['action'] = payload.action;
    result.matrix.eventType = APP_BOXEL_PR_EVENT_TYPE;
    result.matrix.eventContent = {
      action,
      pullRequest: {
        number: payload.pull_request?.number ?? 0,
        title: payload.pull_request?.title ?? undefined,
        url: payload.pull_request?.url ?? undefined,
        htmlUrl: payload.pull_request?.html_url ?? undefined,
        author: payload.pull_request?.user?.login ?? undefined,
        branch: payload.pull_request?.head?.ref ?? undefined,
        baseBranch: payload.pull_request?.base?.ref ?? undefined,
        merged: payload.pull_request?.merged ?? undefined,
        state: payload.pull_request?.state ?? undefined,
      },
    };
  });

  webhooks.on('pull_request_review', async ({ payload }) => {
    result.github.actionType = payload.action;
    result.github.branchName = payload.pull_request?.head?.ref;
    result.github.baseBranchName = payload.pull_request?.base?.ref;
    if (payload.action !== 'submitted') {
      throw new Error(
        `Unsupported pull_request_review action: ${payload.action}`,
      );
    }
    let action: PRReviewEventContent['action'] = payload.action;
    let reviewState = payload.review?.state;
    if (reviewState !== 'approved' && reviewState !== 'changes_requested') {
      throw new Error(
        `Unsupported pull_request_review state: ${payload.review?.state}`,
      );
    }
    let reviewStateValue: PRReviewEventContent['state'] = reviewState;
    result.matrix.eventType = APP_BOXEL_PR_REVIEW_EVENT_TYPE;
    result.matrix.eventContent = {
      action,
      state: reviewStateValue,
      pullRequest: {
        number: payload.pull_request?.number ?? 0,
        title: payload.pull_request?.title ?? undefined,
        url: payload.pull_request?.url ?? undefined,
        htmlUrl: payload.pull_request?.html_url ?? undefined,
        author: payload.pull_request?.user?.login ?? undefined,
        branch: payload.pull_request?.head?.ref ?? undefined,
        baseBranch: payload.pull_request?.base?.ref ?? undefined,
        state: payload.pull_request?.state ?? undefined,
      },
    };
  });

  //dispatches the event to .on handlers
  await webhooks.receive({
    id: args.deliveryId,
    name: args.event.eventType,
    payload: args.event.payload,
  } as EmitterWebhookEvent);

  if (result.github.branchName) {
    try {
      result.matrix.roomId = branchNameToMatrixRoomId(result.github.branchName);
    } catch (error) {
      throw new Error(`Unsupported branch name: ${result.github.branchName}`);
    }
  } else {
    throw new Error('Missing pull request branch name');
  }

  return result;
}
