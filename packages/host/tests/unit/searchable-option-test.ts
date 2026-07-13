import { module, test } from 'qunit';

import {
  Loader,
  VirtualNetwork,
  baseRealm,
  fetcher,
  maybeHandleScopedCSSRequest,
  internalKeyFor,
  identifyCard,
  getFieldDefinitions,
  getFieldDef,
  validateSearchablePaths,
  type CodeRef,
  type Definition,
} from '@cardstack/runtime-common';

import ENV from '@cardstack/host/config/environment';
import { shimExternals } from '@cardstack/host/lib/externals';

import { testRealmURL } from '../helpers';

import type { CardDef, Field } from '@cardstack/base/card-api';
import type * as CardAPI from '@cardstack/base/card-api';

let { resolvedBaseRealmURL } = ENV;

// Scaffolding-only coverage for the `searchable` field option (additive, inert
// — nothing consumes it for search-doc depth yet): it plumbs onto the field
// descriptor, mirrors into the cached `FieldDefinition`, and its annotation
// paths validate against the definition graph.
module('Unit | searchable option', function (hooks) {
  let loader: Loader;
  let api: typeof CardAPI;
  // Card classes captured from the per-test setup so assertions can reach them.
  let cards: {
    Article: typeof CardDef;
    Sample: typeof CardDef;
    Author: typeof CardDef;
    Address: typeof CardDef;
    Employer: typeof CardDef;
    Citation: typeof CardDef;
    Journal: typeof CardDef;
    Country: typeof CardDef;
  };
  let virtualNetwork: VirtualNetwork;

  hooks.beforeEach(async function () {
    virtualNetwork = new VirtualNetwork();
    virtualNetwork.addURLMapping(
      new URL(baseRealm.url),
      new URL(resolvedBaseRealmURL),
    );
    virtualNetwork.addRealmMapping('@cardstack/base/', resolvedBaseRealmURL);
    virtualNetwork.addImportMap('@cardstack/boxel-icons/', (rest) => {
      return `${ENV.iconsURL}/@cardstack/boxel-icons/v1/icons/${rest}.js`;
    });
    shimExternals(virtualNetwork);
    let fetch = fetcher(virtualNetwork.fetch, [
      async (req, next) => {
        return (await maybeHandleScopedCSSRequest(req)) || next(req);
      },
    ]);
    loader = new Loader(fetch, virtualNetwork.resolveImport, {
      virtualNetwork,
    });

    api = await loader.import<typeof CardAPI>('@cardstack/base/card-api');
    let string = await loader.import<typeof import('@cardstack/base/string')>(
      '@cardstack/base/string',
    );

    let {
      field,
      contains,
      containsMany,
      linksTo,
      linksToMany,
      CardDef,
      FieldDef,
    } = api;
    let { default: StringField } = string;

    class Country extends CardDef {
      @field name = contains(StringField);
    }
    class Employer extends CardDef {
      @field name = contains(StringField);
      @field headquarters = linksTo(() => Country);
    }
    class Address extends FieldDef {
      @field street = contains(StringField);
      @field city = contains(StringField);
    }
    class Author extends CardDef {
      @field name = contains(StringField);
      @field address = contains(Address);
      @field employer = linksTo(() => Employer);
    }
    // Used for validation good/bad coverage — every annotated field is a link
    // so the path root is unambiguous (the field's target type).
    class Article extends CardDef {
      @field title = contains(StringField);
      @field author = linksTo(() => Author, { searchable: true });
      @field reviewer = linksTo(() => Author, { searchable: 'address' });
      @field editor = linksTo(() => Author, { searchable: 'address.city' });
      @field publisher = linksTo(() => Author, {
        searchable: 'employer.headquarters',
      });
      @field combo = linksTo(() => Author, {
        searchable: ['address', 'employer.headquarters'],
      });
      @field typo = linksTo(() => Author, { searchable: 'addresss' });
      @field deepTypo = linksTo(() => Author, {
        searchable: 'address.zipcode',
      });
      @field primitiveRoute = linksTo(() => Author, {
        searchable: 'name.first',
      });
      @field comboBad = linksTo(() => Author, {
        searchable: ['address.city', 'nope'],
      });
    }
    // A FieldDef that itself declares a link, so a `searchable` path can route
    // *through* a contained value to reach a deeper link. FieldDefs may declare
    // linksTo — see e.g. base/skill-reference.
    class Citation extends FieldDef {
      @field label = contains(StringField);
      @field article = linksTo(() => Author);
    }
    // Exercises contains/containsMany routing through a contained FieldDef's
    // link. `Journal` yields exactly one issue (badCitations) so the count is
    // an assertable signal.
    class Journal extends CardDef {
      @field title = contains(StringField);
      @field citations = containsMany(Citation, {
        searchable: 'article.name',
      });
      @field lead = contains(Citation, { searchable: 'article' });
      @field badCitations = containsMany(Citation, {
        searchable: 'article.bogus',
      });
    }
    // Used for option-plumbing + projection coverage across all four field
    // kinds; never validated, so the annotation values are arbitrary.
    class Sample extends CardDef {
      @field plainContains = contains(StringField);
      @field searchContains = contains(Address, { searchable: 'city' });
      @field searchContainsMany = containsMany(StringField, {
        searchable: true,
      });
      @field searchLinksTo = linksTo(() => Author, { searchable: 'address' });
      @field searchLinksToMany = linksToMany(() => Author, {
        searchable: ['address', 'employer.headquarters'],
      });
    }

    loader.shimModule(`${testRealmURL}country`, { Country });
    loader.shimModule(`${testRealmURL}employer`, { Employer });
    loader.shimModule(`${testRealmURL}address`, { Address });
    loader.shimModule(`${testRealmURL}author`, { Author });
    loader.shimModule(`${testRealmURL}article`, { Article });
    loader.shimModule(`${testRealmURL}citation`, { Citation });
    loader.shimModule(`${testRealmURL}journal`, { Journal });
    loader.shimModule(`${testRealmURL}sample`, { Sample });

    cards = {
      Article: Article as unknown as typeof CardDef,
      Sample: Sample as unknown as typeof CardDef,
      Author: Author as unknown as typeof CardDef,
      Address: Address as unknown as typeof CardDef,
      Employer: Employer as unknown as typeof CardDef,
      Citation: Citation as unknown as typeof CardDef,
      Journal: Journal as unknown as typeof CardDef,
      Country,
    };
  });

  function buildDefinition(cardDef: typeof CardDef): Definition {
    let { fields, fieldDefs } = getFieldDefinitions(api, cardDef);
    return {
      codeRef: identifyCard(cardDef)!,
      displayName: cardDef.displayName,
      fields,
      fieldDefs,
      type: 'card-def',
    };
  }

  // Resolve any CodeRef among the cards registered above to its definition,
  // mirroring what `CachingDefinitionLookup` does loaderlessly in production.
  function makeLookup() {
    let byKey = new Map<string, typeof CardDef>();
    for (let cardDef of Object.values(cards)) {
      byKey.set(
        internalKeyFor(identifyCard(cardDef)!, undefined, virtualNetwork),
        cardDef,
      );
    }
    return async (codeRef: CodeRef): Promise<Definition | undefined> => {
      let cardDef = byKey.get(
        internalKeyFor(codeRef, undefined, virtualNetwork),
      );
      return cardDef ? buildDefinition(cardDef) : undefined;
    };
  }

  test('searchable plumbs onto the field descriptor for every field kind', function (assert) {
    let fields = api.getFields(cards.Sample) as Record<string, Field>;
    assert.strictEqual(
      fields.plainContains.searchable,
      undefined,
      'an unannotated field has no searchable',
    );
    assert.strictEqual(
      fields.searchContains.searchable,
      'city',
      'contains carries a dotted-path searchable',
    );
    let containsManyIsSelfSearchable =
      fields.searchContainsMany.searchable === true;
    assert.true(
      containsManyIsSelfSearchable,
      'containsMany carries searchable: true',
    );
    assert.strictEqual(
      fields.searchLinksTo.searchable,
      'address',
      'linksTo carries a dotted-path searchable',
    );
    assert.deepEqual(
      fields.searchLinksToMany.searchable,
      ['address', 'employer.headquarters'],
      'linksToMany carries an array searchable',
    );
  });

  test('getFieldDefinitions mirrors searchable into the cached FieldDefinition', function (assert) {
    let { fields, fieldDefs } = getFieldDefinitions(api, cards.Sample);
    let searchableOf = (fieldName: string) =>
      fieldDefs[fields[fieldName]].searchable;

    assert.strictEqual(
      searchableOf('plainContains'),
      undefined,
      'unannotated field def has no searchable',
    );
    assert.strictEqual(searchableOf('searchContains'), 'city');
    let containsManyMirrorsSelf = searchableOf('searchContainsMany') === true;
    assert.true(
      containsManyMirrorsSelf,
      'containsMany def mirrors searchable: true',
    );
    assert.strictEqual(searchableOf('searchLinksTo'), 'address');
    assert.deepEqual(searchableOf('searchLinksToMany'), [
      'address',
      'employer.headquarters',
    ]);
  });

  test('searchable: true and resolvable paths produce no validation issues', async function (assert) {
    let lookup = makeLookup();
    let issues = await validateSearchablePaths(
      buildDefinition(cards.Article),
      lookup,
    );
    let goodFields = ['author', 'reviewer', 'editor', 'publisher'];
    for (let fieldName of goodFields) {
      assert.notOk(
        issues.some((i) => i.fieldName === fieldName),
        `${fieldName} (a resolvable annotation) produced no issue`,
      );
    }
    // The good leg of `combo` (`address`) resolves; only its bad leg, if any,
    // would surface — and combo has none, so combo is absent from issues.
    assert.notOk(
      issues.some((i) => i.fieldName === 'combo'),
      'combo (both legs resolvable) produced no issue',
    );

    // Positively confirm, for a path that exists, both that the raw annotation
    // is stored on the owning field's definition item and that the path
    // actually resolves through the graph — not merely "no issue".
    let articleDef = buildDefinition(cards.Article);
    let reviewerDef = articleDef.fieldDefs[articleDef.fields['reviewer']];
    assert.strictEqual(
      reviewerDef.searchable,
      'address',
      'reviewer field def carries the raw searchable annotation',
    );
    let reviewerTarget = await lookup(reviewerDef.fieldOrCard);
    let resolvedAddress = await getFieldDef(reviewerTarget!, 'address', lookup);
    assert.strictEqual(
      resolvedAddress?.type,
      'contains',
      "reviewer's 'address' resolves to Author.address against the graph",
    );
    let publisherDef = articleDef.fieldDefs[articleDef.fields['publisher']];
    let publisherTarget = await lookup(publisherDef.fieldOrCard);
    let resolvedHq = await getFieldDef(
      publisherTarget!,
      'employer.headquarters',
      lookup,
    );
    assert.strictEqual(
      resolvedHq?.type,
      'linksTo',
      "publisher's 'employer.headquarters' resolves across two link hops",
    );
  });

  test('searchable paths route through a contained FieldDef to a deeper link', async function (assert) {
    let lookup = makeLookup();
    let issues = await validateSearchablePaths(
      buildDefinition(cards.Journal),
      lookup,
    );
    assert.notOk(
      issues.some((i) => i.fieldName === 'citations'),
      "'article.name' routes through the contained Citation's link and resolves",
    );
    assert.notOk(
      issues.some((i) => i.fieldName === 'lead'),
      "'article' resolves to the contained FieldDef's own link",
    );
    assert.deepEqual(
      issues.map((i) => `${i.fieldName}:${i.path}`),
      ['badCitations:article.bogus'],
      'only the path with a nonexistent segment beyond the link is recorded',
    );
  });

  test('skips searchable: true and omitted, and flags every dotted path when the target is unresolvable', async function (assert) {
    // A lookup that resolves nothing: `true` (self link) and omitted fields are
    // still skipped without a lookup, while every dotted path is flagged
    // because its target type can't be resolved.
    let issues = await validateSearchablePaths(
      buildDefinition(cards.Article),
      async () => undefined,
    );
    assert.notOk(
      issues.some((i) => i.fieldName === 'author'),
      'searchable: true carries no path and is never flagged',
    );
    assert.notOk(
      issues.some((i) => i.fieldName === 'title'),
      'an unannotated field is skipped',
    );
    assert.ok(
      issues.some((i) => i.fieldName === 'reviewer' && i.path === 'address'),
      'a dotted path whose target cannot be resolved is flagged',
    );
  });

  test('unresolvable searchable paths are recorded as issues (never thrown)', async function (assert) {
    let lookup = makeLookup();
    let issues = await validateSearchablePaths(
      buildDefinition(cards.Article),
      lookup,
    );

    let issueFor = (fieldName: string, path: string) =>
      issues.find((i) => i.fieldName === fieldName && i.path === path);

    assert.ok(issueFor('typo', 'addresss'), 'typo path is recorded');
    assert.ok(
      issueFor('deepTypo', 'address.zipcode'),
      'a path with a nonexistent deep segment is recorded',
    );
    assert.ok(
      issueFor('primitiveRoute', 'name.first'),
      'a path routing deeper through a primitive is recorded',
    );
    assert.ok(
      issueFor('comboBad', 'nope'),
      'the unresolvable leg of an array annotation is recorded',
    );
    assert.notOk(
      issueFor('comboBad', 'address.city'),
      'the resolvable leg of the same array annotation is not recorded',
    );
    assert.strictEqual(
      issues.length,
      4,
      'exactly the four unresolvable paths are recorded',
    );
  });
});
