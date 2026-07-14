---
validated: source-proven
---

# command-atomic-install — Transactional realm install with `PlanBuilder` + `ExecuteAtomicOperationsCommand`

**What this gives you:** A reliable way to install a card listing (modules + instances) into a target realm transactionally. Either the whole plan applies or none of it does — no half-installed listings.

**When to use:** You're building a Command that copies a set of modules + their JSON instances from one realm to another (catalog install / remix / template scaffolding). Anywhere you'd otherwise issue N separate writes and pray for atomicity.

**The insight:** `@cardstack/runtime-common` exports `planModuleInstall`, `planInstanceInstall`, and a `PlanBuilder` that accumulates ops into one atomic plan. `ExecuteAtomicOperationsCommand` from the host applies the whole plan in one realm transaction. The plan structure is JSON-API-friendly so the realm server can validate the whole thing up-front.

**Recipe shape:**

```ts
import {
  Command,
  planModuleInstall,
  planInstanceInstall,
  PlanBuilder,
  extractRelationshipIds,
  logger,
} from '@cardstack/runtime-common';
import ExecuteAtomicOperationsCommand from '@cardstack/boxel-host/tools/execute-atomic-operations';

const log = logger('catalog:install');

export default class MyInstallCommand extends Command<
  typeof Input,
  typeof Output
> {
  async run(input: Input) {
    const plan = new PlanBuilder();

    for (const mod of input.modules) {
      plan.add(
        planModuleInstall({
          from: mod.source,
          to: input.targetRealm,
          path: mod.path,
        }),
      );
    }
    for (const inst of input.instances) {
      plan.add(
        planInstanceInstall({
          from: inst.source,
          to: input.targetRealm /* … */,
        }),
      );
    }

    log.info(`Installing ${plan.size} ops to ${input.targetRealm}`);
    const result = await new ExecuteAtomicOperationsCommand(
      this.commandContext,
    ).execute(plan.build());

    return new Output(/* … */);
  }
}
```

**Gotchas:**

- `extractRelationshipIds` is the canonical helper for pulling cross-card references out of a JSON instance before rewriting paths.
- The plan applies in order — put module installs before any instance that depends on them.
- For very large installs, batch into smaller plans rather than one giant atomic op — easier to recover.
- Use `logger('namespace:operation')` (from `runtime-common`) so the realm server prefixes log lines consistently.

**Source:** `boxel-catalog/commands/listing-install.ts`.

**See also:** `command-typed-with-progress`, `command-with-skill-card-ref`, `boxel/references/command-development.md`.
