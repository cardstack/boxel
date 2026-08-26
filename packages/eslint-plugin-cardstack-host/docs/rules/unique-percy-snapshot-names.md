# Require every Percy snapshot within a test to have a distinct name (`@cardstack/host/unique-percy-snapshot-names`)

💼 This rule is enabled in the ✅ `recommended` config.

<!-- end auto-generated rule header -->

`percySnapshot(assert)` derives its snapshot name from the QUnit module name
and the test name and nothing else, so every bare call inside one test uploads
under the same name. Percy stores one snapshot per name per build and which of
the colliding uploads it keeps is not stable from build to build, so one of the
two intended snapshots silently goes unreviewed and the name flips between two
unrelated frames — a near-total diff appearing on branches that changed
neither.

A test that snapshots more than once needs an explicit distinct name for each
call after the first:

```js
test('visiting operator mode', async function (assert) {
  await percySnapshot(assert);

  await click(cardSelector);
  await percySnapshot(
    'Acceptance | operator mode tests | visiting operator mode - card opened in stack',
  );
});
```
