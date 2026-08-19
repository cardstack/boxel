## Importing runtime helpers from `@cardstack/runtime-common`

The `@cardstack/runtime-common` package exposes its surface at two granularities:

1. **The bare module ID** — `import { Loader, baseRealm, ... } from '@cardstack/runtime-common'`. Eagerly bundled in the host. Stable, broad, always available.
2. **Subpath modules** — `import { markdownToHtml } from '@cardstack/runtime-common/marked-sync'`. Lazy-loaded so heavy deps (markdown parser, DOMPurify, etc.) don't bloat the eager host bundle for cards that don't use them.

**Subpath exports are NOT re-exported from the bare module.** Common subpaths and the names they expose:

| Subpath | Useful exports |
|---|---|
| `@cardstack/runtime-common/marked-sync` | `markdownToHtml`, `preloadMarkdownLanguages`, `wrapTablesHtml` |

If you reach for a subpath-only export on the bare module — a common slip when a name is "almost" on the right module — the runtime catches the mismatch at module-load time and surfaces a tight `ReferenceError` that names both the missing export and the source module. So a wrong import path is visible immediately, with an actionable message, instead of producing a confusing downstream `TypeError` from inside Glimmer's helper-encoder.

When in doubt: **prefer the subpath import** for anything that isn't a core runtime utility. If you reach for a name from the wrong `@cardstack/runtime-common` module, the runtime error will tell you which export is missing from which module.

(Background: in standard ESM, a named-import mismatch fails at module-link time and you'd see the error immediately. Cardstack's realm loader uses an AMD-style transform under the hood, which historically turned missing-export mismatches into silent `undefined` bindings that failed later. The current runtime restores the link-time-error behavior for shimmed modules.)

## Async loading external CDN libraries

**Async loading pattern:**
```gts
import { task, restartableTask, timeout } from 'ember-concurrency';
import Modifier from 'ember-modifier';

private loadLibrary = task(async () => {
  const script = document.createElement('script');
  script.src = 'https://cdn.../library.js';
  await new Promise((resolve, reject) => {
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
});
```

**Key Rules:**
1. Use Modifiers for DOM access
2. Use ember-concurrency tasks for async
3. Bind external data to model fields
4. Provide loading states

**Task types:**
- `task` - Concurrent execution
- `restartableTask` - Cancel previous, start new
- `enqueueTask` - Sequential queue
- `dropTask` - Ignore new while running

## Async loading from within components

For fetching data from external APIs, use `ember-concurrency`. The core of this principle are "tasks", which are a cancelable alternative to promises. The most used ones are `task`, and `restartableTask`:

- task: Tasks run concurrently without any coordination, allowing multiple instances to execute simultaneously.
- restartableTask: Cancels any running task and immediately starts a new one when performed, ensuring only the latest task runs.
- enqueueTask: Queues tasks to run sequentially one after another, ensuring no overlap but preserving all tasks.
- dropTask: Ignores new task requests while one is already running, preventing any additional instances from starting.
- keepLatest: Drops intermediate queued tasks but keeps the most recent one to run after the current task completes.

Here is an example where we are:
- loading data when component is first rendered, 
- reloading it when user clicks on a button,
- adding some artificial delay using `await timeout(ms)` from `ember-concurrency`. Caution:  do not use `setTimeout`.

Do not import `perform` from `ember-concurrency/helpers/perform`; that subpath is not fetchable in realms. Also do not use `(perform this.taskName)` directly in strict-mode templates. Define a synchronous local handler that calls `.perform()`, then bind that handler with `{{on}}`.

```
import { CardDef, field, contains, Component } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { tracked } from '@glimmer/tracking';
import { restartableTask, timeout } from 'ember-concurrency';
import { Button } from '@cardstack/boxel-ui/components';
import { on } from '@ember/modifier';

export class CurrencyLoader extends CardDef {
  static displayName = 'Currency Loader';
  
  @field loadingStatus = contains(StringField);
  @field currencies = contains(StringField);
  
  static isolated = class Isolated extends Component<typeof this> {
    constructor(owner: any, args: any) {
      super(owner, args);
      this.loadCurrencies.perform();
    }
    
    private loadCurrencies = restartableTask(async () => {
      this.args.model.loadingStatus = 'Loading...';
      const response = await fetch('/api/currencies');
      await timeout(1000); // Visual feedback
      
      this.args.model.currencies = await response.json();
      this.args.model.loadingStatus = "";
    });

    startLoadCurrencies = () => {
      this.loadCurrencies.perform();
    };
    
    <template>
      <div>
        <p>Status: {{@model.loadingStatus}}</p>
        <p>Data: {{@model.currencies}}</p>
        
        <Button {{on 'click' this.startLoadCurrencies}}>
          Reload Currencies
        </Button>
      </div>
    </template>
  };
}
```

## Critical pitfall: never `await` a task from outside the task

Inside an ember-concurrency task body, `await` is **syntactic sugar for `yield`**. A Babel transform turns the async arrow into a generator under the hood, which is what lets the runtime cancel it between yields. That cancelability is the entire reason to use `restartableTask`, `dropTask`, `enqueueTask`, etc.

Outside a task body, `await` is plain JavaScript and has no notion of cancelation. So this is wrong:

```ts
// ⚠️ WRONG — `await` here downcasts the cancelable TaskInstance to a Promise
async fetchResults() {
  let results = await this.queryServer.perform();
  this.results = results;
}
```

`queryServer.perform()` returns a `TaskInstance`. The moment you `await` it (or call `.then()` on it) from a non-task context, you've cast it to a Promise — and Promises cannot be canceled. If `queryServer` is then canceled (a restart, a drop, the component being torn down, the route changing), the cancelation surfaces as a `TaskCancelation` rejection in your logs, and the outer function treats it as a real error.

Reaching for `try/catch` with `didCancel(e)` to swallow the rejection technically silences the log, but it's exactly the cluttered defensive code that ember-concurrency was built to eliminate.

**The fix: keep the call inside a task.** Promote the caller to a task too, and call that top-level task from a synchronous local handler:

```gts
import { task, timeout } from 'ember-concurrency';
import { on } from '@ember/modifier';
import { tracked } from '@glimmer/tracking';

@tracked results = null;

queryServer = task(async () => {
  await timeout(10000);
  return 123;
});

// ✅ caller is also a task — `await` here is sugar for `yield`, fully cancelable
fetchResults = task(async () => {
  let results = await this.queryServer.perform();
  this.results = results;
});

startFetchResults = () => {
  this.fetchResults.perform();
};

<template>
  <Button {{on 'click' this.startFetchResults}}>Fetch</Button>
</template>
```

With the whole chain inside ember-concurrency's domain, cancelation is routine and silent — no rejections, no `try/catch`, no `didCancel` checks.

**Heuristics that flag this smell:**
- `await something.perform()` written in a non-task method (including an `async action() { ... }`)
- `something.perform().then(...)` anywhere
- A `try/catch` whose only job is filtering `didCancel(e)` — the awaited task should have been called from another task instead
- An `@action async ...` that calls `.perform()` — promote it to a task and call it from a synchronous local handler bound with `{{on}}`

To read a task's result reactively in a template without awaiting it, use the task's own derived state (`task.lastSuccessful.value`, `task.last.value`, `task.isRunning`, etc.) rather than awaiting `.perform()` into a tracked field.

## External Libraries: Bringing Third-Party Power to Boxel

**When to Use External Libraries:** Sometimes you need specialized functionality like 3D graphics (Three.js), data visualization (D3), or charts. Boxel plays well with external libraries when you follow the right patterns.

**Key Rules:**
1. **Always use Modifiers for DOM access** - Never manipulate DOM directly
2. **Use ember-concurrency tasks** for async operations like loading libraries
3. **Bind external data to model fields** for reactive updates
4. **Use proper loading states** while libraries initialize
