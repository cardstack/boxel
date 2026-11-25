---
status: proposed
date: 2026-11-10
scope:
  - packages/realm-server/lib/realm-routing.ts
  - packages/realm-server/lib/realm-host-urls*.ts
  - packages/realm-server/handlers/handle-*host-url*.ts
  - packages/realm-server/handlers/handle-publish-realm.ts
  - packages/realm-server/handlers/handle-*boxel*domain*.ts
  - packages/realm-server/handlers/handle-delete-realm.ts
  - packages/realm-server/handlers/serve-index.ts
  - packages/realm-server/middleware/*.ts
  - packages/realm-server/server.ts
  - packages/postgres/migrations/*_add-realm-host-urls.js
  - packages/realm-server/routes.ts
  - packages/realm-server/handlers/handle-search.ts
  - packages/realm-server/lib/index-html-injection.ts
  - packages/runtime-common/index-runner/prerender-html-visit.ts
  - packages/runtime-common/index-writer.ts
  - packages/base/default-templates/head.gts
---

# 033. Map host URLs to a realm by its identity, and resolve them before any other route

A realm can be served live at one or more host URLs: a Boxel Space path, a
claimed site name, or a custom domain. A host URL is another address for the
realm itself, not a copy of it. The realm server stores each host URL against
the realm's registry id, and routes a request on one to that realm before any
other lookup. Ids stay canonical everywhere they are stored, but a realm's
prerendered HTML is rendered against its canonical host URL. This ADR records
where host URLs live, how a request finds its realm, which host URL is
canonical, what stored HTML names, and who may change them.

## 1. Decision

### 1.1. Host URLs are server data, keyed by the realm's identity

A host URL MUST be stored in `realm_host_urls` as a host and a path prefix. It
MUST name its realm by `realm_registry.id`, never by the realm's URL. A claim
that binds a site name to a realm MUST also name the realm by its id. A host
MUST be stored lower-cased, without a trailing dot or a default port, and a
path prefix MUST start and end with `/`, so that it contains only whole path
segments. A request's host and path MUST be compared in the same form. A host
and path prefix MUST map to at most one realm. A realm MAY have any number of
host URLs. Adding, removing or changing a host URL MUST NOT change any file in
the realm, `realm.json` included.

### 1.2. A host URL is resolved first, to the realm itself

Realm routing MUST resolve a request whose host and path fall under a host URL
to that host URL's realm, before it looks for a realm by URL. When more than
one host URL contains the request, the one with the longest path prefix MUST
win. The realm itself MUST answer the request, under its own permissions and
policy, which a host URL neither widens nor narrows. The realm server MUST NOT
copy a realm in order to serve it.

### 1.3. A change takes effect when its request returns

A change to a realm's host URLs MUST take effect on the process that made it
before the response is sent. The change MUST be announced to every other
process. A process that caches host URLs MUST drop a host's entries when a
change to that host is announced. It MUST NOT keep an entry for longer than a
fixed time without reading the table again, so a lost announcement cannot keep
a stale entry. A removed host URL MUST answer 404, and MUST NOT redirect.
When a removed host URL's address is also a published realm's URL, removing
the host URL MUST also remove that published realm, so that the lookup by URL
cannot serve it. Deleting a realm MUST delete its host URLs.

### 1.4. Exactly one host URL is canonical

A realm with any host URLs MUST have exactly one canonical host URL. The first
host URL added MUST be canonical. The canonical host URL MUST NOT be removed
while the realm has others: another one must be marked canonical first. A
page's canonical link, its `og:url` and the realm's sitemap MUST use the
canonical host URL, whichever host URL the request came in on. A request
for a page on any other host URL MUST be answered with a temporary redirect
to the same address on the canonical host URL, and MUST NOT be answered with
a permanent one. A request on such a host URL for anything other than a page
MUST be served there, as §1.5 says.

### 1.5. Ids stay canonical

A host URL MUST NOT replace the realm's URL in anything stored about the
realm: its registry row, its permissions, card ids, index rows, search
documents and files (ADR 002). Prerendered HTML is the one exception, as
§1.8 says. Code MUST translate between a host URL and the realm's URL only
where a request enters the realm server, where a response leaves it, or where
§1.8 renders HTML. A response on a host URL MUST name that host URL wherever
it would name the realm's URL or its canonical host URL, except as §1.4 says.
A response that serves a file's stored bytes, as a card-source read does,
MUST NOT be translated, so that a client that writes the file back writes
what the realm holds. A validator on a host URL MUST change when the
translation changes, so that a change to the canonical host URL is never
answered with a 304.

### 1.6. The realm's administrators manage its host URLs

Only a user with direct `write` permission on the realm, which makes them one
of its administrators (ADR 024 §1.3), MAY add or remove a host URL or mark one
canonical. A grant in the realm's policy MUST NOT admit these changes. A
Boxel Space host URL MUST be the realm's own name under its owner's Space. A
site name MUST be one the caller has claimed or one already bound to the
realm. A custom domain MUST be one the deployment allows for the realm.
The code that writes a host URL and the code that resolves one MUST read one
config of the domains a host URL can be on, so that every host URL a writer
accepts is one the resolver looks up.
A host URL MUST NOT be added to a realm whose home page a visitor who isn't
signed in can't read, or whose home card's code from the realm they can't
load. Mounting at a site name MUST bind its claim to the realm, and removing
that host URL, or deleting the realm, MUST free the site name for anyone to
claim.

### 1.7. A page on a host URL is server-rendered only where a visitor may read its card

A page on a host URL MUST serve a card's stored markup only when the realm
admits a read of that card by a visitor who isn't signed in, from the
visitor's address, and the card's type doesn't declare that markup
unshareable. The realm MUST decide that read, through its permissions and its
policy. The server MUST NOT evaluate a permission or a policy grant of its own
for it. Where the read is refused, the page MUST be served without the card's
markup and scoped CSS, and renders in the browser as the visitor. The realm's
routing rules MUST apply on a host URL whatever the realm's permissions, since
they are the site's addresses. A page on a host URL MUST name its address on
the canonical host URL in a canonical link and an `og:url` where its head
names none. Whether the realm's default index card is server-rendered MUST be
decided when the page is served, and MUST NOT be written into the realm. A
placeholder the prerenderer stores in place of that card's render MUST NOT be
served on a host URL.

### 1.8. Prerendered HTML is rendered against the canonical host URL

A realm with host URLs MUST store its prerendered HTML rendered against its
canonical host URL, so that the HTML names the canonical host URL wherever it
would name the realm's URL. A realm with no host URL MUST store it rendered
against the realm's URL. Everything else stored with the HTML, card ids and
dependencies among it, MUST keep the realm's URL (§1.5). When a realm gets
its first host URL, when its canonical host URL changes, and when its last
host URL is removed, the realm server MUST render the realm's HTML again.
The realm server MUST record, with the stored HTML, the URL it was rendered
against, so that a server that serves the HTML knows that URL after a restart,
and for HTML that a failed render kept. A response MUST translate from that
URL as well, so that every page stays right while the render runs. A response
that isn't on a host URL MUST name the realm's URL wherever stored HTML names
the canonical host URL in full, except as §1.4 says, so that the app links
into the realm, not to its site.

## 2. Rationale

Publishing a copy gave every site its own registry row, files, index and
Matrix user. A copy also had to drop the realm's policy, so that a grant could
not admit writes into a public site. Serving the realm itself removes the copy
and makes access on a site the same as in the app. The price is that a
half-finished edit is public as soon as it is saved.

The realm's URL can change while its registry id cannot, so the id is the key
that keeps a host URL attached to the right realm. A host URL lives in the
database rather than in the realm because the server must check it before
storing it: whether a site name is claimed, whether a domain is allowed. A
file in the realm can prove neither. Routing must also find a host URL before
it knows which realm to mount.

Host URLs are resolved first because, while v1 sites are migrated, an address
can be both a published copy's registry URL and a host URL for the copy's
source. Resolving the registry first would keep serving the copy. For the same
reason, removing such a host URL also removes the copy, or the lookup by URL
would serve the copy again instead of a 404.

Stored markup is rendered with the realm owner's authority, and a host URL
serves it to every visitor. Asking the realm for the visitor's own read keeps
one place where access is decided, so a realm opened by its policy is
server-rendered exactly where its visitors could read the cards anyway. A
host URL is the realm's site, so its routes are published addresses, not
something the realm's permissions hide.

Direct `write` already lets a user change the realm's `realm.json` and its
policy, so a user who holds it administers the realm (ADR 024 §1.3). Giving
host URLs to the same users lets a shared realm's administrators manage its
site without its owner.

No one can sign in on a host URL's origin, so every visitor there is
anonymous. A realm whose home page an anonymous visitor can't read would
answer every visitor with a refusal, so the realm server refuses to mount it
and names what is closed.

Prerendered HTML is rendered against the canonical host URL because a card's
template, not the server, writes most of the URLs in it, and it writes them
in forms a translation of the response can't find: a percent-encoded share
link, an escaped URL in JSON-LD, a root-relative path, or an address shown
without its scheme. Each of those is wrong only on a host URL, and nothing
reports it. Rendered against the canonical host URL, the template writes
them right. A change to the canonical host URL is a rare action by an
administrator, and page views never stop, so the cost belongs on the change:
one new render of the realm, as ADR 036 §1.7 puts the cost of a routed
address on the render rather than on each request. The translation stays for
JSON, and while a new render runs.

HTML rendered for one host URL is still wrong on another host URL whose path
prefix differs, because a root-relative path in it names the canonical
prefix. So a page on any host URL but the canonical one redirects to the
canonical one, as a site's other names usually do. The redirect is
temporary because another host URL can become canonical later. A browser can
keep a permanent redirect with no end, and the server can't withdraw it. A
visitor who kept a redirect from host URL B to A would then loop once A
becomes the one that redirects to B. The canonical link already gives each
page one address for search engines.

The realm's own URL also serves pages, and a path it names in a form the
translation can't find, such as a root-relative path, stays wrong there
until the app boots and renders the page again against the realm's URL.
That URL doesn't redirect to the canonical host URL as the others do,
because it is also where the app opens the realm.

The same path also stays wrong in the app's card grids. They show the stored
fitted and embedded HTML that `/_federated-search` returns, and a card that
doesn't hydrate never renders again in the app. So the path stays wrong
there until that card's HTML is rendered again.

## 3. Considered options

- **A stored mapping keyed by the registry id, resolved first (chosen).**
- **A registry row per host URL, as v1's published realms are.** Each address
  becomes a realm of its own, with its own identity, permissions and index.
  That is the copy this decision removes.
- **Host URLs in the realm's `realm.json`.** The server cannot trust a file to
  prove a claimed name or an allowed domain, and routing would have to read a
  realm to learn whether a host belongs to it.
- **Key host URLs by the realm's URL.** The mapping breaks when the realm's
  URL changes.
- **Route hosts in proxy or load-balancer configuration.** Each change becomes
  an infrastructure change that can't take effect when its request returns,
  and that realm-server tests cannot reach.
- **Only the realm's owner manages host URLs.** A shared realm would need its
  owner for every change to its site.
- **Warn, but mount a realm whose home page anonymous visitors can't read.**
  Without sign-in on a host URL's origin, such a site shows its visitors
  nothing.
- **Server-render a page on a host URL only when the realm has public read,
  as on the realm's own URL.** A realm opened only by its policy would never
  be server-rendered, though its visitors may read its cards.
- **Decide a page's readability in the server from the policy card.** That
  is a second evaluator of the policy, which can disagree with the realm's.
- **Store prerendered HTML with the realm's URL, and put the canonical host
  URL in when the response leaves the server.** No render is needed when the
  canonical host URL changes. But the translation finds only the URL as it
  is written in full, so a URL a template writes in another form stays wrong
  on a host URL. It also rewrites every page on every request, which is the
  work per request ADR 036 §3 rejects for routed addresses. The translation
  stays, for the uses §1.8 keeps.
- **Serve a page on every host URL, and render the HTML once for each host
  URL.** Each page is right on every host URL, but each render of the realm
  costs as many renders as it has host URLs, and the index stores as many
  copies of the HTML.
- **Serve a page on every host URL from the HTML rendered for the canonical
  one, and accept that some links are wrong there.** A root-relative link on
  a host URL whose path prefix differs goes to a page that doesn't exist,
  and nothing reports it.
- **Write `includePrerenderedDefaultRealmIndex` into `realm.json` when a host
  URL is added, as v1 publishing does.** That changes a file in the realm
  (§1.1).

## 4. Remediation

Known gaps are listed in [remediation/033.md](remediation/033.md).
