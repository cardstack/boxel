import type { Command } from 'commander';

import { resolveRealmAuthenticator } from '../../lib/auth-resolver.ts';
import {
  listDeckRealmReviews,
  openDeckWorkspaceReview,
  readDeckRealmReview,
} from '../../lib/deck-realm-reviews.ts';
import { loadDeckWorkspaceState } from '../../lib/deck-workspace-state.ts';
import { resolveRealmSecretSeed } from '../../lib/prompt.ts';
import { resolveRealmIdentifier } from '../../lib/resolve-realm-identifier.ts';
import { detectRealmSyncMode } from '../../lib/realm-sync-mode.ts';

async function realmClient(realm: string, useSeed: boolean) {
  let resolved = resolveRealmIdentifier(realm);
  if (!resolved.ok) throw new Error(resolved.error);
  let auth = resolveRealmAuthenticator({
    realmUrl: resolved.url,
    realmSecretSeed: await resolveRealmSecretSeed(useSeed),
  });
  if (!auth.ok) throw new Error(auth.error);
  let mode = await detectRealmSyncMode(resolved.url, auth.authenticator);
  if (mode.mode !== 'deck') {
    throw new Error(
      'This Realm uses legacy mtime sync and has no Deck Reviews',
    );
  }
  return { realmURL: resolved.url, authenticator: auth.authenticator };
}

function printReview(review: Awaited<ReturnType<typeof readDeckRealmReview>>) {
  console.log(`#${review.number} ${review.state} · ${review.title}`);
  console.log(`${review.source.branch} → ${review.target.branch}`);
  console.log(`source ${review.source.checkpointHash}`);
  console.log(`target ${review.target.checkpointHash}`);
  console.log(`base   ${review.base.checkpointHash}`);
}

export function registerReviewCommand(realm: Command): void {
  let review = realm
    .command('review')
    .description('Open and inspect fixed Deck Reviews');

  review
    .command('open')
    .argument('<local-dir>', 'Existing Deck workspace on the source branch')
    .requiredOption('--target <branch>', 'Target branch, usually main')
    .requiredOption('--title <title>', 'Review title')
    .option('--body <body>', 'Review description')
    .option('--json', 'Print structured JSON')
    .option('--realm-secret-seed', 'Authenticate with the Realm secret seed')
    .action(async (localDir: string, options) => {
      let workspace = await loadDeckWorkspaceState(localDir);
      if (!workspace) {
        throw new Error(
          'Deck Review requires an existing .boxel-sync.json workspace',
        );
      }
      let client = await realmClient(
        workspace.realmURL,
        options.realmSecretSeed === true,
      );
      let result = await openDeckWorkspaceReview({
        localDir,
        targetBranch: options.target,
        title: options.title,
        body: options.body,
        authenticator: client.authenticator,
      });
      options.json
        ? console.log(JSON.stringify(result, null, 2))
        : printReview(result);
    });

  review
    .command('list')
    .argument('<realm-url>', 'Realm URL or configured Realm name')
    .option('--json', 'Print structured JSON')
    .option('--realm-secret-seed', 'Authenticate with the Realm secret seed')
    .action(async (realmURL: string, options) => {
      let client = await realmClient(
        realmURL,
        options.realmSecretSeed === true,
      );
      let result = await listDeckRealmReviews(client);
      if (options.json) return console.log(JSON.stringify(result, null, 2));
      for (let item of result.reviews) printReview(item);
    });

  review
    .command('show')
    .argument('<realm-url>', 'Realm URL or configured Realm name')
    .argument('<number>', 'Review number', (value) => Number(value))
    .option('--json', 'Print structured JSON')
    .option('--realm-secret-seed', 'Authenticate with the Realm secret seed')
    .action(async (realmURL: string, number: number, options) => {
      if (!Number.isSafeInteger(number) || number < 1) {
        throw new Error('Review number must be a positive integer');
      }
      let client = await realmClient(
        realmURL,
        options.realmSecretSeed === true,
      );
      let result = await readDeckRealmReview({ ...client, number });
      options.json
        ? console.log(JSON.stringify(result, null, 2))
        : printReview(result);
    });
}
