import QUnit from 'qunit';
const { module, test } = QUnit;

import { clearRealmSourceCache } from '@cardstack/runtime-common/realm-source-cache';
import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';

import { parseRealmFiles, runGlintCheck } from '../src/parse-execution.ts';

const TARGET_REALM = 'https://realms.example.test/user/target/';
const CATALOG_URL = 'https://realms.example.test/catalog/';

/**
 * What a catalog realm serves: a CardDef another realm's card can adopt, and a
 * FieldDef it can contain. Both are the shapes the reuse contract produces.
 */
const CATALOG_FILES: Record<string, string> = {
  'blog/author.gts': `import {
  CardDef,
  FieldDef,
  field,
  contains,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';

export class ContactLinkField extends FieldDef {
  static displayName = 'Contact Link';
  @field label = contains(StringField);
  @field url = contains(StringField);
}

export class Author extends CardDef {
  static displayName = 'Author';
  @field name = contains(StringField);
}
`,
};

// A catalog module whose own imports don't hold up under staging: `./bio` is
// not served (a transitive miss the walk reports as a failure), and the
// unannotated string-vs-number clash is a type error ember-tsc anchors in the
// staged copy. Together they exercise the partial-failure middle between
// "everything fetched" and "everything shimmed".
const DEGRADED_CATALOG_FILES: Record<string, string> = {
  ...CATALOG_FILES,
  'blog/profile.gts': `import { CardDef, field, contains } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import { formatBio } from './bio';

const wordCount: number = 'not a number';

export class Profile extends CardDef {
  static displayName = 'Profile';
  @field name = contains(StringField);
  bioLine() {
    return formatBio(wordCount);
  }
}
`,
};

function stubRealmFetch(
  options: { fail?: boolean; files?: Record<string, string> } = {},
) {
  let served = options.files ?? CATALOG_FILES;
  return (async (input: string | URL) => {
    if (options.fail) {
      throw new Error('ECONNREFUSED');
    }
    let url = String(input);
    let path = url.startsWith(CATALOG_URL) ? url.slice(CATALOG_URL.length) : '';
    let source = served[path];
    if (source === undefined) {
      return new Response('not found', { status: 404 });
    }
    return new Response(source, { status: 200 });
  }) as unknown as typeof globalThis.fetch;
}

// The four shapes a card can take when it reuses catalog content. The template
// is the axis that matters: `Component<typeof this>` requires `typeof BaseDef`,
// which an `any`-typed ambient shim cannot supply for a subclass's static side.
// Shape A passes under the shim, so a probe that checks only A concludes the
// shim is sufficient and stops there.
const SHAPES = {
  // A — extends a catalog card, no template
  'a-extends-no-template.gts': `import { Author } from '@cardstack/catalog/blog/author';

export class ContributorA extends Author {
  static displayName = 'Contributor A';
}
`,
  // B — extends a catalog card, WITH a template
  'b-extends-with-template.gts': `import { Component } from '@cardstack/base/card-api';
import { Author } from '@cardstack/catalog/blog/author';

export class ContributorB extends Author {
  static displayName = 'Contributor B';

  static isolated = class extends Component<typeof this> {
    <template>
      <h1>{{@model.name}}</h1>
    </template>
  };
}
`,
  // C — base CardDef containing a catalog field, with a template
  'c-contains-with-template.gts': `import {
  CardDef,
  Component,
  field,
  contains,
} from '@cardstack/base/card-api';
import { ContactLinkField } from '@cardstack/catalog/blog/author';

export class ContributorC extends CardDef {
  static displayName = 'Contributor C';
  @field contact = contains(ContactLinkField);

  static isolated = class extends Component<typeof this> {
    <template>
      <a href={{@model.contact.url}}>{{@model.contact.label}}</a>
    </template>
  };
}
`,
  // D — base CardDef containing a catalog field, no template
  'd-contains-no-template.gts': `import { CardDef, field, contains } from '@cardstack/base/card-api';
import { ContactLinkField } from '@cardstack/catalog/blog/author';

export class ContributorD extends CardDef {
  static displayName = 'Contributor D';
  @field contact = contains(ContactLinkField);
}
`,
};

function shapeFiles() {
  return Object.entries(SHAPES).map(([path, content]) => ({ path, content }));
}

module('parse gate > realm-prefixed imports', function (hooks) {
  hooks.beforeEach(function () {
    clearRealmSourceCache();
  });

  test('all four adoption shapes type-check against fetched realm sources', async function (assert) {
    assert.timeout(180_000);
    let { errors } = await runGlintCheck(shapeFiles(), {
      targetRealm: TARGET_REALM,
      fetchFn: stubRealmFetch(),
    });

    assert.deepEqual(
      errors.map((e) => `${e.file}:${e.line} ${e.message}`),
      [],
      'no shape reports an error',
    );
  });

  test('a clean run carries no warnings', async function (assert) {
    assert.timeout(180_000);
    let { warnings } = await runGlintCheck(shapeFiles(), {
      targetRealm: TARGET_REALM,
      fetchFn: stubRealmFetch(),
    });

    assert.deepEqual(warnings, [], 'nothing degraded, so nothing to warn');
  });

  // The middle between "everything fetched" and "everything shimmed": the
  // prefix is aliased at real sources, but one staged module has a transitive
  // import the walk cannot fetch and a type error of its own. Neither may fail
  // the author's run (staged code is not theirs), and neither may vanish into
  // a silent pass — ember-tsc exits non-zero here, and dropping the staged
  // diagnostics without the partitioned counter would let the setup-failure
  // fallback misread that as a clean run needing a synthetic error, or worse,
  // pass without a trace.
  test('a partially fetched prefix degrades to named warnings, not a red or silent run', async function (assert) {
    assert.timeout(180_000);
    let { errors, warnings } = await runGlintCheck(
      [
        {
          path: 'uses-profile.gts',
          content: `import { Profile } from '@cardstack/catalog/blog/profile';

export class ContributorE extends Profile {
  static displayName = 'Contributor E';
}
`,
        },
      ],
      {
        targetRealm: TARGET_REALM,
        fetchFn: stubRealmFetch({ files: DEGRADED_CATALOG_FILES }),
      },
    );

    assert.deepEqual(
      errors.map((e) => `${e.file}:${e.line} ${e.message}`),
      [],
      "staged-source problems are not the author's errors",
    );
    assert.true(
      warnings.some((w) => w.includes('@cardstack/catalog/blog/bio')),
      'the unfetchable transitive module is named',
    );
    assert.true(
      warnings.some((w) => w.includes('fetched realm sources')),
      'the dropped staged diagnostics are accounted for',
    );
  });

  // The factory reaches realms only through BoxelCLIClient — auth, token
  // refresh and retries live there. This drives the *default* glint path (no
  // injected runGlintCheckFn), which is the wiring nothing else exercises:
  // every other test hands runGlintCheck its fetch directly.
  test('the default glint path fetches realm sources through the client', async function (assert) {
    assert.timeout(180_000);
    let authedUrls: string[] = [];
    let stub = stubRealmFetch();
    let client = {
      authedFetch: async (input: string | URL, init?: RequestInit) => {
        authedUrls.push(String(input));
        return stub(input, init);
      },
      getActiveProfile: () => ({
        matrixId: '@tester:example.test',
        realmServerUrl: 'https://realms.example.test/',
      }),
    } as unknown as BoxelCLIClient;

    let output = await parseRealmFiles(
      {
        targetRealm: TARGET_REALM,
        client,
        workspaceDir: '/unused',
        readFileFn: async (_realm, path) => ({
          ok: true,
          content: SHAPES[path as keyof typeof SHAPES],
        }),
      },
      ['a-extends-no-template.gts'],
      [],
    );

    assert.true(
      authedUrls.some((url) => url.startsWith(CATALOG_URL)),
      'realm sources were fetched through client.authedFetch',
    );
    assert.deepEqual(
      output.errorViolations,
      [],
      'the authed path resolves the catalog import',
    );
  });

  // An unreachable realm must not turn correct cards red — that would trade
  // the original problem for a worse one with a network dependency. The shim
  // still carries field, component and command reuse; only card-level
  // adoption with a template is lost, which is what shape B shows.
  test('an unreachable realm degrades to the shim instead of failing the gate', async function (assert) {
    assert.timeout(180_000);
    let { errors, warnings } = await runGlintCheck(shapeFiles(), {
      targetRealm: TARGET_REALM,
      fetchFn: stubRealmFetch({ fail: true }),
    });

    assert.true(
      warnings.some((w) => w.includes("typed as 'any'")),
      'the shim degrade is named in the warnings',
    );

    let filesWithErrors = new Set(errors.map((e) => e.file));

    assert.false(
      filesWithErrors.has('a-extends-no-template.gts'),
      'shape A survives the shim',
    );
    assert.false(
      filesWithErrors.has('c-contains-with-template.gts'),
      'shape C survives the shim',
    );
    assert.false(
      filesWithErrors.has('d-contains-no-template.gts'),
      'shape D survives the shim',
    );
    assert.true(
      filesWithErrors.has('b-extends-with-template.gts'),
      'shape B is the one the shim cannot carry — this is why real types are fetched',
    );
  });
});
