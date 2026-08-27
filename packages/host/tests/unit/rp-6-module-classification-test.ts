import * as ContentTag from 'content-tag';
import { init as lexerReady, parse as lexImports } from 'es-module-lexer';
import { module, test } from 'qunit';

import { PACKAGES_FAKE_ORIGIN } from '@cardstack/runtime-common/package-shim-handler';
import { transpileJS } from '@cardstack/runtime-common/transpile';

import config from '@cardstack/host/config/environment';
import {
  BoxelModuleClassifier,
  MODULE_CLASSIFICATION_REASON_KINDS,
  type BoxelModuleClassification,
  type BoxelModuleClassifierOptions,
} from '@cardstack/host/lib/boxel-module-classifier';
import {
  isTrustedImport,
  isTrustedModule,
} from '@cardstack/host/lib/trusted-modules';

const realmOrigin = 'http://test-realm/';

// Stands in for a realm serving authored module source, and for the runtime's
// import resolution. Both are counted, because "a second card re-reads nothing
// of a subtree it shares" and "a trusted import is never resolved" are claims
// about calls that did NOT happen.
class TestRealm {
  private sources = new Map<string, string>();
  loads: string[] = [];
  resolutions: string[] = [];

  constructor(sources: Record<string, string>) {
    for (let [path, source] of Object.entries(sources)) {
      this.sources.set(this.url(path), source);
    }
  }

  url(path: string): string {
    return `${realmOrigin}${path}`;
  }

  write(path: string, source: string): void {
    this.sources.set(this.url(path), source);
  }

  remove(path: string): void {
    this.sources.delete(this.url(path));
  }

  // One load is one analysis: nothing is parsed that was not just read, so a
  // load count is also the count of analyses the shared memo did not save.
  loadCount(path: string): number {
    return this.loads.filter((url) => url === this.url(path)).length;
  }

  loadSource = async (moduleIdentifier: string): Promise<string> => {
    this.loads.push(moduleIdentifier);
    let source = this.sources.get(moduleIdentifier);
    if (source === undefined) {
      throw new Error(`no such module ${moduleIdentifier}`);
    }
    return source;
  };

  resolveImport = (specifier: string, relativeTo: string): string => {
    this.resolutions.push(specifier);
    if (/^\.{0,2}\//.test(specifier) || /^https?:/.test(specifier)) {
      return new URL(specifier, relativeTo).href;
    }
    throw new Error(`cannot resolve ${specifier}`);
  };
}

function classifierFor(
  realm: TestRealm,
  options: Partial<BoxelModuleClassifierOptions> = {},
): BoxelModuleClassifier {
  return new BoxelModuleClassifier({
    loadSource: realm.loadSource,
    resolveImport: realm.resolveImport,
    ...options,
  });
}

const cardApi = 'https://cardstack.com/base/card-api';

module('Unit | rendering protocol | module classification', function () {
  module('the trusted boundary', function () {
    test('RP-6.6: Host-owned spellings are trusted and neighbouring ones are not', function (assert) {
      for (let identifier of [
        cardApi,
        'https://cardstack.com/base/',
        'https://cardstack.com/base',
        'https://cardstack.com/base/fields/nested/thing',
        `${PACKAGES_FAKE_ORIGIN}@cardstack/boxel-ui/components`,
        '@cardstack/boxel-ui/components',
        '@cardstack/runtime-common',
        '@cardstack/host/tests/helpers/setup',
        `${PACKAGES_FAKE_ORIGIN}@cardstack/host/tests/helpers/setup`,
      ]) {
        assert.true(isTrustedModule(identifier), `trusted: ${identifier}`);
      }
      for (let identifier of [
        'https://cardstack.com/base-evil/card-api',
        'https://cardstack.com.evil.example/base/card-api',
        'http://cardstack.com/base/card-api',
        'https://evil.example/base/card-api',
        `${PACKAGES_FAKE_ORIGIN}@cardstack-evil/thing`,
        '@cardstack-evil/thing',
        '@cardstack',
        '@cardstack/',
        './card-api',
        `${realmOrigin}person`,
      ]) {
        assert.false(isTrustedModule(identifier), `untrusted: ${identifier}`);
      }
    });

    test('RP-6.6: a package specifier carrying a second layer of interpretation is rejected rather than normalized', function (assert) {
      for (let identifier of [
        '@cardstack/base/../../evil/card',
        '@cardstack/base/./card',
        '@cardstack/../evil/card',
        '@cardstack/base/%2e%2e/%2e%2e/evil/card',
        '@cardstack/base/%252e%252e/evil/card',
        '@cardstack\\base\\card',
        '@cardstack/base\\..\\evil',
        '@cardstack/base?../evil',
        '@cardstack/base#/../evil',
        '@cardstack/base/%zz',
      ]) {
        assert.false(isTrustedModule(identifier), `rejected: ${identifier}`);
      }
    });

    test('RP-6.6: a realm alias under the Cardstack scope is not a Host package', function (assert) {
      // `addRealmMapping` registers `@cardstack/<realm>/` for every realm the
      // Host maps, so the scope is a namespace authored content also lives in.
      // A realm's two spellings have to agree, or one module gets two tiers
      // depending on which string the caller happens to be holding.
      for (let identifier of [
        '@cardstack/catalog/commands/listing-create',
        '@cardstack/skills/some-skill',
        '@cardstack/openrouter/some-model',
        '@cardstack/experiments-realm/person',
        '@cardstack/not-a-real-package/thing',
      ]) {
        assert.false(isTrustedModule(identifier), `authored: ${identifier}`);
        assert.false(isTrustedImport(identifier), `not pruned: ${identifier}`);
      }
      // The Base realm is trusted on its own account, so its alias agrees with
      // its URL rather than contradicting it.
      assert.true(isTrustedModule('@cardstack/base/card-api'), 'base alias');
      assert.true(
        isTrustedModule('https://cardstack.com/base/card-api'),
        'base URL',
      );
    });

    test('RP-6.7: a published realm is walked rather than pruned, by either spelling', function (assert) {
      // Pruning is sound only where trust begins, so a realm the Host
      // publishes is not a leaf: it is authored source with its own import
      // graph, and stopping there would report a complete graph while dropping
      // everything behind it. The URL spelling has to say so as loudly as the
      // alias does.
      assert.false(
        isTrustedImport('https://cardstack.com/catalog/blog-post'),
        'the Catalog realm is not a Host stand-in',
      );
      let configured = config.resolvedCatalogRealmURL;
      try {
        config.resolvedCatalogRealmURL = 'https://realms.example/catalog/';
        assert.false(
          isTrustedImport('https://realms.example/catalog/blog-post'),
          'nor is it one once this deployment resolves it',
        );
      } finally {
        config.resolvedCatalogRealmURL = configured;
      }
      assert.strictEqual(
        config.resolvedCatalogRealmURL,
        configured,
        'the environment is left as it was found',
      );
    });

    test('RP-6.6: the realm URLs this deployment resolves are classified from config', function (assert) {
      // The hardcoded literals are only half the boundary; these are the
      // inputs that vary per deployment and can be degenerate.
      assert.true(
        isTrustedModule(`${config.resolvedBaseRealmURL}card-api`),
        'the resolved Base realm is trusted',
      );
      assert.false(
        isTrustedModule(
          new URL('../experiments/person', config.resolvedBaseRealmURL).href,
        ),
        'a sibling realm on the same origin is not',
      );
      assert.true(
        isTrustedImport(`${config.iconsURL}/@cardstack/boxel-icons/v1/x.js`),
        'the icons host is Host-provided',
      );
      assert.false(
        isTrustedModule(`${config.iconsURL}/@cardstack/boxel-icons/v1/x.js`),
        'which is not a grant of Direct execution',
      );
    });

    test('RP-6.6: an origin-wide boundary is opted into, never inherited', function (assert) {
      // The icons host legitimately has no path of its own.
      assert.true(
        isTrustedImport(`${config.iconsURL}/anything/at/all`),
        'the icons host covers its origin',
      );
      let iconsOrigin = new URL(config.iconsURL).origin;
      assert.false(
        isTrustedModule(`${iconsOrigin}/anything/at/all`),
        'which is not a rule realm boundaries share',
      );

      // A realm boundary is read from deployment config, and pointing one at
      // an origin root is the one misconfiguration here that would fail OPEN —
      // every realm on that host trusted, silently. Driven directly, because
      // no boundary this environment configures has a root path.
      let configured = config.resolvedBaseRealmURL;
      try {
        config.resolvedBaseRealmURL = `${iconsOrigin}/`;
        assert.false(
          isTrustedModule(`${iconsOrigin}/someone-elses-realm/card`),
          'a realm boundary at an origin root is refused, not honoured',
        );
      } finally {
        config.resolvedBaseRealmURL = configured;
      }
      assert.strictEqual(
        config.resolvedBaseRealmURL,
        configured,
        'the environment is left as it was found',
      );
    });

    test('RP-6.6: being importable as a Host stand-in is not trusted provenance', function (assert) {
      for (let identifier of ['@glimmer/component', '@ember/modifier']) {
        assert.true(
          isTrustedImport(identifier),
          `Host-provided: ${identifier}`,
        );
        assert.false(
          isTrustedModule(identifier),
          `not Direct provenance: ${identifier}`,
        );
      }
      // The narrower predicate is contained in the wider one, so the walk can
      // prune on the wider one alone.
      for (let identifier of [cardApi, '@cardstack/boxel-ui/components']) {
        assert.true(isTrustedImport(identifier), `contained: ${identifier}`);
      }
      assert.false(isTrustedImport(`${realmOrigin}person`), 'authored module');
    });
  });

  module('the module graph', function () {
    test('RP-6.7: the entry is reported first and its reachable graph sorted after it', async function (assert) {
      let realm = new TestRealm({
        person: `import Address from './address';\nimport Pet from './pet';\nexport class Person {}\n`,
        address: `import Zip from './zip';\nexport class Address {}\n`,
        pet: `import Zip from './zip';\nexport class Pet {}\n`,
        zip: `export class Zip {}\n`,
      });
      let result = await classifierFor(realm).classifyModule(
        realm.url('person'),
      );

      assert.false(result.trusted, 'authored');
      assert.true(result.moduleGraphComplete, 'graph established');
      assert.strictEqual(result.reason, 'authored-module');
      assert.deepEqual(result.moduleGraph, [
        realm.url('person'),
        realm.url('address'),
        realm.url('pet'),
        realm.url('zip'),
      ]);
      assert.strictEqual(realm.loadCount('zip'), 1, 'the diamond read once');
    });

    test('RP-6.7: a cycle entered from either end yields the same graph', async function (assert) {
      let realm = new TestRealm({
        a: `import B from './b';\nexport class A {}\n`,
        b: `import C from './c';\nexport class B {}\n`,
        c: `import A from './a';\nexport class C {}\n`,
      });
      let fromA = await classifierFor(realm).classifyModule(realm.url('a'));
      let fromB = await classifierFor(realm).classifyModule(realm.url('b'));

      assert.deepEqual(fromA.moduleGraph, [
        realm.url('a'),
        realm.url('b'),
        realm.url('c'),
      ]);
      assert.deepEqual(fromB.moduleGraph, [
        realm.url('b'),
        realm.url('a'),
        realm.url('c'),
      ]);
      assert.true(fromA.moduleGraphComplete, 'established from a');
      assert.true(fromB.moduleGraphComplete, 'established from b');
      assert.deepEqual(
        [...fromA.moduleGraph].sort(),
        [...fromB.moduleGraph].sort(),
        'the same set either way',
      );
    });

    test('RP-6.7: a trusted import is an edge that is neither resolved nor read', async function (assert) {
      let realm = new TestRealm({
        person: [
          `import { CardDef, field, contains } from '${cardApi}';`,
          `import StringField from 'https://cardstack.com/base/string';`,
          `import GlimmerComponent from '@glimmer/component';`,
          `import { Button } from '@cardstack/boxel-ui/components';`,
          `export class Person extends CardDef {`,
          `  @field name = contains(StringField);`,
          `}`,
        ].join('\n'),
      });
      let result = await classifierFor(realm).classifyModule(
        realm.url('person'),
      );

      assert.deepEqual(result.moduleGraph, [
        realm.url('person'),
        '@cardstack/boxel-ui/components',
        '@glimmer/component',
        cardApi,
        'https://cardstack.com/base/string',
      ]);
      assert.true(result.moduleGraphComplete, 'nothing failed');
      assert.deepEqual(realm.loads, [realm.url('person')], 'only the entry');
      assert.deepEqual(realm.resolutions, [], 'nothing resolved');
    });

    test('RP-6.7: a module the runtime shims is an edge the walk stops at', async function (assert) {
      let realm = new TestRealm({
        person: `import { format } from 'date-fns';\nexport class Person {}\n`,
      });
      let shimmed = new Set(['date-fns']);
      let result = await classifierFor(realm, {
        isHostProvidedModule: (identifier) => shimmed.has(identifier),
      }).classifyModule(realm.url('person'));

      assert.deepEqual(result.moduleGraph, [realm.url('person'), 'date-fns']);
      assert.true(result.moduleGraphComplete, 'a shim is not a failure');
      assert.deepEqual(realm.loads, [realm.url('person')], 'only the entry');
    });

    test('RP-6.7: an unresolvable import marks the graph unavailable and names every specifier deterministically', async function (assert) {
      let realm = new TestRealm({
        person: `import z from 'zebra';\nimport a from 'aardvark';\nexport class Person {}\n`,
      });
      let reversed = new TestRealm({
        person: `import a from 'aardvark';\nimport z from 'zebra';\nexport class Person {}\n`,
      });
      let result = await classifierFor(realm).classifyModule(
        realm.url('person'),
      );
      let sameGraphOtherOrder = await classifierFor(reversed).classifyModule(
        reversed.url('person'),
      );

      assert.false(result.moduleGraphComplete, 'fails closed');
      assert.strictEqual(result.reason, 'module-resolve:aardvark');
      assert.strictEqual(
        sameGraphOtherOrder.reason,
        result.reason,
        'the reported specifier does not depend on source order',
      );
    });

    test('RP-6.7: a dependency that cannot be read marks the graph unavailable', async function (assert) {
      let realm = new TestRealm({
        person: `import Address from './address';\nexport class Person {}\n`,
      });
      let result = await classifierFor(realm).classifyModule(
        realm.url('person'),
      );

      assert.false(result.moduleGraphComplete);
      assert.strictEqual(result.reason, `module-load:${realm.url('address')}`);
      assert.deepEqual(
        result.moduleGraph,
        [realm.url('person'), realm.url('address')],
        'the edge is reported, but as a diagnostic rather than an authorization',
      );
    });

    test('RP-6.7: a dependency that does not parse is named rather than treated as a draft', async function (assert) {
      let realm = new TestRealm({
        person: `import Address from './address';\nexport class Person {}\n`,
        address: `export class Address { <template>`,
      });
      let result = await classifierFor(realm).classifyModule(
        realm.url('person'),
      );

      assert.false(result.moduleGraphComplete);
      assert.strictEqual(result.reason, `module-parse:${realm.url('address')}`);
    });

    test('RP-6.7: an entry that does not parse is a pending draft with an empty graph, not a throw', async function (assert) {
      let realm = new TestRealm({});
      let result = await classifierFor(realm).classifyModule(
        realm.url('person'),
        `export class Person { <template>`,
      );

      assert.strictEqual(result.reason, 'source-parse-pending');
      assert.false(result.moduleGraphComplete, 'nothing may be authorized');
      assert.deepEqual(result.moduleGraph, [realm.url('person')]);
      assert.false(result.authoredEditTemplate, 'nothing was established');
    });

    test('RP-6.7: an entry that cannot be read is reported as unreadable rather than as a draft', async function (assert) {
      let realm = new TestRealm({});
      let result = await classifierFor(realm).classifyModule(
        realm.url('person'),
      );

      assert.strictEqual(result.reason, `module-load:${realm.url('person')}`);
      assert.false(result.moduleGraphComplete);
    });

    test('RP-6.7: the bound is met exactly, and exceeding it outranks the failures of a walk that stopped early', async function (assert) {
      // The absent module sorts ahead of `b`, so the walk reaches it — and
      // records its failure — before it runs out of room. Both narrower runs
      // below therefore have a failure in hand when the bound is hit, which is
      // what makes the precedence between them observable.
      let realm = new TestRealm({
        a: `import Absent from './absent';\nimport B from './b';\nexport class A {}\n`,
        b: `import C from './c';\nexport class B {}\n`,
        c: `export class C {}\n`,
      });
      let met = await classifierFor(realm, { maxModules: 4 }).classifyModule(
        realm.url('a'),
      );
      assert.strictEqual(
        met.reason,
        `module-load:${realm.url('absent')}`,
        'all four reads fit, so the unreadable one is the news',
      );

      let exceeded = await classifierFor(realm, {
        maxModules: 2,
      }).classifyModule(realm.url('a'));
      assert.strictEqual(
        exceeded.reason,
        'module-graph-limit',
        'a walk that stopped early reports that, not what it happened to reach first',
      );
      assert.false(exceeded.moduleGraphComplete);
    });

    test('RP-6.7: the bound counts reads, so unreadable imports cannot outrun it', async function (assert) {
      let imports = Array.from(
        { length: 40 },
        (_, index) => `import M${index} from './missing-${index}';`,
      ).join('\n');
      let realm = new TestRealm({ person: `${imports}\nexport class P {}\n` });
      let result = await classifierFor(realm, { maxModules: 5 }).classifyModule(
        realm.url('person'),
      );

      assert.strictEqual(result.reason, 'module-graph-limit');
      assert.false(result.moduleGraphComplete);
      // A module that fails to load yields no analysis, so a bound counted
      // over successful analyses would never advance and every one of the 40
      // would be fetched.
      assert.strictEqual(realm.loads.length, 5, 'reads stopped at the bound');
    });

    test('RP-6.7: one failing dependency is read once however many importers reach it', async function (assert) {
      let realm = new TestRealm({
        person: `import A from './a';\nimport B from './b';\nexport class P {}\n`,
        a: `import Gone from './gone';\nexport class A {}\n`,
        b: `import Gone from './gone';\nexport class B {}\n`,
      });
      let result = await classifierFor(realm).classifyModule(
        realm.url('person'),
      );

      assert.strictEqual(result.reason, `module-load:${realm.url('gone')}`);
      // A failed analysis self-evicts from the shared memo, so without a
      // per-walk record of what was attempted the second importer re-reads it.
      assert.strictEqual(realm.loadCount('gone'), 1, 'read once');
    });

    test('RP-6.7: a resolver that answers with something other than an identifier fails closed', async function (assert) {
      let realm = new TestRealm({
        person: `import A from './a';\nexport class P {}\n`,
      });
      let result = await classifierFor(realm, {
        resolveImport: () => undefined as unknown as string,
      }).classifyModule(realm.url('person'));

      assert.strictEqual(result.reason, 'module-resolve:./a');
      assert.false(result.moduleGraphComplete, 'rather than escaping');
    });

    test('RP-6.7: the reported graph cannot be mutated by one of its holders', async function (assert) {
      let realm = new TestRealm({ person: `export class P {}\n` });
      let classifier = classifierFor(realm);
      let result = await classifier.classifyModule(realm.url('person'));

      assert.throws(
        () => (result.moduleGraph as string[]).push('http://evil/'),
        'a memoized authorization list is shared, so it is frozen',
      );
      let again = await classifier.classifyModule(realm.url('person'));
      assert.deepEqual(again.moduleGraph, [realm.url('person')]);
    });

    test('RP-6.7: a literal dynamic import is an edge and a computed one is absent', async function (assert) {
      let realm = new TestRealm({
        person: [
          `export class Person {`,
          `  async chart() { return import('./chart'); }`,
          `  async other(name) { return import(name); }`,
          `}`,
        ].join('\n'),
        chart: `export class Chart {}\n`,
      });
      let result = await classifierFor(realm).classifyModule(
        realm.url('person'),
      );

      assert.deepEqual(result.moduleGraph, [
        realm.url('person'),
        realm.url('chart'),
      ]);
      assert.true(
        result.moduleGraphComplete,
        'a computed specifier is not a failure to establish the graph',
      );
    });

    test('RP-6.7: the import preprocessing adds to compile a template is not an edge', async function (assert) {
      let realm = new TestRealm({
        person: `export class Person {\n  static isolated = <template><h1>hi</h1></template>;\n}\n`,
      });
      let result = await classifierFor(realm).classifyModule(
        realm.url('person'),
      );

      assert.deepEqual(
        result.moduleGraph,
        [realm.url('person')],
        'a templated card with no imports has a graph of one',
      );
      assert.strictEqual(
        result.reason,
        'authored-module',
        'nor does the injected specifier reach resolution',
      );
      assert.true(result.moduleGraphComplete, 'so the graph is established');
      // Pins what is being filtered: preprocessing still injects exactly this
      // specifier, so a rename upstream fails here rather than quietly adding
      // a module to every templated card's authorization list.
      await lexerReady;
      let compiled = new ContentTag.Preprocessor().process(
        `<template>hi</template>`,
        { filename: 'probe.gts' },
      ).code;
      assert.deepEqual(
        lexImports(compiled)[0].map((entry) => entry.n),
        ['@ember/template-compiler'],
      );
    });

    test('RP-6.7: a trusted entry is answered from its identifier without a read', async function (assert) {
      let realm = new TestRealm({});
      let result = await classifierFor(realm).classifyModule(cardApi);

      assert.true(result.trusted);
      assert.strictEqual(result.reason, 'trusted-module');
      assert.deepEqual(result.moduleGraph, [cardApi]);
      assert.true(result.moduleGraphComplete);
      assert.deepEqual(realm.loads, [], 'no source was read');
    });

    test('RP-6.7: every declared reason kind is reachable', async function (assert) {
      let realm = new TestRealm({
        settled: `export class Settled {}\n`,
        unresolvable: `import x from 'nope';\nexport class X {}\n`,
        missingDependency: `import x from './gone';\nexport class X {}\n`,
        brokenDependency: `import x from './broken';\nexport class X {}\n`,
        broken: `export class Broken { <template>`,
        deep: `import x from './settled';\nexport class Deep {}\n`,
      });
      let classifier = classifierFor(realm);
      let produced = new Set<string>();
      let observe = ({ reason }: { reason: string }) =>
        produced.add(reason.split(':')[0]!);

      observe(await classifier.classifyModule(cardApi));
      observe(await classifier.classifyModule(realm.url('settled')));
      observe(
        await classifier.classifyModule(
          realm.url('draft'),
          `class Draft { <template>`,
        ),
      );
      observe(await classifier.classifyModule(realm.url('unresolvable')));
      observe(await classifier.classifyModule(realm.url('missingDependency')));
      observe(await classifier.classifyModule(realm.url('brokenDependency')));
      observe(
        await classifierFor(realm, { maxModules: 1 }).classifyModule(
          realm.url('deep'),
        ),
      );

      assert.deepEqual(
        [...produced].sort(),
        [...MODULE_CLASSIFICATION_REASON_KINDS].sort(),
        'the declared vocabulary is exactly what classification can produce',
      );
    });
  });

  module('caching', function () {
    test('RP-6.7: a second entry reads none of the subtree it shares with the first', async function (assert) {
      let realm = new TestRealm({
        person: `import Address from './address';\nexport class Person {}\n`,
        employee: `import Address from './address';\nexport class Employee {}\n`,
        address: `import Zip from './zip';\nexport class Address {}\n`,
        zip: `export class Zip {}\n`,
      });
      let classifier = classifierFor(realm);
      await classifier.classifyModule(realm.url('person'));
      realm.loads.length = 0;
      let second = await classifier.classifyModule(realm.url('employee'));

      assert.deepEqual(
        realm.loads,
        [realm.url('employee')],
        'only the second entry itself was read',
      );
      assert.deepEqual(second.moduleGraph, [
        realm.url('employee'),
        realm.url('address'),
        realm.url('zip'),
      ]);
    });

    test('RP-6.7: invalidating a dependency evicts every entry whose graph reached it', async function (assert) {
      let realm = new TestRealm({
        person: `import Address from './address';\nexport class Person {}\n`,
        address: `export class Address {}\n`,
      });
      let classifier = classifierFor(realm);
      await classifier.classifyModule(realm.url('person'));

      realm.write('address', `import Zip from './zip';\nexport class A {}\n`);
      realm.write('zip', `export class Zip {}\n`);
      classifier.invalidate(realm.url('address'));
      realm.loads.length = 0;
      let again = await classifier.classifyModule(realm.url('person'));

      assert.deepEqual(again.moduleGraph, [
        realm.url('person'),
        realm.url('address'),
        realm.url('zip'),
      ]);
      // The graph grew, so the importer's entry was re-walked rather than
      // answered from its stale one — while the importer's own source, which
      // did not change, was not re-read: eviction is scoped to what was
      // invalidated, and the shared memo still holds the rest of the walk.
      assert.strictEqual(realm.loadCount('address'), 1, 'the changed module');
      assert.strictEqual(
        realm.loadCount('person'),
        0,
        'the unchanged importer',
      );
    });

    test('RP-6.7: a result that could not establish the graph is retried rather than remembered', async function (assert) {
      let realm = new TestRealm({
        person: `import Address from './address';\nexport class Person {}\n`,
      });
      let classifier = classifierFor(realm);
      let failed = await classifier.classifyModule(realm.url('person'));
      assert.false(failed.moduleGraphComplete);

      realm.write('address', `export class Address {}\n`);
      let recovered = await classifier.classifyModule(realm.url('person'));

      assert.true(
        recovered.moduleGraphComplete,
        'no invalidate call was needed',
      );
      assert.strictEqual(recovered.reason, 'authored-module');
    });

    test('RP-6.7: a draft answers only its own caller and never seats itself in the shared memo', async function (assert) {
      let realm = new TestRealm({
        person: `import Address from './address';\nexport class Person {}\n`,
        employee: `import Person from './person';\nexport class Employee {}\n`,
        address: `export class Address {}\n`,
        secret: `export class Secret {}\n`,
      });
      let classifier = classifierFor(realm);
      let draft = await classifier.classifyModule(
        realm.url('person'),
        `import Secret from './secret';\nexport class Person {}\n`,
      );
      assert.deepEqual(
        draft.moduleGraph,
        [realm.url('person'), realm.url('secret')],
        "the draft's own imports",
      );

      let importer = await classifier.classifyModule(realm.url('employee'));
      assert.deepEqual(
        importer.moduleGraph,
        [realm.url('employee'), realm.url('address'), realm.url('person')],
        'another card sees the module the realm serves, not the buffer someone is typing in',
      );
    });

    test('RP-6.7: an unchanged draft is answered from the entry memo and a changed one replaces it', async function (assert) {
      let realm = new TestRealm({ address: `export class Address {}\n` });
      let classifier = classifierFor(realm);
      let draft = `import Address from './address';\nexport class Person {}\n`;

      let first = await classifier.classifyModule(realm.url('person'), draft);
      let loadsAfterFirst = realm.loads.length;
      let second = await classifier.classifyModule(realm.url('person'), draft);
      assert.strictEqual(
        realm.loads.length,
        loadsAfterFirst,
        'the same draft re-read nothing',
      );
      // Identity, not read counts: the draft's own source is supplied either
      // way and its dependency is in the shared memo, so a read count alone
      // holds even with no entry memo at all.
      assert.strictEqual(second, first, 'answered from the entry memo');

      let changed = await classifier.classifyModule(
        realm.url('person'),
        `export class Person {}\n`,
      );
      assert.deepEqual(
        changed.moduleGraph,
        [realm.url('person')],
        'the changed draft replaced the memoized answer',
      );
    });
  });

  module('the authored edit surface', function () {
    async function editTemplateFor(source: string): Promise<boolean> {
      let realm = new TestRealm({ person: source });
      let result = await classifierFor(realm).classifyModule(
        realm.url('person'),
      );
      return result.authoredEditTemplate;
    }

    test('RP-6.8: a module declaring an authored edit template says so', async function (assert) {
      assert.true(
        await editTemplateFor(
          `export class Person {\n  static edit = <template><input /></template>;\n}\n`,
        ),
        'an inline editor on the card class',
      );
      assert.true(
        await editTemplateFor(
          `import Editor from '@glimmer/component';\nexport class Person {\n  static edit = Editor;\n}\n`,
        ),
        'an imported editor is authored code on the edit surface too',
      );
      assert.true(
        await editTemplateFor(
          [
            `import { Component, type BaseDefComponent } from '${cardApi}';`,
            `class Edit extends Component<any> {`,
            `  static template = <template><input /></template>;`,
            `}`,
            `export class Person {`,
            `  static edit: BaseDefComponent = Edit;`,
            `}`,
          ].join('\n'),
        ),
        'the annotated form the Base realm itself writes',
      );
      // Every modifier TypeScript allows between `static` and the name, plus
      // the key spellings that still name one declaration.
      for (let declaration of [
        'static readonly edit = Edit;',
        'static override edit = Edit;',
        'static readonly override edit: BaseDefComponent = Edit;',
        'declare static edit: BaseDefComponent;',
        'static ["edit"] = Edit;',
        "static ['edit'] = Edit;",
        'static get edit() { return Edit; }',
      ]) {
        assert.true(
          await editTemplateFor(
            `class Edit {}\nexport class Person {\n  ${declaration}\n}\n`,
          ),
          declaration,
        );
      }
      assert.true(
        await editTemplateFor(
          [
            `export class Person {`,
            `  static isolated = <template><h1>hi</h1></template>;`,
            `}`,
            `export class Rating {`,
            `  static edit = <template><input type='range' /></template>;`,
            `}`,
          ].join('\n'),
        ),
        "a field's authored editor counts as much as the card's",
      );
    });

    test('RP-6.8: a module with no authored edit template says so', async function (assert) {
      assert.false(
        await editTemplateFor(
          `export class Person {\n  static isolated = <template><h1>hi</h1></template>;\n}\n`,
        ),
        'other formats are not the edit surface',
      );
      assert.false(
        await editTemplateFor(
          `export class Person {\n  static editable = true;\n  edit = 1;\n}\n`,
        ),
        'a longer name and a non-static field are neither',
      );
      assert.false(
        await editTemplateFor(`export class Person {}\n`),
        'nothing declared',
      );
      assert.false(
        await editTemplateFor(
          `export class Person {\n  static edited = 1;\n  static [key] = 2;\n}\n`,
        ),
        'a longer name, and a computed key no reading of the source resolves',
      );
    });
  });

  module("the realm's front end", function () {
    // The realm's pipeline is content-tag's `process()` followed by Babel; the
    // classifier's front end is content-tag's `process()` followed by
    // `es-module-lexer`. The shared first half is what makes the second half's
    // job tractable, and the fixtures below are what holds the two halves in
    // agreement.
    //
    // The forbidden combination is one-sided: source the realm SERVES that the
    // classifier cannot read. A render never reaches source the realm refuses,
    // so the classifier's answer for it costs nothing; the reverse is a card
    // whose sandbox child is handed an empty module graph — its entire fetch
    // authority — and refuses to load the modules the render needs, on code
    // that renders normally without classification.
    //
    // Fixture dependencies exist only to be reachable: what the graph assertion
    // is about is which edges the front end extracts, not what is behind them.
    const frontEndFixtureSources = {
      'dep.gts': `export const tag = 'dep';\nexport class Shape {}\nexport default tag;\n`,
      'shape.gts': `export class Shape {}\n`,
      'd.json': `export default { name: 'd' };\n`,
    };
    const entryPath = 'entry.gts';

    /**
     * One shape of source, run through both halves of the realm's pipeline.
     *
     * `imports` is the WHOLE import list the classifier must extract, because a
     * front end that parses the source and drops one edge fails the same way a
     * refusal does, with a quieter symptom: the graph it reports is short by a
     * module the render will ask for and be refused.
     *
     * `draft` marks a shape the front end refuses outright, which is the right
     * answer for source that is genuinely half-written.
     */
    interface FrontEndFixture {
      shape: string;
      source: string;
      imports: string[];
      draft?: true;
    }

    async function classifyFixture(fixture: FrontEndFixture): Promise<{
      result: BoxelModuleClassification;
      expectedGraph: string[];
    }> {
      let realm = new TestRealm(frontEndFixtureSources);
      let entry = realm.url(entryPath);
      let result = await classifierFor(realm).classifyModule(
        entry,
        fixture.source,
      );
      let expectedGraph = fixture.draft
        ? [entry]
        : [
            entry,
            ...fixture.imports
              .map((specifier) => new URL(specifier, entry).href)
              .sort(),
          ];
      return { result, expectedGraph };
    }

    test('RP-6.7: the realm and the classifier agree on which source is servable', async function (assert) {
      // Each fixture goes through the realm's own `transpileJS` and through
      // classification, and the two have to agree that servable source is
      // readable. Asserting the AGREEMENT rather than the syntax is what keeps
      // this honest as the pipeline moves: a shape the realm stops serving
      // switches to the negative branch by itself, and one it starts serving
      // becomes a demand on the classifier without anyone editing a list.
      let served = 0;
      let refused = 0;
      for (let fixture of [
        {
          shape: 'a type-only import and an annotated field',
          source: [
            `import type { Shape } from './shape.gts';`,
            `import { tag } from './dep.gts';`,
            `export class C { s?: Shape; t = tag; }`,
          ].join('\n'),
          // A type-erased specifier is still a specifier the author wrote, and
          // the front end has no TypeScript parse to tell it apart from a value
          // import — so both edges are here. The two tests below pin that
          // reading form by form, and name what it costs.
          imports: ['./shape.gts', './dep.gts'],
        },
        {
          shape: 'a declare field',
          source: `import { tag } from './dep.gts';\nexport class C { declare id: string; t = tag; }`,
          imports: ['./dep.gts'],
        },
        {
          shape: 'a legacy decorator on a class',
          source: `import { tag } from './dep.gts';\nconst dec = (t: unknown) => t;\n@dec\nexport class C { t = tag; }`,
          imports: ['./dep.gts'],
        },
        {
          shape: 'a legacy decorator on a field',
          source: `import { tag } from './dep.gts';\nconst field = (..._a: unknown[]) => {};\nexport class C { @field y = tag; }`,
          imports: ['./dep.gts'],
        },
        {
          shape: 'a legacy decorator on a method',
          source: `import { tag } from './dep.gts';\nconst action = (..._a: unknown[]) => {};\nexport class C { @action run() { return tag; } }`,
          imports: ['./dep.gts'],
        },
        {
          shape: 'a decorator ahead of export',
          source: `import { tag } from './dep.gts';\nconst dec = (t: unknown) => t;\nexport @dec class A { x = tag; }`,
          imports: ['./dep.gts'],
        },
        {
          // Statement position: content-tag rewrites the block into a call, so
          // what the lexer reads is ordinary JavaScript.
          shape: 'a template as a class member',
          source: `import { tag } from './dep.gts';\nexport class C { static isolated = class { <template>hi</template> }; t = tag; }`,
          imports: ['./dep.gts'],
        },
        {
          // Expression position, which is the case a front end that BLANKED
          // template blocks instead of rewriting them would break: blanking
          // leaves a hole an expression has to fill, and a finished, servable
          // module reads as unparseable.
          shape: 'a template in expression position',
          source: `import { tag } from './dep.gts';\nconst Row = <template>hi</template>;\nexport const t = [Row, tag];`,
          imports: ['./dep.gts'],
        },
        {
          shape: 'a constrained type parameter',
          source: `import { tag } from './dep.gts';\nexport function f<T extends object>(v: T): T { void [v, tag]; return v; }`,
          imports: ['./dep.gts'],
        },
        {
          shape: 'a parameter property',
          source: `import { tag } from './dep.gts';\nexport class C { constructor(private x: string) { void [x, tag]; } }`,
          imports: ['./dep.gts'],
        },
        {
          shape: 'an enum',
          source: `import { tag } from './dep.gts';\nexport enum E { A }\nexport const t = [E.A, tag];`,
          imports: ['./dep.gts'],
        },
        {
          shape: 'an abstract member',
          source: `import { tag } from './dep.gts';\nexport abstract class C { abstract go(): void; t = tag; }`,
          imports: ['./dep.gts'],
        },
        {
          shape: 'a namespace',
          source: `import { tag } from './dep.gts';\nexport namespace N { export const x = 1; }\nexport const t = [N.x, tag];`,
          imports: ['./dep.gts'],
        },
        {
          shape: 'a satisfies expression',
          source: `import { tag } from './dep.gts';\nexport const t = tag satisfies string;`,
          imports: ['./dep.gts'],
        },
        {
          shape: 'an import attribute clause',
          source: `import d from './d.json' with { type: 'json' };\nimport { tag } from './dep.gts';\nexport const t = [d, tag];`,
          imports: ['./d.json', './dep.gts'],
        },
        {
          shape: 'a using declaration',
          source: `import { tag } from './dep.gts';\nusing r = { [Symbol.dispose]() {} };\nexport const t = [r, tag];`,
          imports: ['./dep.gts'],
        },
        {
          shape: 'an await using declaration',
          source: `import { tag } from './dep.gts';\nexport async function f() { await using r = {}; return [r, tag]; }`,
          imports: ['./dep.gts'],
        },
        {
          // The realm refuses this one: `accessor` needs a decorator proposal
          // the realm's `decorator-transforms` does not enable. The front end
          // reads it anyway, and that asymmetry is allowed — a render never
          // reaches source the realm will not serve, so the classifier's answer
          // for it is moot in either direction.
          shape: 'an accessor field',
          source: `import { tag } from './dep.gts';\nexport class C { accessor x = tag; }`,
          imports: ['./dep.gts'],
        },
        {
          // The realm refuses this one too, and here both halves refuse it for
          // the same reason: content-tag rejects JSX ahead of anything else, so
          // the shared first half of the pipeline is what says no. This is the
          // shape that keeps the draft branch exercised.
          shape: 'a JSX element',
          source: `import { tag } from './dep.gts';\nexport const t = <div>{tag}</div>;`,
          imports: [],
          draft: true,
        },
      ] satisfies FrontEndFixture[]) {
        let servable = true;
        try {
          await transpileJS(fixture.source, `/${entryPath}`);
        } catch {
          servable = false;
        }
        if (servable) {
          served++;
        } else {
          refused++;
        }

        let { result, expectedGraph } = await classifyFixture(fixture);
        assert.deepEqual(
          [...result.moduleGraph],
          expectedGraph,
          `${fixture.shape} — the complete graph, not merely a parse that succeeded`,
        );
        assert.strictEqual(
          result.moduleGraphComplete,
          !fixture.draft,
          `${fixture.shape} — the graph is ${fixture.draft ? 'unavailable' : 'established'}`,
        );
        assert.strictEqual(
          result.reason,
          fixture.draft ? 'source-parse-pending' : 'authored-module',
          `${fixture.shape} — the reason it reports`,
        );
        // The one combination the agreement forbids, computed from the realm
        // rather than declared: source the realm hands out whose graph
        // classification cannot establish. The other three are all fine.
        let holeInTheMirror = servable && !result.moduleGraphComplete;
        assert.false(
          holeInTheMirror,
          `${fixture.shape} — the realm ${servable ? 'transpiles' : 'refuses'} it and the classifier reports ${result.reason}`,
        );
      }
      // Each row rules out one combination, and a row the realm refuses does so
      // without demanding anything of the classifier. So the table has to keep
      // exercising both branches: an all-refused table would pass while
      // checking nothing, and an all-served one would drop the negative case
      // the agreement is allowed to miss.
      assert.true(
        served > 0,
        `some fixture is servable (${served} of ${served + refused})`,
      );
      assert.true(
        refused > 0,
        `some fixture is not, so the negative case is still exercised (${refused} of ${served + refused})`,
      );
    });

    test('RP-6.7: the lexer reads each TypeScript import form one way', async function (assert) {
      // `es-module-lexer` is deliberately tolerant — it finds import statements
      // without parsing the language around them — and it is not a TypeScript
      // parser. So the forms TypeScript erases are read exactly as the forms it
      // keeps, with one exception the lexer's own grammar makes: a re-export
      // marked `type` carries the keyword where the lexer looks for the export
      // clause, and drops out.
      //
      // The asymmetry is pinned here rather than reasoned about at each call
      // site, because the direction of an error decides what it costs. An edge
      // the runtime never fetches only widens a read authority to a module the
      // author's own source names — the render asks for nothing extra. A
      // MISSING edge refuses a fetch the render makes.
      for (let { shape, source, imports } of [
        {
          shape: 'a type-only named import',
          source: `import type { Shape } from './shape.gts';\nexport const t = 1;`,
          imports: ['./shape.gts'],
        },
        {
          shape: 'a type-only default import',
          source: `import type Shape from './shape.gts';\nexport const t = 1;`,
          imports: ['./shape.gts'],
        },
        {
          shape: 'an inline type specifier beside a value one',
          source: `import { type Shape, tag } from './dep.gts';\nexport const t: Shape | string = tag;`,
          imports: ['./dep.gts'],
        },
        {
          shape: 'a default import beside an inline type specifier',
          source: `import d, { type Shape } from './dep.gts';\nexport const t: Shape | string = d;`,
          imports: ['./dep.gts'],
        },
        {
          shape: 'a type-only namespace import',
          source: `import type * as T from './shape.gts';\nexport class C { s?: T.Shape; }`,
          imports: ['./shape.gts'],
        },
        {
          // `type` is an ordinary identifier, so this is a DEFAULT BINDING
          // named `type` and the module is a real runtime edge. It is here
          // because it is what a front end that recognized type-only imports by
          // matching the keyword would get wrong, in the expensive direction:
          // dropping an edge the render will ask for.
          shape: 'a default binding named `type`',
          source: `import type from './dep.gts';\nexport const x = type;`,
          imports: ['./dep.gts'],
        },
        {
          shape: 'a default binding named `type` beside a named one',
          source: `import type, { tag } from './dep.gts';\nexport const x = [type, tag];`,
          imports: ['./dep.gts'],
        },
        {
          shape: 'a re-export',
          source: `export { tag } from './dep.gts';`,
          imports: ['./dep.gts'],
        },
        {
          shape: 'a type-only re-export',
          source: `export type { Shape } from './shape.gts';\nexport const t = 1;`,
          imports: [],
        },
        {
          // The `type` modifier INSIDE the clause reads differently from the
          // one ahead of it: the lexer is looking for the export clause where
          // the clause-level keyword sits, and finds it here.
          shape: 'an inline type specifier in a re-export',
          source: `export { type Shape } from './shape.gts';\nexport const t = 1;`,
          imports: ['./shape.gts'],
        },
        {
          shape: 'a star re-export',
          source: `export * from './dep.gts';`,
          imports: ['./dep.gts'],
        },
        {
          shape: 'a namespaced star re-export',
          source: `export * as dep from './dep.gts';`,
          imports: ['./dep.gts'],
        },
      ]) {
        let realm = new TestRealm(frontEndFixtureSources);
        let entry = realm.url(entryPath);
        let result = await classifierFor(realm).classifyModule(entry, source);

        assert.deepEqual(
          [...result.moduleGraph],
          [
            entry,
            ...imports
              .map((specifier) => new URL(specifier, entry).href)
              .sort(),
          ],
          `${shape} — the extracted edges`,
        );
        assert.true(
          result.moduleGraphComplete,
          `${shape} — the graph is established`,
        );
      }
    });

    test('RP-6.7: a type-only import of a specifier nothing serves fails the graph closed', async function (assert) {
      // What reading a type-erased import as an edge costs, stated as the
      // failure it produces rather than left as an inference. The walk resolves
      // the specifier like any other, and a specifier no runtime answers for
      // marks the graph unavailable — which fails closed, on a module the realm
      // transpiles without complaint because TypeScript erased the import.
      //
      // What keeps this narrow is that the specifiers a card can name are the
      // ones its authoring environment resolves: a realm module, a trusted
      // package, or a library the runtime shims — and the last two are graph
      // leaves that are never resolved at all.
      let realm = new TestRealm({});
      let entry = realm.url(entryPath);
      let result = await classifierFor(realm).classifyModule(
        entry,
        `import type { Scene } from 'three';\nexport class C { s?: Scene; }`,
      );

      assert.deepEqual([...result.moduleGraph], [entry], 'nothing was reached');
      assert.false(result.moduleGraphComplete, 'so the graph is unavailable');
      // Which of the two failure spellings appears is the resolver's: one
      // that refuses a bare specifier outright reports `module-resolve:`, and
      // one that answers with a URL nothing serves reports `module-load:`.
      assert.strictEqual(
        result.reason,
        'module-resolve:three',
        'and names the specifier it could not place',
      );
    });
  });
});
