import QUnit from 'qunit';
const { module, test } = QUnit;
import { planPack, unmetDependencies } from '../src/pack-mode.ts';

const BASE = 'https://realms.example/chris/notes/';

// A realistic decklist: two of the deck's own modules, two real
// dependencies, one bare specifier the map resolves for itself.
const IMPORTS = {
  'notes/app': `${BASE}app.js`,
  'notes/theme': `${BASE}theme.js`,
  '@cardstack/base/': 'https://cardstack.com/base/',
  three: 'https://deck.example/lib/three@0.169.0/three.js',
  'notes/util': './util.js',
};

module('pack modes: bare', function () {
  test('the deck’s own modules are not dependencies', function (assert) {
    let plan = planPack({ mode: 'bare', imports: IMPORTS, sourceBase: BASE });
    let specifiers = (plan.pruned.external ?? []).map((d) => d.specifier);
    assert.false(specifiers.includes('notes/app'));
    assert.false(specifiers.includes('notes/theme'));
    // Nor is a relative one — it travels with the tree.
    assert.false(specifiers.includes('notes/util'));
  });

  test('every external dependency is pruned, and recorded', function (assert) {
    let plan = planPack({ mode: 'bare', imports: IMPORTS, sourceBase: BASE });
    assert.deepEqual(plan.vendor, [], 'bare carries no dependency bytes');
    assert.deepEqual(plan.pruned.external, [
      { specifier: '@cardstack/base/', from: 'https://cardstack.com/base/' },
      { specifier: 'three', from: 'https://deck.example/lib/three@0.169.0/three.js' },
    ]);
  });

  // The whole reason the record exists. A bare pack IS the most aggressive
  // prune available; one that does not say so is ambient-dependent.
  test('the prune record is what the provenance block stores', function (assert) {
    let plan = planPack({
      mode: 'bare',
      imports: IMPORTS,
      sourceBase: BASE,
      foreign: ['https://other-realm.example/someone/card.json'],
    });
    assert.strictEqual(plan.pruned.external?.length, 2);
    assert.deepEqual(plan.pruned.unresolved, [
      'https://other-realm.example/someone/card.json',
    ]);
  });
});

module('pack modes: hermetic', function () {
  test('every external dependency is carried instead of pruned', function (assert) {
    let plan = planPack({
      mode: 'hermetic',
      imports: IMPORTS,
      sourceBase: BASE,
    });
    assert.deepEqual(
      plan.vendor.map((d) => d.specifier),
      ['@cardstack/base/', 'three'],
    );
    assert.strictEqual(plan.pruned.external, undefined, 'nothing external is left out');
  });

  // "Assumes nothing but a runtime" — not "assumes nothing at all". A
  // reference nobody can name cannot be fetched, so hermetic is honest
  // about it rather than pretending completeness.
  test('what cannot be named is still reported', function (assert) {
    let plan = planPack({
      mode: 'hermetic',
      imports: IMPORTS,
      sourceBase: BASE,
      foreign: ['https://third-party.example/widget.js'],
    });
    assert.deepEqual(plan.pruned.unresolved, [
      'https://third-party.example/widget.js',
    ]);
  });

  test('with nothing unresolvable, a hermetic pack prunes nothing', function (assert) {
    let plan = planPack({
      mode: 'hermetic',
      imports: IMPORTS,
      sourceBase: BASE,
    });
    assert.deepEqual(plan.pruned, {});
  });
});

module('pack modes: can the recipient open it', function () {
  test('a bare pack lists what the far side still needs', function (assert) {
    let plan = planPack({ mode: 'bare', imports: IMPORTS, sourceBase: BASE });
    // A recipient that has base fields but has never heard of three.
    let unmet = unmetDependencies(
      plan.pruned,
      (specifier) => specifier === '@cardstack/base/',
    );
    assert.deepEqual(unmet, [
      { specifier: 'three', from: 'https://deck.example/lib/three@0.169.0/three.js' },
    ]);
  });

  test('a recipient that reaches everything has nothing unmet', function (assert) {
    let plan = planPack({ mode: 'bare', imports: IMPORTS, sourceBase: BASE });
    assert.deepEqual(unmetDependencies(plan.pruned, () => true), []);
  });

  test('a hermetic pack asks nothing of the recipient', function (assert) {
    let plan = planPack({
      mode: 'hermetic',
      imports: IMPORTS,
      sourceBase: BASE,
    });
    assert.deepEqual(unmetDependencies(plan.pruned, () => false), []);
  });
});
