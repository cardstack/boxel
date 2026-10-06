# Build Your First Choreo Application

This tutorial builds a small task board in a clean Ember application. You will add and remove tasks, animate their changing positions, and interrupt a transition with another action. The example above is the same component the starter generator copies into your application. You do not need the gallery's styles, catalog, or tuning infrastructure.

## Start from a working installation

For this checkout, use the local workspace packages. The package manifests are still version 0.0.0; this tutorial does not assume an npm release. You need this repository checked out and [mise](https://mise.jdx.dev/) installed, which provides the Node and pnpm versions pinned in the repository's .mise.toml. mise ignores a configuration file until it is trusted, so the first command trusts the repository's. Run these commands from its root:

```sh title="Terminal"
mise trust
mise install
pnpm install
node packages/choreo-gallery/tools/create-tutorial-app.mjs /tmp/my-choreo-app
cd /tmp/my-choreo-app
mise trust
pnpm install
pnpm build
pnpm start
```

Open http://localhost:4600/. The generator refuses an existing destination, so it cannot overwrite your application. It creates a separate Ember/Vite application with three routes and ordinary component source, and pins the same Node and pnpm versions in its own .mise.toml, which mise trust approves. The generator builds glimmer-motion and choreo-player and packs them into the application's vendor/ directory, and its package.json depends on those tarballs. The application does not depend on the repository after it is generated. After changing library source, generate a new application to pick up the rebuilt packages. Do not copy only src/ into node_modules: the addon needs its built entry points and declarations.

The generated app deliberately reuses the version ranges the repository declares for Ember, Vite, and the template-tag toolchain. It has no lockfile, so pnpm install resolves the newest versions within those ranges. It is a working consumer rather than a claim that every Ember version in the peer range has been tested. For your own existing app, compare its template-tag configuration and peer dependencies with the generated package.json before transplanting a component.

## Begin with application state

Open app/components/task-board.gts. Each task has a stable ID and a title. The tracked tasks array is the source of truth. Adding, removing, and reversing replace that array; they never ask an animation to decide whether a task exists.

```ts title="TaskBoard — state excerpt"
@tracked tasks = [...initialTasks];
remove = (id: string) => {
  this.tasks = this.tasks.filter((task) => task.id !== id);
};
reverse = () => {
  this.tasks = [...this.tasks].reverse();
};
```

First try these actions in the running app. Remove the middle task, add a new one, and reverse their order. The text and buttons are real DOM, so ordinary Ember actions and browser focus behavior still apply. IDs must describe tasks, not their array positions: an index changes meaning when the order changes.

## Add participants and a score

The complete component wraps the list in Choreo. The each block uses key="id", and each row declares the same identity through motion. A role groups all task rows for selection. The score fades removed rows, moves surviving rows, and reveals new rows, in that order.

```gts title="TaskBoard — timeline excerpt"
<c.Sequence>
  <c.Tween @of={{c.removed "task"}} @opacity={{0}} @duration={{0.15}} />
  <c.Move @of={{c.moved "task"}} @duration={{this.duration}} />
  <c.Tween @of={{c.inserted "task"}} @opacity={{array 0 1}} @duration={{0.2}} />
</c.Sequence>
```

Choreo retains the removed row for its exit. Do not add Presence around this same scene to create a second owner of removal. Presence is the smaller pattern for an independent enter/exit example; the [presence guide](/docs/core-presence) teaches it separately. Here, removal and the neighbors' movement form one coordinated interaction.

## Tune and interrupt

Move the duration slider to one second. Reverse the list and immediately remove a task before movement finishes. The next render pass measures the current appearance and redirects the scene. The slider changes the named move duration in the score; it does not silently slow unrelated hover effects. Restore 0.4 seconds and repeat the action to compare the same behavior at its normal pace.

The row declares borderRadius through motion's style argument. This makes the property available to the engine. Avoid a bound style attribute on that same element, which can overwrite transforms during a Glimmer update. Keep unrelated layout and typography in CSS.

## Verify the outcome

Run pnpm lint:types and pnpm build in the generated app. The repository also supplies a browser check:

```sh title="From the repository root, while the starter is running"
node packages/choreo-gallery/scripts/verify-tutorials.mjs http://localhost:4600
```

The check reverses and removes during movement, checks final row identity, tests the spatial button, and compares film frames reached from different times. It is a small regression check, not a substitute for your application's keyboard, focus-restoration, and reduced-motion tests. In particular, decide where focus should move when the user removes the focused task.

The complete source is [task-board.gts](https://github.com/cardstack/choreo/blob/main/test-app/app/components/tutorials/task-board.gts). Next, reuse the same separation of state and motion in [your first spatial scene](/docs/spatial-first-scene), or consult [testing motion](/docs/core-testing) before adding more interactions.
