/**
 * Focused tests for the evaluate-module host command and the
 * /_prerender-module endpoint to debug broken import detection.
 */
import { resolve } from 'node:path';

import { expect, test } from './fixtures';

import {
  runRealmCommand,
  writeFile,
  waitForRealmFile,
} from '../src/realm-operations';
import { buildServerToken } from '../src/harness/shared';

const fixtureRealmDir = resolve(
  process.cwd(),
  'test-fixtures',
  'test-realm-runner',
);

const VALID_MODULE = `import {
  CardDef,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

export class ValidCard extends CardDef {
  static displayName = 'Valid Card';
  @field name = contains(StringField);
}
`;

const BROKEN_IMPORT_MODULE = `import {
  CardDef,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import { Foo } from './does-not-exist';

export class BrokenImportCard extends CardDef {
  static displayName = 'Broken Import Card';
  @field brokenField = contains(Foo);
}
`;

const BROKEN_EVAL_MODULE = `import {
  CardDef,
  Component,
} from 'https://cardstack.com/base/card-api';

export class BrokenEvalCard extends CardDef {
  static displayName = 'Broken Eval Card';
  static isolated = class Isolated extends Component<typeof BrokenEvalCard> {
    <template>
      {{nonExistentHelper "strict mode failure"}}
    </template>
  };
}
`;

test.use({ realmDir: fixtureRealmDir });
test.use({ realmServerMode: 'isolated' });

test.describe('evaluate-module command', () => {
  test('/_prerender-module: valid module returns ready', async ({ realm }) => {
    let realmUrl = realm.realmURL.href;
    let realmServerUrl = realm.realmServerURL.href;
    let authorization = realm.authorizationHeaders()['Authorization'];
    let serverToken = `Bearer ${buildServerToken()}`;

    await writeFile(realmUrl, 'valid-test.gts', VALID_MODULE, {
      authorization,
    });
    await waitForRealmFile(realmUrl, 'valid-test.gts', {
      authorization,
      pollMs: 300,
      timeoutMs: 30_000,
    });

    let moduleUrl = new URL('valid-test', realmUrl).href;
    let response = await fetch(
      new URL('/_prerender-module', realmServerUrl).href,
      {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.api+json',
          'Content-Type': 'application/vnd.api+json',
          Authorization: serverToken,
        },
        body: JSON.stringify({
          data: {
            type: 'prerender-module-request',
            attributes: { realm: realmUrl, url: moduleUrl },
          },
        }),
      },
    );

    expect(response.status).toBe(201);
    let body = await response.json();
    let attrs = body?.data?.attributes;
    expect(attrs?.status).toBe('ready');
    expect(attrs?.error).toBeFalsy();
  });

  test('/_prerender-module: broken import detection', async ({ realm }) => {
    let realmUrl = realm.realmURL.href;
    let realmServerUrl = realm.realmServerURL.href;
    let authorization = realm.authorizationHeaders()['Authorization'];
    let serverToken = `Bearer ${buildServerToken()}`;

    await writeFile(realmUrl, 'broken-import-test.gts', BROKEN_IMPORT_MODULE, {
      authorization,
    });
    await waitForRealmFile(realmUrl, 'broken-import-test.gts', {
      authorization,
      pollMs: 300,
      timeoutMs: 30_000,
    });

    let moduleUrl = new URL('broken-import-test', realmUrl).href;
    let response = await fetch(
      new URL('/_prerender-module', realmServerUrl).href,
      {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.api+json',
          'Content-Type': 'application/vnd.api+json',
          Authorization: serverToken,
        },
        body: JSON.stringify({
          data: {
            type: 'prerender-module-request',
            attributes: { realm: realmUrl, url: moduleUrl },
          },
        }),
      },
    );

    expect(response.status).toBe(201);
    let body = await response.json();
    let attrs = body?.data?.attributes;

    // This is what we WANT: the prerender should detect the broken import
    // If this assertion fails, it means the prerender/Loader silently
    // swallows missing relative imports
    expect(attrs?.status).toBe('error');
  });

  test('/_prerender-module: strict-mode eval error detected', async ({
    realm,
  }) => {
    let realmUrl = realm.realmURL.href;
    let realmServerUrl = realm.realmServerURL.href;
    let authorization = realm.authorizationHeaders()['Authorization'];
    let serverToken = `Bearer ${buildServerToken()}`;

    await writeFile(realmUrl, 'broken-eval-test.gts', BROKEN_EVAL_MODULE, {
      authorization,
    });
    await waitForRealmFile(realmUrl, 'broken-eval-test.gts', {
      authorization,
      pollMs: 300,
      timeoutMs: 30_000,
    });

    let moduleUrl = new URL('broken-eval-test', realmUrl).href;
    let response = await fetch(
      new URL('/_prerender-module', realmServerUrl).href,
      {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.api+json',
          'Content-Type': 'application/vnd.api+json',
          Authorization: serverToken,
        },
        body: JSON.stringify({
          data: {
            type: 'prerender-module-request',
            attributes: { realm: realmUrl, url: moduleUrl },
          },
        }),
      },
    );

    expect(response.status).toBe(201);
    let body = await response.json();
    let attrs = body?.data?.attributes;
    expect(attrs?.status).toBe('error');
    expect(attrs?.error?.error?.message).toBeTruthy();
  });

  test('evaluate-module via _run-command: valid module passes', async ({
    realm,
  }) => {
    let realmUrl = realm.realmURL.href;
    let realmServerUrl = realm.realmServerURL.href;
    let serverToken = `Bearer ${buildServerToken()}`;

    let moduleUrl = new URL('hello', realmUrl).href; // fixture realm's hello.gts

    let response = await runRealmCommand(
      realmServerUrl,
      realmUrl,
      '@cardstack/boxel-host/commands/evaluate-module/default',
      { moduleUrl, realmUrl },
      { authorization: serverToken },
    );

    expect(response.status).toBe('ready');
    let result = JSON.parse(response.result!);
    let attrs = result?.data?.attributes ?? result;
    expect(attrs.passed).toBe(true);
  });

  test('evaluate-module via _run-command: broken import', async ({ realm }) => {
    let realmUrl = realm.realmURL.href;
    let realmServerUrl = realm.realmServerURL.href;
    let authorization = realm.authorizationHeaders()['Authorization'];
    let serverToken = `Bearer ${buildServerToken()}`;

    await writeFile(realmUrl, 'broken-cmd-test.gts', BROKEN_IMPORT_MODULE, {
      authorization,
    });
    await waitForRealmFile(realmUrl, 'broken-cmd-test.gts', {
      authorization,
      pollMs: 300,
      timeoutMs: 30_000,
    });

    let moduleUrl = new URL('broken-cmd-test', realmUrl).href;
    let response = await runRealmCommand(
      realmServerUrl,
      realmUrl,
      '@cardstack/boxel-host/commands/evaluate-module/default',
      { moduleUrl, realmUrl },
      { authorization: serverToken },
    );

    // If the prerender catches the broken import, the command should return passed=false
    if (response.status === 'ready' && response.result) {
      let result = JSON.parse(response.result);
      let attrs = result?.data?.attributes ?? result;
      expect(attrs.passed).toBe(false);
    } else {
      // Command itself errored
      expect(response.status).toBe('error');
    }
  });
});
