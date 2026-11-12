import { module, test } from 'qunit';

import { otherSkillsLayoutURL } from '@cardstack/host/lib/skills-layout-fallback';

const realm = 'https://example.test/skills/';

module('Unit | otherSkillsLayoutURL', function () {
  test('a skill at the realm root maps to the nested layout', function (assert) {
    assert.strictEqual(
      otherSkillsLayoutURL(`${realm}boxel/SKILL.md`, realm),
      `${realm}skills/boxel/SKILL.md`,
    );
  });

  test('a skill in the nested layout maps to the realm root', function (assert) {
    assert.strictEqual(
      otherSkillsLayoutURL(`${realm}skills/boxel/SKILL.md`, realm),
      `${realm}boxel/SKILL.md`,
    );
  });

  test('a reference file maps the same way', function (assert) {
    assert.strictEqual(
      otherSkillsLayoutURL(
        `${realm}skills/boxel/references/core-concept.md`,
        realm,
      ),
      `${realm}boxel/references/core-concept.md`,
    );
  });

  test('mapping twice returns the original id', function (assert) {
    let id = `${realm}source-code-editing/SKILL.md`;
    let other = otherSkillsLayoutURL(id, realm)!;
    assert.strictEqual(otherSkillsLayoutURL(other, realm), id);
  });

  test('an id outside the skills realm has no other layout', function (assert) {
    assert.strictEqual(
      otherSkillsLayoutURL('https://example.test/catalog/x/SKILL.md', realm),
      undefined,
    );
  });

  test('the realm root itself has no other layout', function (assert) {
    assert.strictEqual(otherSkillsLayoutURL(realm, realm), undefined);
  });
});
