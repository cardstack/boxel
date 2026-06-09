import { service } from '@ember/service';

import { ensureTrailingSlash } from '@cardstack/runtime-common';
import { getMatrixUsername } from '@cardstack/runtime-common/matrix-client';

import config from '@cardstack/host/config/environment';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';
import {
  resolvePublishedRealmUrl,
  type PublishTargetType,
} from '../lib/published-realm-url';

import type RealmService from '../services/realm';
import type { PublishabilityViolation } from '../services/realm';

// Publishes a realm to one or more destinations (subdirectory Boxel Spaces or
// custom domains). The command resolves once the realm-server accepts each
// publish request and reports per-target status. Indexed-and-viewable
// readiness is not awaited here: realm `index` events aren't delivered to the
// run-command/prerender context, so a caller that needs the published realm
// ready polls its `_readiness-check` over HTTP instead.
export default class PublishRealmCommand extends HostBaseCommand<
  typeof BaseCommandModule.PublishRealmInput,
  typeof BaseCommandModule.PublishRealmResult
> {
  @service declare private realm: RealmService;

  static actionVerb = 'Publish';
  description = 'Publish a realm to one or more destinations';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    return commandModule.PublishRealmInput;
  }

  requireInputFields = ['realmURL'];

  protected async run(
    input: BaseCommandModule.PublishRealmInput,
  ): Promise<BaseCommandModule.PublishRealmResult> {
    let commandModule = await this.loadCommandModule();
    let { PublishRealmResult, PublishTargetResult } = commandModule;

    // Normalize so endpoint URLs like `${realmURL}_publishability` are well
    // formed and the cached RealmResource (token/claims) is found even when the
    // caller omits the trailing slash.
    let realmURL = ensureTrailingSlash(input.realmURL);
    let matrixUsername = this.matrixUsernameFor(realmURL);

    // Targets are resolved to published-realm URLs; callers that already hold
    // resolved URLs (e.g. the publish UI) pass them via `publishedRealmURLs`.
    // Merge both, de-duplicated, preserving order.
    let resolvedFromTargets = (input.targets ?? []).map((target) =>
      resolvePublishedRealmUrl(
        { type: target.type as PublishTargetType, name: target.name },
        {
          sourceRealmURL: realmURL,
          matrixUsername,
          spaceDomain: config.publishedRealmBoxelSpaceDomain,
        },
      ),
    );
    let publishedRealmURLs = [
      ...new Set([...resolvedFromTargets, ...(input.publishedRealmURLs ?? [])]),
    ];
    if (publishedRealmURLs.length === 0) {
      throw new Error(
        'Provide at least one entry in `targets` or `publishedRealmURLs`',
      );
    }

    // Pre-publish gate: refuse to publish a realm with private-dependency or
    // error-document violations unless the caller explicitly forces it.
    if (!input.force) {
      let report = await this.realm.fetchPrivateDependencyReport(realmURL);
      if (!report.publishable) {
        throw new Error(describeViolations(report.violations));
      }
    }

    let settled = await this.realm.publish(realmURL, publishedRealmURLs);

    let results = publishedRealmURLs.map((publishedRealmURL, i) => {
      let outcome = settled?.[i];
      if (outcome?.status === 'fulfilled') {
        return new PublishTargetResult({
          publishedRealmURL,
          status: 'published',
        });
      }
      return new PublishTargetResult({
        publishedRealmURL,
        status: 'error',
        error:
          outcome?.status === 'rejected'
            ? errorMessage(outcome.reason)
            : 'Publish request did not complete',
      });
    });

    return new PublishRealmResult({ results });
  }

  // The matrix username (used to form subdirectory Boxel Space URLs) is read
  // from the realm session claims rather than MatrixService, since the matrix
  // client is not started in the headless run-command context.
  private matrixUsernameFor(realmURL: string): string | undefined {
    let userId = this.realm.getOrCreateRealmResource(realmURL).claims?.user;
    return userId ? getMatrixUsername(userId) : undefined;
  }
}

function describeViolations(violations: PublishabilityViolation[]): string {
  let privateCount = violations.filter(
    (v) => v.kind === 'private-dependency',
  ).length;
  let errorCount = violations.filter((v) => v.kind === 'error-document').length;

  let parts: string[] = [];
  if (privateCount) {
    parts.push(`${privateCount} private-dependency violation(s)`);
  }
  if (errorCount) {
    parts.push(`${errorCount} error-document violation(s)`);
  }
  let summary = parts.length
    ? parts.join(', ')
    : `${violations.length} violation(s)`;

  let resources = violations
    .map((v) => v.resource)
    .filter(Boolean)
    .slice(0, 5)
    .join(', ');

  return `Realm is not publishable (${summary}). Resolve them or pass force=true to override.${
    resources ? ` Affected: ${resources}` : ''
  }`;
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
