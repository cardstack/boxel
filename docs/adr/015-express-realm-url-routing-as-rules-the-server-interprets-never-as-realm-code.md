---
status: proposed
date: 2026-10-29
scope:
  - packages/base/realm-config.gts
  - packages/runtime-common/host-routing-validation.ts
  - packages/runtime-common/realm.ts
  - packages/realm-server/lib/realm-routing.ts
  - packages/realm-server/handlers/serve-index.ts
---

# 015. Express realm URL routing as rules the server interprets, never as realm code

A realm decides how its URLs map to cards: today through the host routing
rules in its `realm.json`, and later through richer features such as dynamic
path segments. The realm server reads those rules while it answers requests,
in the Node process that serves every realm, so it must not run code a
realm's author wrote. Each routing feature has to be expressed as rules the
server interprets itself: data, matched with bounded cost, and, where a rule
must compute, an expression run by a sandboxed interpreter. This ADR sets the rules
every realm routing feature must follow.

## 1. Decision

### 1.1. No realm code in a routing decision

A routing decision is any choice the realm server makes about a request from
a realm's routing configuration: which card to serve, whether to redirect, and
where. The realm server MUST NOT run JavaScript that a realm's author wrote to
make a routing decision. It MUST NOT `import` a realm module, or run authored
source through `eval`, `new Function`, `node:vm`, or a worker.

The prerender server is the service that runs card code in a headless
browser. It does two kinds of work. A **card visit** (`prerenderVisit`)
renders one card: its index visit writes the card's index row, and its HTML
visit renders the card's formats into prerendered HTML. A **module visit**
(`prerenderModule`) loads one module and reports its definitions, such as a
card type's fields. While a request waits, the realm server MUST NOT ask the
prerender server to run card code whose output makes a routing decision,
such as a routing function or a card visit. A request MAY wait on a module
visit for a type's definition, read through the definitions cache as a search
reads it.

### 1.2. Rules reach the server as data

The realm server MUST take routing rules as JSON data, read from `realm.json`
or its index entry. Card code MAY compute those rules in the card visit that
indexes `realm.json`.

The realm server MUST validate each rule every time it reads one, and MUST
drop a rule that fails. It MUST NOT trust the editor or the card code that
produced a rule to have validated it.

### 1.3. Bounded matching

The realm server MUST match a request path against authored patterns in time
linear in the lengths of the path and the patterns. It MUST NOT compile an
authored string with `new RegExp` or another backtracking engine. A dynamic
segment MUST match exactly one whole path segment. The realm server SHOULD cap
the number of rules it reads from one realm.

### 1.4. Computed rules

When a rule computes a value, such as the card ID a dynamic segment names, the
realm server MUST evaluate it in an interpreter that can do no I/O, that
bounds its cost, and that exposes no function that compiles an authored
pattern to a regular expression.

## 2. Rationale

One realm server process serves every realm on it. Code a realm's author
writes in that process can read other realms' files, the database and the
server's secrets, and can stall every realm the process serves. Card code
runs in the browser and the prerender server, which are built to contain it. The
realm server is not, and routing runs on its request path.

Authors still need routing that does more than map one path to one card, so
a rule may compute. Leaving out JavaScript does not make a computed rule safe
by itself: an interpreter that meters its own steps can still hand an
authored pattern to a backtracking engine, and step metering does not bound a
single match. BXL is an example. It does no I/O and meters its evaluation, but
its `test`, `match` and `LIKE` compile authored patterns for JavaScript's
`RegExp`. A routing feature that uses BXL has to run it under a profile that
excludes them.

Card code may compute the rules because the prerender server runs it, in the
card visit each time `realm.json` is indexed, and not while a request waits. A realm can make
`realm.json` adopt from its own card definition, or edit the file by hand, so
what reaches the realm server is data from an untrusted author. The server
validates it for that reason.

A module visit for a definition is different. What it reports describes a
type, and no authored code turns that into a routing decision: the rules
still decide. The definitions cache keeps the result, so a module is visited
once, not once for each request, and an author can't tie up the prerender
server with requests. A search waits on module visits for the same reason.

## 3. Considered options

- **Rules as data, with a sandboxed interpreter for computation (chosen).** The server interprets
  everything, and the cost of every rule is bounded.
- **Routing functions in card code, run in the realm server.** This is the
  most expressive option. A sandbox such as `node:vm` is not a security
  boundary, and isolating each realm in its own process would cost a process
  on every routed request.
- **Routing functions in card code, run in the prerender server.** The
  prerender server contains card code, but each request would wait on a
  browser render. That is slow, and an author could tie up the shared
  prerender server with requests to their own routes.
- **Authored regular expressions or path-to-regexp patterns.** Developers
  know these, but they compile to backtracking regular expressions, and one
  slow pattern can stall the server for every realm (ReDoS).
- **Rules only from `realm.json`'s stored attributes.** This keeps card code
  out of the rules entirely. It isn't needed for safety: the prerender
  server already contains card code, and the server validates what it produces.
- **Exact paths only.** This is safe, but it gives a realm no way to route a
  family of URLs, such as `/posts/:slug`, without a rule for each card.

## 4. Remediation

Known gaps are listed in [remediation/015.md](remediation/015.md).
