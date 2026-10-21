import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { s3ClientConfig } from '../lib/s3-client.ts';

module(basename(import.meta.filename), function () {
  test('with no settings, reaches AWS in the default region', function (assert) {
    assert.deepEqual(s3ClientConfig({}, {}), {
      region: 'us-east-1',
      forcePathStyle: false,
    });
  });

  test('takes the region from AWS_REGION when the caller names none', function (assert) {
    assert.strictEqual(
      s3ClientConfig({}, { AWS_REGION: 'eu-west-1' }).region,
      'eu-west-1',
    );
    assert.strictEqual(
      s3ClientConfig({ region: 'ap-south-1' }, { AWS_REGION: 'eu-west-1' })
        .region,
      'ap-south-1',
      "the caller's region wins",
    );
  });

  test('reaches an S3-compatible store at S3_ENDPOINT', function (assert) {
    assert.deepEqual(
      s3ClientConfig(
        { region: 'auto' },
        {
          S3_ENDPOINT: 'http://localhost:9000',
          S3_FORCE_PATH_STYLE: 'true',
        },
      ),
      {
        region: 'auto',
        endpoint: 'http://localhost:9000',
        forcePathStyle: true,
      },
    );
  });

  test('a blank setting counts as unset', function (assert) {
    assert.deepEqual(
      s3ClientConfig(
        { region: ' ' },
        { S3_ENDPOINT: ' ', AWS_REGION: '', S3_FORCE_PATH_STYLE: ' ' },
      ),
      { region: 'us-east-1', forcePathStyle: false },
    );
  });
});
