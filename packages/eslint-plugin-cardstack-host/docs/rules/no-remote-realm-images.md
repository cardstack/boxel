# Forbid pointing a realm iconURL or backgroundURL at an image host outside the allow-list (`@cardstack/host/no-remote-realm-images`)

💼 This rule is enabled in the ✅ `recommended` config.

<!-- end auto-generated rule header -->

`iconURL` and `backgroundURL` are the two realm-config fields the app renders as
an actual image — an `<img>` src or a CSS `background-image` — so a fixture that
names a remote host puts that host in the critical path of every Percy snapshot
which renders the realm.

Percy's discovery browser waits for every image the page references. A slow host
makes the snapshot slow; a host that stalls means the page `load` event never
fires, Percy retries the navigation three times, and the snapshot is dropped —
a silent loss, because the test that asked for it still passes and only a Percy
diff days later shows anything went wrong.

`allowed-hostnames` in `.percy.js` does **not** avoid this. It decides only
whether Percy stores the bytes; the browser waits either way. That is why the
fix for a slow host is to stop referencing it, not to configure Percy
differently.

A value counts as remote however it is spelled. Two separators reach a third
party with no scheme at all, because the browser borrows the page's, and the URL
parser treats a backslash as a slash after a special scheme — so `//host`,
`\\host`, `\/host` and `/\host` are all remote, while a single separator
resolves against the page's own origin and is not. Surrounding whitespace is
ignored, since browsers strip it before fetching.

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

The default is deliberately shorter than `allowed-hostnames` in `.percy.js`, and
the two answer different questions. Percy's list says which hosts it may capture
assets from, and includes the S3 bucket that serves brand assets to product
cards. This one says which hosts a realm's icon or background may name, and no
realm image is served from that bucket; listing it here would bless a host for a
purpose nothing uses it for. Add it if a realm image ever needs it.

What earns a host a place on this list is that it is ours, so that when it is
slow it is ours to fix. It is not that the mechanism above stops applying — the
discovery browser waits for `boxel-images.boxel.ai` exactly as it waits for
anything else. For product code and for the defaults real workspaces are created
with, a remote CDN is the right answer regardless. For a fixture, a local path
under `packages/host/public/test-fixtures/realm-images/` is better still, because
there is nothing to wait for at all.

## When Not To Use It

If you are adding a realm image on a host we control that is not yet listed, add
it to `allowedHosts` rather than disabling the rule.

## Limitations

ESLint only sees JavaScript and TypeScript, so a realm config written as a
standalone `realm.json` fixture — `packages/test-realm-cards/contents/realm.json`,
for instance — is not covered.
