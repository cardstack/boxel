// This should be first
import '../setup-logger.ts';

import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

import {
  ensureCombinedFactoryRealmTemplate,
  isFactorySupportContext,
  readSupportContext,
} from '@cardstack/realm-test-harness';
import { logger } from '../logger.ts';

let log = logger('cache-realm');

const KNOWN_FLAGS = new Set(['--force']);

// Glob controlling which SF source-realm files are copied into the
// template. Card definitions only — no instance data (e.g. wiki briefs,
// documents) which tests don't depend on and which would slow indexing.
// Format: space-separated patterns; prefix with `!` to exclude. Last
// matching pattern wins.
const SF_CARD_DEFINITIONS_GLOB = '*.gts realm.json !document.gts !wiki.gts';

function cardDefinitionsOnly(relativePath: string): boolean {
  let filename = relativePath.split('/').pop() ?? relativePath;
  let included = false;
  for (let pattern of SF_CARD_DEFINITIONS_GLOB.split(/\s+/)) {
    let negate = pattern.startsWith('!');
    let glob = negate ? pattern.slice(1) : pattern;
    let hit = glob.startsWith('*')
      ? filename.endsWith(glob.slice(1))
      : filename === glob;
    if (hit) {
      included = !negate;
    }
  }
  return included;
}

async function main(): Promise<void> {
  let flags = process.argv.slice(2).filter((arg) => arg.startsWith('--'));
  let unknownFlags = flags.filter((f) => !KNOWN_FLAGS.has(f));
  if (unknownFlags.length > 0) {
    log.warn(`unknown flag(s): ${unknownFlags.join(', ')}`);
  }
  let forceRebuild = flags.includes('--force');
  let args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));

  let realmDirs = [
    ...new Set(
      (args.length > 0 ? args : ['test-fixtures/darkfactory-adopter']).map(
        (realmDir) => resolve(process.cwd(), realmDir),
      ),
    ),
  ];
  let sfSourceRealmDir = resolve(process.cwd(), 'realm');
  let serializedSupportContext = process.env.TEST_HARNESS_CONTEXT;

  let parsedEnvContext = serializedSupportContext
    ? (JSON.parse(serializedSupportContext) as unknown)
    : undefined;
  let parsedMetadataContext = readSupportContext();
  let supportContext = isFactorySupportContext(parsedEnvContext)
    ? parsedEnvContext
    : isFactorySupportContext(parsedMetadataContext)
      ? parsedMetadataContext
      : undefined;

  // Validate that the context's URLs are still reachable. A stale
  // support.json from a previous run can have dead URLs which cause
  // the realm server to crash during template builds.
  if (supportContext) {
    if ('hostURL' in supportContext && supportContext.hostURL) {
      let hostURL = supportContext.hostURL;
      try {
        let response = await fetch(hostURL);
        if (!response.ok) {
          log.warn(
            `Stale support context: hostURL ${hostURL} returned ${response.status}, ignoring cached context`,
          );
          supportContext = undefined;
        }
      } catch {
        log.warn(
          `Stale support context: hostURL ${hostURL} is not reachable, ignoring cached context`,
        );
        supportContext = undefined;
      }
    }

    if (
      supportContext &&
      'matrixURL' in supportContext &&
      supportContext.matrixURL
    ) {
      let matrixURL = supportContext.matrixURL;
      try {
        let response = await fetch(`${matrixURL}/_matrix/client/versions`);
        if (!response.ok) {
          log.warn(
            `Stale support context: matrixURL ${matrixURL} returned ${response.status}, ignoring cached context`,
          );
          supportContext = undefined;
        }
      } catch {
        log.warn(
          `Stale support context: matrixURL ${matrixURL} is not reachable, ignoring cached context`,
        );
        supportContext = undefined;
      }
    }
  }

  // SF tests adopt cards from `software-factory/...` modules. Always mount
  // the SF source realm alongside whichever fixture(s) the caller asked
  // for, with a card-definitions-only filter so instance data (briefs,
  // documents) doesn't leak into the template.
  let realms = [
    ...realmDirs.map((dir, i) => ({
      dir,
      // Primary realm mounts at 'test/', siblings get unique paths from dirname.
      path: i === 0 ? 'test/' : `${basename(dir)}/`,
    })),
    {
      dir: sfSourceRealmDir,
      path: 'software-factory/',
      fileFilter: cardDefinitionsOnly,
    },
  ];

  let result = await ensureCombinedFactoryRealmTemplate(realms, {
    context: supportContext,
    forceRebuild,
  });

  // preparedTemplates only advertises the user-supplied fixture realms —
  // the SF source realm is an implementation detail of the SF cache
  // shape, not a fixture any test would select as primary.
  let preparedTemplates = realmDirs.map((realmDir, i) => ({
    realmDir,
    templateDatabaseName: result.templateDatabaseName,
    templateRealmURL:
      result.realmServerURL.href +
      (i === 0 ? 'test/' : `${basename(realmDir)}/`),
    templateRealmServerURL: result.realmServerURL.href,
    cacheHit: result.cacheHit,
    cacheMissReason: result.cacheMissReason,
    coveredRealmDirs: result.coveredRealmDirs,
  }));

  let payload = {
    realmDir: realmDirs[0],
    cacheKey: result.cacheKey,
    templateDatabaseName: result.templateDatabaseName,
    fixtureHash: result.combinedFixtureHash,
    cacheHit: result.cacheHit,
    cacheMissReason: result.cacheMissReason,
    realmURL: result.realmServerURL.href + 'test/',
    realmServerURL: result.realmServerURL.href,
    preparedTemplates,
  };

  if (process.env.TEST_HARNESS_METADATA_FILE) {
    mkdirSync(dirname(process.env.TEST_HARNESS_METADATA_FILE), {
      recursive: true,
    });
    writeFileSync(
      process.env.TEST_HARNESS_METADATA_FILE,
      JSON.stringify(payload, null, 2),
    );
  }

  // Print a concise summary instead of the full JSON blob.
  let status = payload.cacheHit ? 'cache hit' : 'built';
  log.info(
    `${status}: ${payload.templateDatabaseName} (${payload.preparedTemplates.length} realm(s))`,
  );
}

main()
  .catch((error: unknown) => {
    log.error(String(error));
    process.exitCode = 1;
  })
  .finally(() => {
    // Lingering handles (fetch keep-alive sockets, pg pool idle) can prevent
    // the event loop from draining. Schedule a deferred exit so stdout/stderr
    // have time to flush before the process terminates.
    setTimeout(() => process.exit(process.exitCode ?? 0), 100).unref();
  });
