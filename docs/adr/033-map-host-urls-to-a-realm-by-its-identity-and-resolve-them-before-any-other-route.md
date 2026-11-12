---
status: proposed
date: 2026-11-10
scope:
  - packages/realm-server/lib/realm-routing.ts
  - packages/realm-server/lib/realm-host-urls*.ts
  - packages/realm-server/handlers/handle-*host-url*.ts
  - packages/realm-server/handlers/handle-publish-realm.ts
  - packages/postgres/migrations/*_add-realm-host-urls.js
---

# 033. Map host URLs to a realm by its identity, and resolve them before any other route

A realm can be served live at one or more host URLs: a Boxel Space path, a
claimed site name, or a custom domain. A host URL is another address for the
realm itself, not a copy of it. The realm server stores each host URL against
the realm's registry id, and routes a request on one to that realm before any
other lookup. Ids stay canonical everywhere they are stored. This ADR records
where host URLs live, how a request finds its realm, which host URL is
canonical, and who may change them.

## 1. Decision

### 1.1. Host URLs are server data, keyed by the realm's identity

A host URL MUST be stored in `realm_host_urls` as a host and a path prefix. It
MUST name its realm by `realm_registry.id`, never by the realm's URL. A host
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
Deleting a realm MUST delete its host URLs.

### 1.4. Exactly one host URL is canonical

A realm with any host URLs MUST have exactly one canonical host URL. The first
host URL added MUST be canonical. The canonical host URL MUST NOT be removed
while the realm has others: another one must be marked canonical first. A
page's canonical link, its `og:url` and the realm's sitemap MUST use the
canonical host URL, whichever host URL the request came in on.

### 1.5. Ids stay canonical

A host URL MUST NOT replace the realm's URL in anything stored about the
realm: its registry row, its permissions, card ids, index rows, search
documents and files (ADR 002). Prerendered HTML is the one exception, and MAY
carry the canonical host URL. Code MUST translate between a host URL and the
realm's URL only where a request enters the realm server or a response leaves
it.

### 1.6. The realm's administrators manage its host URLs

Only a user with direct `write` permission on the realm, which makes them one
of its administrators (ADR 024 §1.3), MAY add or remove a host URL or mark one
canonical. A grant in the realm's policy MUST NOT admit these changes. A
Boxel Space host URL MUST be the realm's own name under its owner's Space. A
site name MUST be one the caller has claimed or one already bound to the
realm. A custom domain MUST be one the deployment allows for the realm.

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
source. Resolving the registry first would keep serving the copy.

Direct `write` already lets a user change the realm's `realm.json` and its
policy, so a user who holds it administers the realm (ADR 024 §1.3). Giving
host URLs to the same users lets a shared realm's administrators manage its
site without its owner.

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

## 4. Remediation

Known gaps are listed in [remediation/033.md](remediation/033.md).
