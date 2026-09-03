# Realm fixture images

Background and icon images for the fake realms that host tests set up. They are
served from `public/` so a fixture can name them with a root-relative URL and
the browser resolves them against whatever origin the host is running on —
testem in CI, the dev server locally.

## Why these are local rather than remote URLs

Percy re-renders each snapshot in a discovery browser to collect its assets.
That browser waits for every image the page references, and `.percy.js`'s
`allowed-hostnames` does not change it — the list only decides whether Percy
keeps the bytes that come back. A remote host is therefore paid for twice over
however it is configured: latency on every snapshot, and, when it stalls, a
navigation that never fires `load`, which Percy retries three times before
dropping the snapshot. That loss is silent, because the test that asked for the
snapshot still passes; it surfaces days later as a Percy diff.

Nothing here is fetched over the network, which leaves that failure nothing to
act on. `@cardstack/host/no-remote-realm-images` enforces it for `iconURL` and
`backgroundURL`, the two realm-config fields the app renders as an image.

## Where a root-relative URL resolves, and where it does not

These paths have no origin, so they resolve against whichever origin the page
is on. That is what makes them work for the realms host tests build in the
browser: the page is testem, and testem serves `dist/`, which is where
`public/` lands.

It is also why they are only for those realms. A realm served by a real realm
server — `packages/test-realm-cards`, the dev stack, anything published — puts
the page on the realm server's origin, and the realm server serves HTML and
realm contents, not the host's static assets, so `/test-fixtures/…` 404s there.
Those realms use an absolute URL on `boxel-images.boxel.ai`, which is ours and
resolves from anywhere; `runtime-common/realm-display-defaults.ts` is the
existing list to pick from.

## These ship in production builds

`public/` is Vite's default `publicDir`, so everything in it is copied into
`dist/`. The production build drops this directory (see the
`exclude-test-fixtures-from-production` plugin in `packages/host/vite.config.mjs`)
because no production code path requests these images; the development build
that testem runs against keeps them.

## Provenance

| file                                           | dimensions |
| ---------------------------------------------- | ---------- |
| `boxel-logo.png`                               | 471×500    |
| `letter-a.png`                                 | 128×128    |
| `letter-c.png`                                 | 128×128    |
| `letter-t.png`                                 | 128×128    |
| `4k-origami-flock.jpg`                         | 1062×800   |
| `4k-powder-puff.jpg`                           | 1062×800   |
| `4k-watercolor-splashes.jpg`                   | 1062×800   |
| `pawel-czerwinski-h-Nrd99q5pe-I-unsplash.jpg`  | 1200×800   |
| `pawel-czerwinski-Ly-ZLa-A5jti-Y-unsplash.jpg` | 1200×800   |

The two `pawel-czerwinski-*` files keep the photographer's name from their
original Unsplash download filename. The `4k-` names came with those images and
are inaccurate — none of them is 4K — but they are the names the fixtures refer
to them by.
