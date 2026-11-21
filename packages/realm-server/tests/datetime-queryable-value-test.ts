import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

// A date-time's queryable value is the search doc's `yyyy-MM-ddTHH:mm` in
// UTC, whatever zone the process runs in: a query reads a zoneless date-time
// as UTC, so a server in another zone would otherwise index a different wall
// time than the one the query compares.
module(basename(import.meta.filename), function () {
  test('the queryable value of a date-time is its UTC wall time, in any process zone', function (assert) {
    let serializer = fileURLToPath(
      new URL('../../runtime-common/serializers/datetime.ts', import.meta.url),
    );
    let script = `import(${JSON.stringify(serializer)}).then((m) => console.log(m.queryableValue(new Date('2024-01-01T23:30:00Z'))))`;
    for (let zone of ['America/New_York', 'Asia/Kolkata', 'UTC']) {
      let run = spawnSync(
        process.execPath,
        [...process.execArgv, '--input-type=module', '-e', script],
        { env: { ...process.env, TZ: zone }, encoding: 'utf8' },
      );
      assert.strictEqual(
        run.stdout.trim(),
        '2024-01-01T23:30',
        `${zone}: ${run.stderr}`,
      );
    }
  });
});
