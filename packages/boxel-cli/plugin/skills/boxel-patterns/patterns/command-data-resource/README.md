---
validated: source-proven
---

# command-data-resource — Call a host Command reactively via `commandData<T>`

**What this gives you:** A way to invoke any `@cardstack/boxel-host/tools/*` Command from inside a Glimmer component and have the result render reactively, with built-in `isSuccess` / `cardResult` / `cardError` state. No manual `restartableTask` + `@tracked` plumbing.

**When to use:** A component needs the result of a host Command (e.g. `GetAllRealmMetas`, `SearchCardsByQuery`, anything from boxel-host) and wants the template to react when the result resolves or fails.

**The insight:** `commandData<T>` is an `ember-resources` resource that wraps a Command, invokes it on mount, and exposes the result as tracked state. Type the result with `typeof YourResultCardDef`, then read `resource.cardResult` (already typed). It supersedes the older pattern of writing `restartableTask` + `@tracked result` by hand.

**Recipe shape:**

```ts
import { commandData } from 'https://cardstack.com/base/resources/command-data';
import GetAllRealmMetasCommand from '@cardstack/boxel-host/tools/get-all-realm-metas';
import type { GetAllRealmMetasResult } from 'https://cardstack.com/base/command';

class MyComponent extends Component<typeof MyCard> {
  realmsResource = commandData<typeof GetAllRealmMetasResult>(
    this,
    GetAllRealmMetasCommand,
  );

  get realms() {
    let r = this.realmsResource;
    if (r?.isSuccess && r.cardResult) {
      return (r.cardResult as GetAllRealmMetasResult).results ?? [];
    }
    return [];
  }
}
```

**Gotchas:**
- The result type lives at `https://cardstack.com/base/command` — `import type { … }` not a regular import.
- Cast `cardResult` to the specific result type — TypeScript can't infer past the generic.
- The resource starts running on mount; if you want to defer, gate it with `@tracked` arguments inside an `input()` callback (see `ember-resources` docs).
- For commands that take args, use the function form: `commandData(this, MyCommand, () => ({ arg: this.foo }))`.

**Source:** `boxel-catalog/catalog-app/listing/listing.gts:75-78`.

**See also:** `command-with-skill-card-ref`, `command-typed-with-progress`, `references/libraries.md`.
