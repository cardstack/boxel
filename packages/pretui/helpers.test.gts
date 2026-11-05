// Pretui — the template helpers, called from a template the way host and
// card templates call them.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import {
  add,
  and,
  bool,
  coalesce,
  divide,
  element,
  eq,
  gt,
  gte,
  lt,
  lte,
  multiply,
  not,
  or,
  subtract,
} from './helpers';

module('Pretui | helpers', function (hooks) {
  setupCardTest(hooks);

  test('comparisons and boolean logic', async function (assert) {
    await render(
      <template>
        <span data-test='eq'>{{eq 1 1}} {{eq 1 2}}</span>
        <span data-test='not'>{{not 0}} {{not 'a'}}</span>
        <span data-test='bool'>{{bool ''}} {{bool 'a'}}</span>
        <span data-test='and'>{{and 1 2 3}} {{and 1 0 3}}</span>
        <span data-test='or'>{{or 0 0 3}} {{or 0 0 0}}</span>
        <span data-test='order'>{{lt 1 2}}
          {{lte 2 2}}
          {{gt 1 2}}
          {{gte 2 3}}</span>
        <span data-test='coalesce'>{{coalesce null 'x'}}
          {{coalesce 0 9}}</span>
      </template>,
    );
    assert.dom('[data-test="eq"]').hasText('true false');
    assert.dom('[data-test="not"]').hasText('true false');
    assert.dom('[data-test="bool"]').hasText('false true');
    assert.dom('[data-test="and"]').hasText('true false');
    assert.dom('[data-test="or"]').hasText('true false');
    assert.dom('[data-test="order"]').hasText('true true false false');
    assert.dom('[data-test="coalesce"]').hasText('x 0');
  });

  test('arithmetic', async function (assert) {
    await render(
      <template>
        <span data-test='math'>{{add 2 3}}
          {{subtract 2 3}}
          {{multiply 2 3}}
          {{divide 3 2}}</span>
      </template>,
    );
    assert.dom('[data-test="math"]').hasText('5 -1 6 1.5');
    assert.throws(() => divide(1, 0), /Cannot divide by zero/);
  });

  test('element renders the tag it is given, and a div by default', async function (assert) {
    let tag: 'section' | undefined = 'section';
    let none: 'section' | undefined = undefined;
    await render(
      <template>
        {{#let (element tag) as |Tag|}}
          <Tag data-test='chosen'>in a section</Tag>
        {{/let}}
        {{#let (element none) as |Tag|}}
          <Tag data-test='default'>in a div</Tag>
        {{/let}}
      </template>,
    );
    assert.dom('section[data-test="chosen"]').hasText('in a section');
    assert.dom('div[data-test="default"]').hasText('in a div');
  });
});
