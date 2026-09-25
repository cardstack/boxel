import { describe, it, expect } from 'vitest';

import { runGlintCheck } from '../../src/commands/parse.ts';

// The factory twin's four-shape suite, driven through the CLI's own glint
// runner. The two gates stage and type-check the same fetched catalog
// sources under *different* tsconfig `paths` maps, and this is the copy an
// author invokes by hand — nothing else exercises it with realm-prefixed
// imports, so a divergence between the maps (a missing alias, a root moved)
// surfaces here and nowhere else.
//
// The stubbed catalog module deliberately carries an `@cardstack/boxel-icons`
// import: 144 of the 357 catalog `.gts` files do, and an icon that types as
// `object` (the unbuilt-declarations monorepo fallback this map's alias
// exists to avoid) breaks `typeof BaseDef` on every class that sets it as
// `static icon`.

const TARGET_REALM = 'https://realms.example.test/user/target/';
const CATALOG_URL = 'https://realms.example.test/catalog/';

const CATALOG_FILES: Record<string, string> = {
  'blog/author.gts': `import {
  CardDef,
  FieldDef,
  field,
  contains,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import SquareUser from '@cardstack/boxel-icons/square-user';

export class ContactLinkField extends FieldDef {
  static displayName = 'Contact Link';
  @field label = contains(StringField);
  @field url = contains(StringField);
}

export class Author extends CardDef {
  static displayName = 'Author';
  static icon = SquareUser;
  @field name = contains(StringField);
}
`,
};

function stubRealmFetch() {
  return (async (input: string | URL) => {
    let url = String(input);
    let path = url.startsWith(CATALOG_URL) ? url.slice(CATALOG_URL.length) : '';
    let source = CATALOG_FILES[path];
    if (source === undefined) {
      return new Response('not found', { status: 404 });
    }
    return new Response(source, { status: 200 });
  }) as unknown as typeof globalThis.fetch;
}

// The four shapes a card can take when it reuses catalog content. The
// template is the axis that matters: `Component<typeof this>` requires
// `typeof BaseDef`, which an `any`-typed shim cannot supply for a subclass's
// static side — shape B is the one that catches a degraded resolution.
const SHAPES = {
  'a-extends-no-template.gts': `import { Author } from '@cardstack/catalog/blog/author';

export class ContributorA extends Author {
  static displayName = 'Contributor A';
}
`,
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
  'd-contains-no-template.gts': `import { CardDef, field, contains } from '@cardstack/base/card-api';
import { ContactLinkField } from '@cardstack/catalog/blog/author';

export class ContributorD extends CardDef {
  static displayName = 'Contributor D';
  @field contact = contains(ContactLinkField);
}
`,
};

describe('boxel parse — realm-prefixed imports (in-process glint)', () => {
  it(
    'all four adoption shapes type-check against fetched catalog sources, warning-free',
    async () => {
      let { errors, warnings } = await runGlintCheck(
        Object.entries(SHAPES).map(([path, content]) => ({ path, content })),
        {
          realmOrigin: TARGET_REALM,
          fetchFn: stubRealmFetch(),
        },
      );

      expect(errors).toEqual([]);
      // Warnings must be empty too: a staged-diagnostic warning here means
      // the catalog sources didn't resolve cleanly under this tsconfig —
      // exactly the paths-map drift this test exists to catch.
      expect(warnings).toEqual([]);
    },
    { timeout: 180_000 },
  );
});
