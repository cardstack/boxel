import { module, test, assert } from 'qunit';
import { cleanContent } from '../helpers';

module('processStream', () => {
  test('should be able to remove whitespace around the outside of the text', () => {
    const input = '   this is   \n   some text  \n ';
    const expectedResult = 'this is   \n   some text';
    const result = cleanContent(input);
    assert.equal(result, expectedResult);
  });

  test('should not have just json at the end', () => {
    const input = 'Here is the option: json';
    const expectedResult = 'Here is the option:';
    const result = cleanContent(input);
    assert.equal(result, expectedResult);
  });
});
