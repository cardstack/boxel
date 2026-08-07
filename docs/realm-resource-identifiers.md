# Realm Resource Identifiers

Every card instance, module, and file in Boxel is named by a **Realm Resource
Identifier** (RRI). An RRI comes in two spellings:

- **prefix form** — `@cardstack/base/card-api`, `@cardstack/catalog/Listing/blog-app`
- **URL form** — `https://app.boxel.ai/experiments/Author/1`

Both are RRIs. Prefix form is an abstract name for a resource in a well-known
realm; URL form names a resource by where it is actually served. Which one a
realm uses is a property of that realm's registration, not of the resource.

The types live in `packages/runtime-common/realm-identifiers.ts`:

```typescript
type RealmResourceIdentifier = string & { __rriBrand: unknown };
type RealmIdentifier = string & { __riBrand: unknown };
```

They are branded strings — no runtime wrapper, just a compile-time marker that
says "this string is an identifier, not a URL." A `RealmIdentifier` names a
realm itself and always ends in a slash (`@cardstack/base/`,
`https://app.boxel.ai/experiments/`); a `RealmResourceIdentifier` names
anything inside one. The `rri()` and `ri()` helpers brand a string at a
boundary where you know the value is already valid.

The brand exists to catch the mistake it is named for: **an RRI is not a URL,
and must not be passed to `new URL()`.** `new URL('@cardstack/base/card-api')`
throws. Resolution goes through the VirtualNetwork.

## Why prefix form

A prefix-form identifier is portable across environments. The catalog realm is
served at `http://localhost:4201/catalog/` in development,
`https://realms-staging.stack.cards/catalog/` in staging, and
`https://app.boxel.ai/catalog/` in production, but a card that links to
`@cardstack/catalog/Skill/skill-pirate-speak` resolves correctly in all three.
Card JSON written in one environment can be copied to another; an import
specifier in a `.gts` module means the same thing everywhere.

The base realm reached the same portability earlier by a different route: its
modules were addressed as `https://cardstack.com/base/…`, a URL that never
existed and was rewritten to the real base realm URL by the VirtualNetwork.
That form still resolves (see [Compatibility with the base-realm
alias](#compatibility-with-the-base-realm-alias)), but it is misleading —
nothing is served there — and it required every consumer to know about the
rewrite. Prefix form makes the abstraction explicit.

## Registering a prefix

A prefix only exists because a `VirtualNetwork` was told about it:

```typescript
virtualNetwork.addRealmMapping(
  '@cardstack/catalog/',
  'http://localhost:4201/catalog/',
);
```

`addRealmMapping` normalizes both sides to a trailing slash and registers the
pair for both module loading (`resolveImport`) and identifier resolution
(`toURL`, `unresolveURL`, `resolveRRI`, `isRegisteredPrefix`). Mappings are
per-`VirtualNetwork` instance, not global — two VirtualNetworks in the same
process see different prefix sets, which is what lets tests register a
throwaway prefix and drop it again with `removeRealmMapping`.

Registration happens in two places:

- **Host** — `packages/host/app/services/network.ts` registers
  `@cardstack/base/` plus whichever of `@cardstack/catalog/`,
  `@cardstack/skills/`, and `@cardstack/openrouter/` the build config resolves.
- **Realm server and workers** — `main.ts` and `worker.ts` translate each
  `--fromUrl` / `--toUrl` pair on the command line. A `--fromUrl` that is not
  URL-shaped becomes a realm mapping directly:

  ```
  --fromUrl='@cardstack/catalog/' --toUrl="${CATALOG_REALM_URL}"
  ```

Prefixes are a convention, not a registry: `@cardstack/<realm>/` maps to
`<realm-server>/<realm>/`. `boxel-cli` relies on exactly this convention to
resolve an RRI against the active profile's realm-server URL without consulting
a VirtualNetwork at all (`packages/boxel-cli/src/lib/resolve-realm-identifier.ts`).

Realms with no registered prefix — most user workspaces — are addressed by
their URL, and that URL is their RRI. Nothing about the identifier system
requires a realm to have a prefix.

## Resolution

`VirtualNetwork.resolveRRI(reference, relativeTo?)` turns any reference into an
absolute RRI. It never produces a URL from a prefix — resolution stays in
whichever space the base is in.

| Reference                 | `relativeTo`                           | Result                                       |
| ------------------------- | -------------------------------------- | -------------------------------------------- |
| `@cardstack/base/string`  | —                                      | `@cardstack/base/string` (already absolute)  |
| `@cardstack/base/string`  | `@cardstack/catalog/`                  | `@cardstack/base/string` (base ignored)      |
| `http://example.com/card` | anything                               | `http://example.com/card` (already absolute) |
| `./string`                | `@cardstack/base/card-api`             | `@cardstack/base/string`                     |
| `card`                    | `@cardstack/base/card-api`             | `@cardstack/base/card`                       |
| `../card`                 | `@cardstack/base/fields/number`        | `@cardstack/base/card`                       |
| `./card`                  | `https://example.com/realm/`           | `https://example.com/realm/card`             |
| `$REALM/string`           | `@cardstack/base/fields/number`        | `@cardstack/base/string`                     |
| `$REALM/card`             | `https://home.boxel.ai/contact/users/` | `https://home.boxel.ai/contact/card`         |
| `/string`                 | anything                               | throws                                       |
| `~/card`                  | anything                               | throws                                       |

`$REALM/` resolves against the root of the realm the base belongs to, which is
how a card in a subdirectory refers to a sibling at the realm root without
counting `../` segments. Against a URL-form base it needs a registered realm
mapping to know where that realm's root is, and throws if none matches.

`/`-rooted and `~/` references are rejected because they have no meaning in
prefix space. (`VirtualNetwork.resolveURL` does accept a `/`-rooted reference,
because it is producing a URL and can join against the mapped realm URL — but
that is a URL operation, not RRI resolution.)

Relative resolution against a prefix-form base round-trips through URL space
internally: the base's prefix is swapped for its mapped URL, `new URL()` does
the path math, and the result is converted back to whichever prefix matches. A
reference that resolves outside every mapped realm comes back in URL form.

There is also a VirtualNetwork-free resolver, `resolveRRIReference` in
`packages/runtime-common/url.ts`, which does the same path math using a
synthetic origin instead of a real mapping. Serialization uses it, because
identifiers arriving there are already canonical and only need joining — see
[Resolution belongs at the network boundary](#resolution-belongs-at-the-network-boundary).

## Converting between forms

`VirtualNetwork` owns every conversion:

| Method                    | Direction               | Use                                                                                                                                    |
| ------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `toURL(rri)`              | RRI → `URL`             | Resolve a prefix through its mapping, or parse a URL-form RRI. Throws for an unmapped bare identifier.                                 |
| `toURLHref(rri)`          | RRI → `string`          | Same resolution, memoized, no `URL` object allocated.                                                                                  |
| `toRealURLHref(id)`       | any spelling → `string` | The canonical store key. Also collapses a virtual alias onto its real backing URL, so every spelling of one card converges on one key. |
| `unresolveURL(url)`       | URL → RRI               | The inverse: rewrite a URL back to prefix form when a mapping matches. Chases through URL aliases first.                               |
| `unresolveURLs(urls)`     | URL[] → RRI[]           | Canonicalize and dedupe a set (dependency lists, etc.).                                                                                |
| `equivalentURLForms(url)` | URL → string[]          | Every known spelling of one resource — used to match index data written before a reference was canonicalized.                          |
| `knownRealms()`           | —                       | The registered `RealmIdentifier`s.                                                                                                     |
| `isRegisteredPrefix(ref)` | —                       | Whether a reference starts with one of this VN's prefixes.                                                                             |

`toURLHref`, `unresolveURL`, and `toRealURLHref` are memoized because module
graph walks and per-instance realm-membership checks resolve the same handful
of identifiers thousands of times per render. The memos are a pure function of
the registered mappings, so adding or removing any mapping clears all three.
Consumers that key their own caches by resolved form can subscribe to
`onMappingChange` to invalidate alongside them.

## Resolution belongs at the network boundary

The rule the runtime is built around: **inside the runtime, identifiers stay in
canonical RRI form; the VirtualNetwork resolves them to real URLs immediately
before `fetch`.** Everything in between treats an RRI as an opaque string —
compared, keyed, stored, and passed along without being parsed.

Practical consequences:

- Don't call `new URL(id)` on a card id or module reference. If you need to
  compare two identifiers, compare them as strings, or use `RealmPaths`.
- Don't thread a `VirtualNetwork` into rendering, serialization, or store code
  to resolve something. Reaching for VN at an in-memory site is a signal that
  resolution is happening at the wrong layer.
- Serialization writes RRI form. Deserialization canonicalizes to RRI on entry,
  which is what makes the rule hold for data arriving from the network.

`VirtualNetwork.fetch` accepts an RRI directly, so callers never need to
pre-resolve:

```typescript
await virtualNetwork.fetch('@cardstack/base/_search?…');
```

Realm request handling accepts RRI-form identifiers where clients send them for
the same reason — a client shouldn't have to know a realm's serving URL to
reference a card in it. Atomic-operation hrefs are the clearest example: the
realm resolves a registered prefix to a real URL before doing path math, and
leaves plain URL and relative hrefs untouched.

## RealmPaths

`RealmPaths` (`packages/runtime-common/paths.ts`) does realm-membership and
local-path math, and works in either space. Its constructor takes either a
`URL` or a `RealmIdentifier`:

```typescript
new RealmPaths(new URL('http://localhost:4201/catalog/'));
new RealmPaths(ri('@cardstack/catalog/'));
```

The URL-producing methods — `fileURL`, `directoryURL`, and `local` with a `URL`
argument — throw on an identifier-based instance, because a prefix has no URL
of its own. The RRI methods work on both:

| Method                | Purpose                                        |
| --------------------- | ---------------------------------------------- |
| `inRealm(rri \| URL)` | Membership test                                |
| `local(rri)`          | Strip the realm prefix, yielding a `LocalPath` |
| `fileRRI(local)`      | Join realm identifier + local path             |
| `directoryRRI(local)` | Same, with a trailing slash                    |
| `realmId`             | The realm's own `RealmIdentifier`              |

`inRealm` is a string prefix match, which handles same-form comparisons
(prefix against prefix, URL against URL) with no resolution at all. For
cross-form comparisons — a URL-form card id against a prefix-form realm — it
needs a `VirtualNetwork`, passed as the optional second constructor argument.
Without one, cross-form membership returns `false`. This is the one place
resolution legitimately reaches inside the runtime, and it is why so many call
sites hand `RealmPaths` a VN.

## Where RRIs show up

**Module imports.** Card and field definitions import from the base realm by
prefix:

```typescript
import { CardDef, field, contains } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
```

`tsconfig.json` maps `@cardstack/base/*` onto `packages/base/*` so the
type-checker follows the same names the runtime does.

**Code refs.** A `ResolvedCodeRef`'s `module` is an RRI:

```json
{
  "codeRef": {
    "module": "@cardstack/catalog/commands/listing-create",
    "name": "default"
  }
}
```

The well-known base refs are built from the `@cardstack/base/` prefix in
`packages/runtime-common/constants.ts` (`baseCardRef`, `specRef`,
`skillCardRef`, …), so they match what `identifyCard` emits for base classes.

**Card JSON.** `data.id`, `meta.adoptsFrom.module`, `links.self`, and
relationship links are all RRIs. (`meta.realmURL` is the exception: it carries
the realm's served URL, not its prefix.) Within a realm they are usually
written relative (`./sibling`, `../Model/abc`) and resolved against the
document's own id; cross-realm references are absolute, in whichever form that
realm uses:

```json
"shortcutSettings.1.requiredSkills.0": {
  "links": { "self": "@cardstack/catalog/Skill/skill-pirate-speak" }
}
```

**Search.** Instance `id` and `url` filters are matched in canonical RRI form
on both sides — the index query engine server-side and the client-side filter
matcher — with `equivalentURLForms` bridging index rows written under an older
spelling.

**CLI.** `boxel` commands accept RRIs wherever they accept a URL:
`boxel file read @cardstack/catalog/blog-app/blog-app.gts`.

## Compatibility with the base-realm alias

`https://cardstack.com/base/` remains registered as a secondary alias for the
base realm, and is expected to stay registered indefinitely: user data outside
this repository holds URL-form base references, and that trail outlives any
in-repo conversion.

The realm server bridges the two automatically. When a `--fromUrl` matches
`https://cardstack.com/<realm>/`, it registers both the URL alias
(`addURLMapping`) and the corresponding `@cardstack/<realm>/` realm mapping, so
`unresolveURL` canonicalizes either spelling to the same RRI. That matters for
cross-process cache keys — the host writes definition-cache entries keyed by
RRI form during prerender, and the realm server reads them back.

Catalog, skills, and openrouter boot prefix-first; base still boots with the
URL alias as its serving identity, with `@cardstack/base/` registered
alongside.

Two lint rules keep the URL form from creeping back into source:

- `@cardstack/boxel/no-url-form-base-imports` flags (and auto-fixes)
  `https://cardstack.com/base/…` in static imports, dynamic `import()`, and
  `loader.import()`. It deliberately ignores the URL in fetch targets, alias
  registration, and tests that assert on served content — those are legitimate.
- `@cardstack/boxel/no-literal-realm-urls` flags environment-specific realm
  URLs (`http://localhost:4201/catalog/`, `https://app.boxel.ai/catalog/`, …)
  that should be written as the prefix instead.

## Migrating existing realm data

Realm content that predates prefix form is converted on disk rather than in the
database — a converted realm is reindexed, which rewrites the index rows from
the new source of truth.

`packages/realm-server/scripts/migrate-realms-to-rri.sh` is the wrapper to
reach for. It converts virtual-alias references to prefix form across realm
directories:

```bash
# Preview against every live realm tree under /persistent
./migrate-realms-to-rri.sh --dry-run --json-only --persistent /persistent

# Apply to card JSON
./migrate-realms-to-rri.sh --json-only --persistent /persistent

# Rewrite .gts/.ts import specifiers as a separate pass
./migrate-realms-to-rri.sh --modules-only --persistent /persistent
```

`--persistent <root>` targets exactly the realm directories the server mounts,
so the run never descends into backups or decommissioned trees. Every run
writes a unified diff to a `.patch` file, so a conversion can be rolled back
with `patch -R -p0 < <name>.patch`, and changed JSON is re-parsed afterwards to
confirm the replacement left it valid.

The underlying `migrate-realm-references.sh` does one find/replace pair and
takes `-e <environment> -r <realm>` shortcuts for the common case of converting
an environment-specific realm URL to its `@cardstack/<realm>/` prefix.
