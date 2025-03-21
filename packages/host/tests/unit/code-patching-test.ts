import { module, test } from 'qunit';

import { parseCodeContent } from '@cardstack/host/lib/search-replace-blocks-parsing';

module(
  'Unit | code patching | parse search replace blocks',
  function (_assert) {
    test('will parse a search replace block when block is present', async function (assert) {
      let diff = `
// File url: https://example.com/file.txt
<<<<<<< SEARCH
      <div class='basketball-container'>
        <div class='basketball {{if this.isAnimating "bounce"}}'>
=======
      <div class='basketball-container'>
        <h1 class='basketball-title'>Basketball</h1>
        <div class='basketball {{if this.isAnimating "bounce"}}'>
>>>>>>> REPLACE
`;

      let result = parseCodeContent(diff);
      assert.strictEqual(result.fileUrl, 'https://example.com/file.txt');
      assert.strictEqual(
        result.code,
        `
<div class='basketball-container'>
  <div class='basketball {{if this.isAnimating "bounce"}}'>
<div class='basketball-container'>
  <h1 class='basketball-title'>Basketball</h1>
  <div class='basketball {{if this.isAnimating "bounce"}}'>`.trimStart(),
      ); // code without the search and replace markers
      assert.strictEqual(result.searchStartLine, 1);
      assert.strictEqual(result.searchEndLine, 2);
      assert.strictEqual(result.replaceStartLine, 3);
      assert.strictEqual(result.replaceEndLine, 5);
    });

    test('will not parse a search replace block when block is present', async function (assert) {
      let code = `
console.log('hello');
for (let i = 0; i < 10; i++) {
  console.log(i);
}`.trimStart();

      let result = parseCodeContent(code);
      assert.strictEqual(result.code, code);
      assert.strictEqual(result.searchStartLine, null);
      assert.strictEqual(result.searchEndLine, null);
      assert.strictEqual(result.replaceStartLine, null);
      assert.strictEqual(result.replaceEndLine, null);
      assert.strictEqual(result.fileUrl, null);
    });

    test('will parse a search replace block when search block is not finished (case 1)', async function (assert) {
      let code = `
// File url: https://example.com/file.txt
<<<<<<< SEARCH
      <div class='basketball-container'>
        <div class='basketball {{if this.isAnimating "bounce"}}'>
`.trimStart();

      let expectedCode = `
<div class='basketball-container'>
  <div class='basketball {{if this.isAnimating "bounce"}}'>`.trimStart();

      let result = parseCodeContent(code);
      assert.strictEqual(result.code, expectedCode);
      assert.strictEqual(result.searchStartLine, 1);
      assert.strictEqual(result.searchEndLine, 2);
      assert.strictEqual(result.replaceStartLine, null);
      assert.strictEqual(result.replaceEndLine, null);
      assert.strictEqual(result.fileUrl, 'https://example.com/file.txt');
    });

    test('will parse a search replace block when search block is not finished (case 2)', async function (assert) {
      let code = `
// File url: https://example.com/file.txt
<<<<<<< SEARCH
      <div class='basketball-container'>`.trimStart();

      let expectedCode = `
<div class='basketball-container'>`.trimStart();

      let result = parseCodeContent(code);
      assert.strictEqual(result.code, expectedCode);
      assert.strictEqual(result.searchStartLine, 1);
      assert.strictEqual(result.searchEndLine, 1);
      assert.strictEqual(result.replaceStartLine, null);
      assert.strictEqual(result.replaceEndLine, null);
      assert.strictEqual(result.fileUrl, 'https://example.com/file.txt');
    });

    test('will parse a search replace block when search block is not finished (case 3)', async function (assert) {
      let code = `
// File url: https://example.com/file.txt
<<<<<<< SEARCH`.trimStart();

      let expectedCode = '';

      let result = parseCodeContent(code);
      assert.strictEqual(result.code, expectedCode);
      assert.strictEqual(result.searchStartLine, null);
      assert.strictEqual(result.searchEndLine, null);
      assert.strictEqual(result.replaceStartLine, null);
      assert.strictEqual(result.replaceEndLine, null);
      assert.strictEqual(result.fileUrl, 'https://example.com/file.txt');
    });

    test('will parse a search replace block when replace block is not finished (case 1)', async function (assert) {
      let diff = `
// File url: https://example.com/file.txt
<<<<<<< SEARCH
      <div class='basketball-container'>
        <div class='basketball {{if this.isAnimating "bounce"}}'>
=======
      <div class='basketball-container'>
        <h1 class='basketball-title'>Basketball</h1>
`;

      let expectedCode = `
<div class='basketball-container'>
  <div class='basketball {{if this.isAnimating "bounce"}}'>
<div class='basketball-container'>
  <h1 class='basketball-title'>Basketball</h1>`.trimStart();

      let result = parseCodeContent(diff);
      assert.strictEqual(result.code, expectedCode);
      assert.strictEqual(result.searchStartLine, 1);
      assert.strictEqual(result.searchEndLine, 2);
      assert.strictEqual(result.replaceStartLine, 3);
      assert.strictEqual(result.replaceEndLine, 4);
      assert.strictEqual(result.fileUrl, 'https://example.com/file.txt');
    });

    test('will parse a search replace block when replace block is not finished (case 2)', async function (assert) {
      let diff = `
// File url: https://example.com/file.txt
<<<<<<< SEARCH
      <div class='basketball-container'>
        <div class='basketball {{if this.isAnimating "bounce"}}'>
=======
      <div class='basketball-container'>
`;

      let expectedCode = `
<div class='basketball-container'>
  <div class='basketball {{if this.isAnimating "bounce"}}'>
<div class='basketball-container'>`.trimStart();

      let result = parseCodeContent(diff);
      assert.strictEqual(result.code, expectedCode);
      assert.strictEqual(result.searchStartLine, 1);
      assert.strictEqual(result.searchEndLine, 2);
      assert.strictEqual(result.replaceStartLine, 3);
      assert.strictEqual(result.replaceEndLine, 3);
      assert.strictEqual(result.fileUrl, 'https://example.com/file.txt');
    });

    test('will parse a search replace block when replace block is not finished (case 3)', async function (assert) {
      let diff = `
// File url: https://example.com/file.txt
<<<<<<< SEARCH
      <div class='basketball-container'>
        <div class='basketball {{if this.isAnimating "bounce"}}'>
=======
`;

      let expectedCode = `
<div class='basketball-container'>
  <div class='basketball {{if this.isAnimating "bounce"}}'>`.trimStart();

      let result = parseCodeContent(diff);
      assert.strictEqual(result.code, expectedCode);
      assert.strictEqual(result.searchStartLine, 1);
      assert.strictEqual(result.searchEndLine, 2);
      assert.strictEqual(result.replaceStartLine, null);
      assert.strictEqual(result.replaceEndLine, null);
      assert.strictEqual(result.fileUrl, 'https://example.com/file.txt');
    });
  },
);
