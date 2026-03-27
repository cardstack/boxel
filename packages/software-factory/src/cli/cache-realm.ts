import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

import {
  ensureCombinedFactoryRealmTemplate,
  ensureFactoryRealmTemplate,
} from '../harness';
import { isFactorySupportContext } from '../harness/shared';
import { readSupportContext } from '../runtime-metadata';

async function main(): Promise<void> {
  let args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  let realmDirs = [
    ...new Set(
      (args.length > 0 ? args : ['test-fixtures/darkfactory-adopter']).map(
        (realmDir) => resolve(process.cwd(), realmDir),
      ),
    ),
  ];
  let serializedSupportContext = process.env.SOFTWARE_FACTORY_CONTEXT;

  let parsedEnvContext = serializedSupportContext
    ? (JSON.parse(serializedSupportContext) as unknown)
    : undefined;
  let parsedMetadataContext = readSupportContext();
  let supportContext = isFactorySupportContext(parsedEnvContext)
    ? parsedEnvContext
    : isFactorySupportContext(parsedMetadataContext)
      ? parsedMetadataContext
      : undefined;

  let payload;

  let useCombined = process.argv.includes('--combined');

  if (useCombined && realmDirs.length > 1) {
    // Combined template: one DB covering all realm fixtures.
    let fixtures = realmDirs.map((realmDir, i) => ({
      realmDir,
      // Primary realm gets 'test/', additional get unique paths based on dirname.
      realmPath: i === 0 ? 'test/' : `${basename(realmDir)}/`,
    }));

    let result = await ensureCombinedFactoryRealmTemplate(fixtures, {
      context: supportContext,
    });

    payload = {
      realmDir: realmDirs[0],
      cacheKey: result.cacheKey,
      templateDatabaseName: result.templateDatabaseName,
      fixtureHash: result.combinedFixtureHash,
      cacheHit: result.cacheHit,
      cacheMissReason: result.cacheMissReason,
      realmURL: result.realmServerURL.href + 'test/',
      realmServerURL: result.realmServerURL.href,
      preparedTemplates: realmDirs.map((realmDir) => ({
        realmDir,
        templateDatabaseName: result.templateDatabaseName,
        templateRealmURL:
          result.realmServerURL.href +
          (realmDir === realmDirs[0] ? 'test/' : `${basename(realmDir)}/`),
        templateRealmServerURL: result.realmServerURL.href,
        cacheHit: result.cacheHit,
        cacheMissReason: result.cacheMissReason,
        coveredRealmDirs: result.coveredRealmDirs,
      })),
    };
  } else {
    // Single realm: backward-compatible path.
    let template = await ensureFactoryRealmTemplate({
      realmDir: realmDirs[0],
      context: supportContext,
    });

    payload = {
      realmDir: realmDirs[0],
      cacheKey: template.cacheKey,
      templateDatabaseName: template.templateDatabaseName,
      fixtureHash: template.fixtureHash,
      cacheHit: template.cacheHit,
      cacheMissReason: template.cacheMissReason,
      realmURL: template.realmURL.href,
      realmServerURL: template.realmServerURL.href,
      preparedTemplates: [
        {
          realmDir: realmDirs[0],
          templateDatabaseName: template.templateDatabaseName,
          templateRealmURL: template.realmURL.href,
          templateRealmServerURL: template.realmServerURL.href,
          cacheHit: template.cacheHit,
          cacheMissReason: template.cacheMissReason,
        },
      ],
    };
  }

  if (process.env.SOFTWARE_FACTORY_METADATA_FILE) {
    mkdirSync(dirname(process.env.SOFTWARE_FACTORY_METADATA_FILE), {
      recursive: true,
    });
    writeFileSync(
      process.env.SOFTWARE_FACTORY_METADATA_FILE,
      JSON.stringify(payload, null, 2),
    );
  }
  console.log(JSON.stringify(payload, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
