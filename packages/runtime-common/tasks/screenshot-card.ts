import type * as JSONTypes from 'json-typescript';

import type { Task } from './index';

import {
  fetchRealmPermissions,
  fetchUserPermissions,
  jobIdentity,
  type ScreenshotPrerenderResponse,
  ensureFullMatrixUserId,
  ensureTrailingSlash,
} from '../index';

export interface ScreenshotCardArgs extends JSONTypes.Object {
  realmURL: string;
  realmUsername: string;
  runAs: string;
  cardId: string;
  format: 'isolated' | 'embedded';
}

export { screenshotCard };

const screenshotCard: Task<ScreenshotCardArgs, ScreenshotPrerenderResponse> = ({
  reportStatus,
  log,
  dbAdapter,
  prerenderer,
  createPrerenderAuth,
  matrixURL,
}) =>
  async function (args) {
    let { jobInfo, realmURL, runAs, cardId, format } = args;
    log.debug(
      `${jobIdentity(jobInfo)} starting screenshot-card for job: ${JSON.stringify(
        {
          realmURL,
          runAs,
          cardId,
          format,
        },
      )}`,
    );
    reportStatus(jobInfo, 'start');

    if (!prerenderer.prerenderScreenshot) {
      let message = `${jobIdentity(jobInfo)} prerenderer does not support screenshot capture`;
      log.error(message);
      reportStatus(jobInfo, 'finish');
      return {
        status: 'error',
        error: message,
      };
    }

    let normalizedRealmURL = ensureTrailingSlash(realmURL);
    let realmPermissions = await fetchRealmPermissions(
      dbAdapter,
      new URL(normalizedRealmURL),
    );
    let runAsUserId = ensureFullMatrixUserId(runAs, matrixURL);
    let userPermissions = realmPermissions[runAsUserId];
    if (!userPermissions || userPermissions.length === 0) {
      let message = `${jobIdentity(jobInfo)} ${runAs} does not have permissions in ${normalizedRealmURL}`;
      log.error(message);
      reportStatus(jobInfo, 'finish');
      return {
        status: 'error',
        error: message,
      };
    }

    // Include JWTs for all realms the user has access to so cross-realm card
    // references render correctly during the screenshot.
    let allUserPermissions = await fetchUserPermissions(dbAdapter, {
      userId: runAsUserId,
    });
    allUserPermissions[normalizedRealmURL] = userPermissions;
    let auth = createPrerenderAuth(runAsUserId, allUserPermissions);

    let result = await prerenderer.prerenderScreenshot({
      realm: normalizedRealmURL,
      url: cardId,
      auth,
      format,
      priority: jobInfo?.priority,
    });

    reportStatus(jobInfo, 'finish');
    return result;
  };
