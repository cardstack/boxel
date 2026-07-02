describe('configs', () => {
  it('recommended is stable', () => {
    // if you change the list of recommended rules, make sure to release this
    // as a breaking change!!

    expect(require('./index').configs.recommended).toMatchInlineSnapshot(`
Object {
  "plugins": Array [
    "qunit-dom",
  ],
  "rules": Object {
    "qunit-dom/no-checked-selector": "error",
    "qunit-dom/no-ok-find": "error",
    "qunit-dom/require-assertion": "error",
  },
}
`);
  });
});
