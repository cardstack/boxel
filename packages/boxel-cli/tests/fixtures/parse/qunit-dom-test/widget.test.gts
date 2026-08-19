import { module, test } from 'qunit';

// A workspace `.test.gts` that calls `assert.dom(...)` without importing
// qunit-dom directly — the common shape. `parse` discovers and
// type-checks every `.gts`, including tests, so the qunit-dom `Assert`
// augmentation must be loaded or this fails with "Property 'dom' does not
// exist on type 'Assert'".
module('widget', function () {
  test('renders a title', function (assert) {
    assert.dom('.title').exists();
    assert.dom('.title').hasText('Hello');
  });
});
