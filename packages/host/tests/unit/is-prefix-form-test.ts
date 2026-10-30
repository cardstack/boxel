import { module, test } from 'qunit';

import { isAbsoluteIdentifier, isPrefixForm } from '@cardstack/runtime-common';

module('Unit | isPrefixForm', function () {
  test('a prefix-form identifier is in prefix form', function (assert) {
    assert.true(isPrefixForm('@cardstack/base/card-api'));
    assert.true(isPrefixForm('@cardstack/catalog/'));
  });

  test('a prefix that is not registered is still in prefix form', function (assert) {
    assert.true(isPrefixForm('@unregistered/realm/thing'));
  });

  test('URL-form and relative identifiers are not', function (assert) {
    assert.false(isPrefixForm('https://realms.example.test/base/card-api'));
    assert.false(isPrefixForm('http://localhost:4201/catalog/Listing/1'));
    assert.false(isPrefixForm('./person'));
    assert.false(isPrefixForm('../person'));
    assert.false(isPrefixForm(''));
  });
});

module('Unit | isAbsoluteIdentifier', function () {
  test('http(s) URLs and prefix-form identifiers are absolute', function (assert) {
    assert.true(isAbsoluteIdentifier('https://realms.example.test/r/person'));
    assert.true(isAbsoluteIdentifier('http://localhost:4201/catalog/'));
    assert.true(isAbsoluteIdentifier('@cardstack/base/card-api'));
    assert.true(isAbsoluteIdentifier('@unregistered/realm/thing'));
  });

  test('relative references, bare specifiers and other schemes are not', function (assert) {
    assert.false(isAbsoluteIdentifier('./person'));
    assert.false(isAbsoluteIdentifier('../person'));
    assert.false(isAbsoluteIdentifier('/person'));
    assert.false(isAbsoluteIdentifier('lodash'));
    assert.false(isAbsoluteIdentifier('data:text/plain,hi'));
    assert.false(isAbsoluteIdentifier('blob:https://realms.example.test/1'));
    assert.false(isAbsoluteIdentifier(''));
  });
});
