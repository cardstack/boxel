// Round-trip tests for the source rewriter. Run with
//   NODE_NO_WARNINGS=1 node --test scripts/codemod/searchable/transform.test.ts
// from packages/realm-server.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  transformSearchable,
  type ClassPolicy,
  type Searchable,
} from './transform.ts';

function run(
  source: string,
  policies: Record<string, ClassPolicy> = {},
  opts: { stripIsUsed?: boolean; filename?: string } = {},
) {
  return transformSearchable(source, {
    filename: opts.filename ?? 'card.gts',
    policyForClass: (name) => (name ? policies[name] : undefined),
    stripIsUsed: opts.stripIsUsed,
  });
}

test('by default KEEPS isUsed (old gen still honors it) and adds searchable', () => {
  let src = `import { field, linksTo, CardDef } from './card-api';
export class Author extends CardDef {
  @field blog = linksTo(Blog, { isUsed: true });
}`;
  let res = run(src, { Author: { observed: { blog: true } } });
  assert.equal(res.status, 'transformed');
  assert.ok(res.output.includes('isUsed: true'), 'isUsed kept by default');
  assert.match(res.output, /searchable: true/);
});

test('strips isUsed and adds observed searchable when --strip-isused', () => {
  let src = `import { field, linksTo, CardDef } from './card-api';
export class Author extends CardDef {
  @field blog = linksTo(Blog, { isUsed: true });
}`;
  let res = run(
    src,
    { Author: { observed: { blog: true } } },
    { stripIsUsed: true },
  );
  assert.equal(res.status, 'transformed');
  assert.ok(!res.output.includes('isUsed'), 'isUsed removed');
  assert.match(res.output, /linksTo\(Blog, \{\s*searchable: true\s*\}\)/);
});

test('adds options object when none present', () => {
  let src = `export class A extends CardDef {
  @field author = linksTo(Author);
}`;
  let res = run(src, { A: { observed: { author: true } } });
  assert.match(res.output, /linksTo\(Author, \{\s*searchable: true\s*\}\)/);
});

test('dotted path string', () => {
  let src = `export class A extends CardDef {
  @field policy = linksTo(Policy);
}`;
  let res = run(src, { A: { observed: { policy: 'customer' } } });
  assert.match(res.output, /searchable: ['"]customer['"]/);
});

test('array of dotted paths', () => {
  let src = `export class A extends CardDef {
  @field policy = linksTo(Policy);
}`;
  let res = run(src, {
    A: { observed: { policy: ['customer', 'territory'] } },
  });
  assert.match(
    res.output,
    /searchable: \[['"]customer['"], ?['"]territory['"]\]/,
  );
});

test('contains field annotated with a route through it', () => {
  let src = `export class Article extends CardDef {
  @field signOff = contains(Signoff);
}`;
  let res = run(src, { Article: { observed: { signOff: 'editor' } } });
  assert.match(
    res.output,
    /contains\(Signoff, \{\s*searchable: ['"]editor['"]\s*\}\)/,
  );
});

test('query-backed field: isUsed stripped, searchable NOT added', () => {
  let src = `export class A extends CardDef {
  @field linkedCards = linksToMany(CardDef, {
    isUsed: true,
    query: { filter: { in: { id: '$this.refs' } } },
  });
}`;
  // Even if (hypothetically) observed has an entry, query-backed is inert.
  let res = run(
    src,
    { A: { observed: { linkedCards: true } } },
    { stripIsUsed: true },
  );
  assert.ok(!res.output.includes('isUsed'), 'isUsed removed');
  assert.ok(
    !res.output.includes('searchable'),
    'no searchable on query-backed',
  );
  assert.ok(res.output.includes('query:'), 'query preserved');
});

test('thunk target () => Team is preserved', () => {
  let src = `export class A extends CardDef {
  @field team = linksTo(() => Team, { isUsed: true });
}`;
  let res = run(
    src,
    { A: { observed: { team: true } } },
    { stripIsUsed: true },
  );
  assert.match(
    res.output,
    /linksTo\(\(\) => Team, \{\s*searchable: true\s*\}\)/,
  );
  assert.ok(!res.output.includes('isUsed'));
});

test('zero-instance card def defaults relationships to true (not contains)', () => {
  let src = `export class A extends CardDef {
  @field title = contains(StringField);
  @field owner = linksTo(Person);
  @field caretakers = linksToMany(Person);
}`;
  let res = run(src, { A: { defaultRelationshipsToTrue: true } });
  assert.match(res.output, /linksTo\(Person, \{\s*searchable: true\s*\}\)/);
  assert.match(res.output, /linksToMany\(Person, \{\s*searchable: true\s*\}\)/);
  // contains(StringField) must NOT gain searchable
  assert.match(res.output, /contains\(StringField\)(;|\s)/);
});

test('zero-instance defaulting skips query-backed relationships', () => {
  let src = `export class A extends CardDef {
  @field linkedCards = linksToMany(CardDef, { query: { filter: {} } });
}`;
  let res = run(src, { A: { defaultRelationshipsToTrue: true } });
  assert.equal(res.status, 'unchanged');
  assert.ok(!res.output.includes('searchable'));
});

test('options-as-variable is skipped and reported', () => {
  let src = `const opts = { isUsed: true };
export class A extends CardDef {
  @field author = linksTo(Author, opts);
}`;
  let res = run(src, { A: { observed: { author: true } } });
  assert.equal(res.status, 'unchanged');
  assert.equal(res.skipped.length, 1);
  assert.equal(res.skipped[0].fieldName, 'author');
});

test('empty options after stripping isUsed drops the {} arg', () => {
  // No searchable derived for this field, only isUsed to strip.
  let src = `export class A extends CardDef {
  @field author = linksTo(Author, { isUsed: true });
}`;
  let res = run(src, {}, { stripIsUsed: true }); // no policy → only isUsed stripping
  assert.equal(res.status, 'transformed');
  assert.match(res.output, /linksTo\(Author\)/);
  assert.ok(!res.output.includes('isUsed'));
  assert.ok(!res.output.includes('{}'));
});

test('<template> blocks survive the round-trip', () => {
  let src = `import { field, linksTo, CardDef, Component } from './card-api';
export class A extends CardDef {
  @field author = linksTo(Author, { isUsed: true });
  static isolated = class extends Component<typeof A> {
    <template>
      <h1>{{@model.author.name}}</h1>
    </template>
  };
}`;
  let res = run(
    src,
    { A: { observed: { author: true } } },
    { stripIsUsed: true },
  );
  assert.ok(res.output.includes('<template>'), 'template preserved');
  assert.ok(
    res.output.includes('{{@model.author.name}}'),
    'template body preserved',
  );
  assert.ok(!res.output.includes('isUsed'));
  assert.match(res.output, /searchable: true/);
});

test('idempotent: re-running yields identical output', () => {
  let src = `export class A extends CardDef {
  @field author = linksTo(Author, { isUsed: true });
  @field policy = linksTo(Policy);
}`;
  let policies = {
    A: {
      observed: { author: true, policy: 'customer' } as Record<
        string,
        Searchable
      >,
    },
  };
  let once = run(src, policies);
  let twice = run(once.output, policies);
  assert.equal(twice.status, 'unchanged', 'second run is a no-op');
  assert.equal(twice.output, once.output);
});

test('existing searchable is replaced with the derived value', () => {
  let src = `export class A extends CardDef {
  @field policy = linksTo(Policy, { searchable: true });
}`;
  let res = run(src, { A: { observed: { policy: 'customer' } } });
  assert.match(res.output, /searchable: ['"]customer['"]/);
  assert.ok(!/searchable: true/.test(res.output));
});

test('unparseable source throws (caller skips + reports)', () => {
  let src = `export class A extends CardDef {
  @field broken = linksTo(  // missing everything
`;
  assert.throws(() => run(src, {}));
});

test('observed route for an inherited (undeclared) field is reported, not applied', () => {
  let src = `export class A extends CardDef {
  @field title = contains(StringField);
}`;
  // cardInfo is inherited from base CardDef; A does not declare it.
  let res = run(src, { A: { observed: { cardInfo: 'theme' } } });
  assert.equal(res.status, 'unchanged');
  assert.equal(res.unapplied.length, 1);
  assert.equal(res.unapplied[0].fieldName, 'cardInfo');
  assert.deepEqual(res.unapplied[0].value, 'theme');
});

test('multiple defs in one module are handled independently', () => {
  let src = `export class A extends CardDef {
  @field x = linksTo(X, { isUsed: true });
}
export class B extends CardDef {
  @field y = linksTo(Y);
}`;
  let res = run(
    src,
    {
      A: { observed: { x: true } },
      B: { observed: {} }, // had instances but y stayed shallow
    },
    { stripIsUsed: true },
  );
  assert.match(res.output, /linksTo\(X, \{\s*searchable: true\s*\}\)/);
  assert.match(res.output, /linksTo\(Y\)/); // B.y untouched (shallow)
  assert.ok(!res.output.includes('isUsed'));
});
