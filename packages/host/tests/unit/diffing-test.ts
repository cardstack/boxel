import { module, test } from 'qunit';

import { diff } from '../helpers';

module('Unit | diffing', function () {
  let prevEntries = [
    { path: 'person.ts', lastModified: 1676674131001 },
    { path: 'person.json', lastModified: 1676674131001 },
    { path: 'Pet' },
    { path: 'Pet/inner' },
    { path: 'Pet/inner/inner' },
    { path: 'Pet/1.json', lastModified: 1677189540401 },
    { path: 'Pet/3.json', lastModified: 1676674145384 },
    { path: 'Pet/2.json', lastModified: 1676677893621 },
    { path: 'pet.gts', lastModified: 1676674131000 },
  ];

  test('can detect added entries', function (assert) {
    let newEntries = [
      ...prevEntries,
      { path: 'Person' },
      { path: 'Person/1.json', lastModified: 1676674131001 },
      { path: 'Pet/inner/inner/foo.txt', lastModified: 1677189540404 },
    ];

    let changes = diff(prevEntries, newEntries);
    assert.deepEqual(changes, {
      added: ['Person', 'Person/1.json', 'Pet/inner/inner/foo.txt'],
      removed: [],
      changed: [],
    });
  });

  test('can detect removed entries', function (assert) {
    let newEntries = [
      { path: 'person.ts', lastModified: 1676674131001 },
      { path: 'person.json', lastModified: 1676674131001 },
      { path: 'Pet' },
      { path: 'Pet/1.json', lastModified: 1677189540401 },
      { path: 'Pet/3.json', lastModified: 1676674145384 },
      { path: 'pet.gts', lastModified: 1676674131000 },
    ];

    let changes = diff(prevEntries, newEntries);
    assert.deepEqual(changes, {
      added: [],
      removed: ['Pet/inner', 'Pet/inner/inner', 'Pet/2.json'],
      changed: [],
    });
  });

  test('can detect moved entries', function (assert) {
    let newEntries = [
      { path: 'person.ts', lastModified: 1676674131001 },
      { path: 'person.json', lastModified: 1676674131001 },
      { path: 'Pet' },
      { path: 'Pet/inner' },
      { path: 'Pet/inner/inner' },
      { path: 'Pet/inner/1.json', lastModified: 1677189540401 },
      { path: 'Pet/3.json', lastModified: 1676674145384 },
      { path: 'Pet/2.json', lastModified: 1676677893621 },
      { path: 'pet.gts', lastModified: 1676674131000 },
    ];

    let changes = diff(prevEntries, newEntries);
    assert.deepEqual(changes, {
      added: ['Pet/inner/1.json'],
      removed: ['Pet/1.json'],
      changed: [],
    });
  });

  test('can detect changed entries', function (assert) {
    let newEntries = [
      { path: 'person.ts', lastModified: 1676674131011 }, // changed
      { path: 'person.json', lastModified: 1676674131001 },
      { path: 'Pet' },
      { path: 'Pet/inner' },
      { path: 'Pet/inner/inner' },
      { path: 'Pet/1.json', lastModified: 1677189540401 },
      { path: 'Pet/3.json', lastModified: 1676674145388 }, // changed
      { path: 'Pet/2.json', lastModified: 1676677893621 },
      { path: 'pet.gts', lastModified: 1676674131000 },
    ];

    let changes = diff(prevEntries, newEntries);
    assert.deepEqual(changes, {
      added: [],
      removed: [],
      changed: ['person.ts', 'Pet/3.json'],
    });
  });

  test('can detect a combination of changes', function (assert) {
    let newEntries = [
      { path: 'person.ts', lastModified: 1676674131001 },
      { path: 'person.json', lastModified: 1676674131001 },
      { path: 'Pet' },
      { path: 'Pet/group' },
      { path: 'Pet/group/dog.txt', lastModified: 1677189540411 },
      { path: 'Pet/group/inner' },
      { path: 'Pet/1.json', lastModified: 1677189540401 },
      { path: 'Pet/3.json', lastModified: 1676674145384 },
      { path: 'Pet/2.json', lastModified: 1676677893621 },
      { path: 'pet.gts', lastModified: 1676674131111 },
    ];

    let changes = diff(prevEntries, newEntries);
    assert.deepEqual(changes, {
      added: ['Pet/group', 'Pet/group/dog.txt', 'Pet/group/inner'],
      removed: ['Pet/inner', 'Pet/inner/inner'],
      changed: ['pet.gts'],
    });
  });
});
