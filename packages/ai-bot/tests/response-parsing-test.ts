import { module, test, assert } from 'qunit';
import { cleanContent } from '../helpers';

module('processStream', () => {
  test('should be able to remove whitespace around the outside of the text', () => {
    const input = '   this is   \n   some text  \n ';
    const expectedResult = 'this is   \n   some text';
    const result = cleanContent(input);
    assert.equal(result, expectedResult);
  });

  test('should be able to remove markdown block quote delimiters', () => {
    const input = 'Next there is some json in ```json { "a": "json" } ```';
    const expectedResult = 'Next there is some json in  { "a": "json" }';
    const result = cleanContent(input);
    assert.equal(result, expectedResult);
  });

  test('should remove all backticks', () => {
    const input = 'Next there is some json in ``';
    const expectedResult = 'Next there is some json in';
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
