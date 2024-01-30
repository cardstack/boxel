import { module, test } from 'qunit';

import { extractMatrixErrorMessage } from '@cardstack/host/components/matrix/login';

module('Unit | matrix | extractMatrixErrorMessage', function () {
  test('it describes a 429', function (assert) {
    let error = {
      httpStatus: 429,
      errcode: 'M_ERROR_CODE',
      data: {
        errcode: 'M_ERROR_CODE',
        error: 'More error text',
      },
    };

    let result = extractMatrixErrorMessage(error);
    assert.strictEqual(result, 'Too many failed attempts, try again later.');
  });

  test('it describes a 403', function (assert) {
    let error = {
      httpStatus: 403,
      errcode: 'M_ERROR_CODE',
      data: {
        errcode: 'M_ERROR_CODE',
        error: 'More error text',
      },
    };

    let result = extractMatrixErrorMessage(error);
    assert.strictEqual(result, 'Please check your credentials and try again.');
  });

  test('it describes an unknown error', function (assert) {
    let error = {
      httpStatus: 500,
      errcode: 'M_ERROR_CODE',
      data: {
        errcode: 'M_ERROR_CODE',
        error: 'Internal Server Error',
      },
    };

    let result = extractMatrixErrorMessage(error);
    assert.strictEqual(result, 'Unknown error 500: Internal Server Error');
  });
});
