# Realm fixture images

Background and icon images for the fake realms that host tests set up. They are
served from `public/` so a test fixture can name them with a root-relative URL
and the browser resolves them against whatever origin the host is running on —
testem in CI, the dev server locally.

## Why these are not remote URLs

They used to be, on `i.postimg.cc`, which put a third party in the critical
path of every Percy snapshot that renders a workspace.

Percy re-renders each snapshot in a discovery browser to collect its assets.
That browser loads the page, the page references the image, so the browser
waits for it — and `allowed-hostnames` does not change that. All the allow-list
decides is whether Percy _stores_ what comes back. A slow host is therefore
paid for twice over, either way it is configured: seconds of latency on every
snapshot, and, when it stalls outright, a navigation that never fires `load`,
which Percy retries three times before dropping the snapshot entirely.

This was measured rather than assumed. On a branch that removed
`i.postimg.cc` from `allowed-hostnames` and changed nothing else, a snapshot
was still lost, and the timeout still named that host's URL as the request it
was waiting on.

So the allow-list is not the lever. Not referencing a slow host is. Nothing
here is fetched over the network, which leaves the failure nothing to act on.

Please do not replace these with remote URLs, and do not add an image host to
`allowed-hostnames` in `.percy.js` to make a fixture work.

## Where a root-relative URL does and does not resolve

These paths have no origin, so they resolve against whichever origin the page
is on. That is what makes them work for the realms host tests build in the
browser: the page is testem, and testem serves `dist/`, which is where `public/`
lands.

It is also why they are only for those realms. A realm served by a real realm
server — `packages/test-realm-cards`, the dev stack, anything published — puts
the page on the realm server's origin, and the realm server serves HTML and
realm contents, not the host's static assets, so `/test-fixtures/…` would 404
there. Realms like that should use an absolute URL on `boxel-images.boxel.ai`,
which is ours and resolves from anywhere; `runtime-common/realm-display-
defaults.ts` is the existing list to pick from.

## Provenance

Byte-for-byte copies of what the fixtures used to fetch, so vendoring them
changed no snapshot. The two `pawel-czerwinski-*` files keep the photographer's
name from their original Unsplash download filename.

| file                                           | dimensions | was                                                |
| ---------------------------------------------- | ---------- | -------------------------------------------------- |
| `boxel-logo.png`                               | 471×500    | `i.postimg.cc/L8yXRvws/icon.png`                   |
| `letter-a.png`                                 | 128×128    | `i.postimg.cc/BZwv0LyC/A.png`                      |
| `letter-c.png`                                 | 128×128    | `i.postimg.cc/zXsXLmqb/C.png`                      |
| `letter-t.png`                                 | 128×128    | `i.postimg.cc/Rq550Bwv/T.png`                      |
| `4k-origami-flock.jpg`                         | 1062×800   | `i.postimg.cc/NjcjbyD3/4k-origami-flock.jpg`       |
| `4k-powder-puff.jpg`                           | 1062×800   | `i.postimg.cc/4ycXQZ94/4k-powder-puff.jpg`         |
| `4k-watercolor-splashes.jpg`                   | 1062×800   | `i.postimg.cc/qv4pyPM0/4k-watercolor-splashes.jpg` |
| `pawel-czerwinski-h-Nrd99q5pe-I-unsplash.jpg`  | 1200×800   | `i.postimg.cc/tgRHRV8C/…`                          |
| `pawel-czerwinski-Ly-ZLa-A5jti-Y-unsplash.jpg` | 1200×800   | `i.postimg.cc/VNvHH93M/…`                          |

The `4k-` names came with the originals and are inaccurate — none of those
images is 4K. They are kept so each file is still traceable to the URL it
replaced.

## Two URLs that were already dead

`i.postimg.cc/W4fZgT3j/icon.png` and
`i.postimg.cc/4xyCDpGq/pawel-czerwinski-5n-L-IMto-KEw-unsplash.jpg` — the icon
and background of "Read Only Workspace" in `card-copy-test.gts` — had been
removed from the host. Both returned the same 320×320 "image not found or was
removed" placeholder, so that workspace had been rendering postimg's error
graphic in Percy, which also meant a third party controlled what those
baselines looked like.

They are not vendored. The same file configures the same workspace a second
time with working values, so the dead pair was pointed at those instead:
`pawel-czerwinski-h-Nrd99q5pe-I-unsplash.jpg` and the boxel logo. Those two
snapshots therefore do change — from postimg's error graphic to the images the
fixture was meant to have.
