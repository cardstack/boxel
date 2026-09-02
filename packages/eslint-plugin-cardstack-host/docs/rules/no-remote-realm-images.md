# Forbid pointing a realm iconURL or backgroundURL at an image host outside the allow-list (`@cardstack/host/no-remote-realm-images`)

💼 This rule is enabled in the ✅ `recommended` config.

<!-- end auto-generated rule header -->

`iconURL` and `backgroundURL` are the two realm-config fields the app renders as
an actual image — an `<img>` src or a CSS `background-image` — so a fixture that
names a remote host puts that host in the critical path of every Percy snapshot
which renders the realm.

That is not a theoretical cost. Test fixtures pointed at `i.postimg.cc` for a
long time, and Percy's discovery browser waits for every image the page
references. When the host answered slowly the snapshot was slow; when it stalled
the page `load` event never fired, Percy retried the navigation three times, and
the snapshot was dropped — a silent loss, since the test itself still passed.
One `main` build lost nine snapshots that way.

Note that `allowed-hostnames` in `.percy.js` does **not** avoid this. It decides
only whether Percy stores the bytes; the browser waits either way.

## Rule Details

Examples of **incorrect** code for this rule:

```js
realmConfigCardJSON({
  name: 'Test Workspace B',
  iconURL: 'https://i.postimg.cc/L8yXRvws/icon.png',
  backgroundURL: 'https://example.com/background.jpg',
});

// Protocol-relative counts as remote: the browser borrows the page's scheme
// and makes the same third-party request. Only the single-slash form is local.
realmConfigCardJSON({
  iconURL: '//i.postimg.cc/L8yXRvws/icon.png',
});
```

Examples of **correct** code for this rule:

```js
// Served from packages/host/public/, so nothing is fetched over the network.
realmConfigCardJSON({
  name: 'Test Workspace B',
  iconURL: '/test-fixtures/realm-images/boxel-logo.png',
  backgroundURL: '/test-fixtures/realm-images/4k-powder-puff.jpg',
});

// Our own image CDN, which real workspaces are created against.
realmConfigCardJSON({
  iconURL: 'https://boxel-images.boxel.ai/icons/cardstack.png',
});
```

A value the rule cannot resolve statically — a function call, a template with an
expression, a constant imported from another module — is left alone rather than
guessed at.

## Options

- `allowedHosts` (`string[]`, defaults to `['boxel-images.boxel.ai']`) — hosts a
  realm image may be served from.

## When Not To Use It

If you are adding a realm image on a host we control that is not yet listed, add
it to `allowedHosts` rather than disabling the rule.

## Limitations

ESLint only sees JavaScript and TypeScript, so a realm config written as a
standalone `realm.json` fixture — `packages/test-realm-cards/contents/realm.json`,
for instance — is not covered.
