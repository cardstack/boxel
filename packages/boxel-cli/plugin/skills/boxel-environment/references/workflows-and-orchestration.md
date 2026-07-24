## Orchestration Patterns

### 1. Smart Code Refactoring
```json
`set-active-llm_1887` with `attributes.roomId` set to the current room ID and `attributes.llmId` set to "anthropic/claude-sonnet-4.6"
→ `read-file-for-ai-assistant_a831` with `attributes.fileUrl` set to e.g. "https://[domain]/user/card.gts"
→ Prompt "improve code structure"
→ Emit a code patch search/replace block
```
**Note:** Always verify/switch to code-approved LLM first

### 2. Data-Driven Schema Generation
```json
`read-file-for-ai-assistant_a831` with `attributes.fileUrl` set to e.g. "data.csv"
→ Prompt "generate CardDef from CSV"
→ Emit a code patch search/replace block
```

### 3. Live Preview Development
```json
`show-card_566f` with `attributes.cardId` set to e.g. "https://[domain]/user/Card/instance"
→ Prompt "enhance UX for this card"
→ Emit a code patch search/replace block
→ `show-card_566f` with `attributes.cardId` set to e.g. "https://[domain]/user/Card/instance"
```

### 4. Bulk Relationship Mapping
```json
`SearchCardsByQueryCommand_847d` with `attributes.query` set to valid query JSON that includes a filter
→ Prompt "detect relationship patterns"
→ Emit a code patch search/replace block to create a transformation command
→ `transform-cards_33d7` with `attributes.query` and `attributes.commandRef` set to perform a bulk update
```

### 5. Context-Aware Migration
```json
`read-file-for-ai-assistant_a831` with `attributes.fileUrl` set to e.g. "https://[domain]/user/schema.gts"
→ `SearchCardsByQueryCommand_847d` with `attributes.query` set to valid query json with a filter specified
→ Emit a code patch search/replace block creating a migration command
→ `transform-cards_33d7` with `attributes.query` and `attributes.commandRef` set to perform bulk migration
```

### 6. Dependency Surfing
```json
`read-file-for-ai-assistant_a831` with `attributes.fileUrl` set to "https://[domain]/user/card.gts"
→ `read-file-for-ai-assistant_a831` with `attributes.fileUrl` set to "https://[domain]/user/Card/instance.json"
→ `SearchCardsByQueryCommand_847d` with `attributes.query` set to e.g. '{"filter": {"contains": {"imports": "card"}}}'
→ Emit a code patch search/replace block
```

### 7. Intelligent Debug Escalation
```json
Prompt "debug this error: ..."
→ [if stuck] → `set-active-llm_1887` with `attributes.roomId` set to the current room and `attributes.llmId` set to "google/gemini-2.5-pro"
→ Prompt "debug this error: ..."

### Code Generation
```json
`switch-submode_dd88` with `attributes.submode` set to "code" and `attributes.codePath` set to the target file's URL (a bare submode switch stays in whatever realm the UI last showed)
→ `read-file-for-ai-assistant_a831` with `attributes.fileUrl` set to "https://[domain]/user/card.gts"
→ Emit a code patch search/replace block
→ (offer refresh)
```

### Card Creation
```json
`switch-submode_dd88` with `attributes.submode` set to "code", `attributes.createFile` set to true, and `attributes.codePath` set to the new file's URL in the target realm
→ Emit a code patch search/replace block to create the new file
→ `show-card_566f` with `attributes.cardId` set to the url of the new file
```

### Search & Modify
```json
`SearchCardsByQueryCommand_847d` with `attriibutes.query` set
→ `patchCardInstance` with `attributes.cardId` set to the card URL, and `attributes.patch` set to schema-conforming patch JSON
```

### Schema Migration
1. Update schema with breaking changes:
```json
→ Emit a code patch search/replace block
```
2. Add migration command to same file:
```typescript
export class MigrateNameFields extends Command<typeof JsonCard, typeof JsonCard> {
  async getInputType() { return JsonCard; }
  protected async run(input: JsonCard): Promise<JsonCard> {
    // Transform logic here
  }
}
```
3. Run transform using `transform-cards_33d7`
4. Remove migration command after success

### Multi-Realm Operations
```json
`copy-source_5d09` with `attributes.originSourceUrl` and `attributes.destinationSourceUrl` set
→ `copy-card_eefc` with `attributes.sourceCard` and `attributes.realm` set
→ `transform-cards_33d7` with `attributes.query` and `attributes.commandRef` set to perform a bulk modification
```

### Optimistic Command Pipeline
Use for LLM, image generation, imports, diagnostics, or any workflow where user-visible progress should not wait for every realm save/index cycle.

```json
Card component action
→ resolve `commandContext` and current `realmURL`
→ create one typed Run/Job card with steps, logs, status, prompt/model/input snapshot
→ queue `SaveCardCommand` through an OptimisticSave helper
→ mutate the same run card for each stage and queue progress saves
→ await only external calls or file/binary persistence
→ save terminal completed/failed state
→ `settle()` queued saves and surface late failures in the UI log
```

Rules:
- Keep the run card compact and queryable. Prefer one run card with `containsMany` steps/logs over many transient cards.
- Do not hide side effects in bxl, Guides, or computed fields. Commands and command-backed component actions own writes, external calls, and user asks.
- For AI/image work, store the model id, prompt snapshot, source card URL, finish reason, latency, output URL, and error state on the run card.
- Prefer host commands for IO. Direct `fetch` needs a documented runtime gap and a source comment.
- Source pattern: see ready pattern `command-optimistic-pipeline` (`optimistic-save.gts`, `demo-pipeline.gts`, `image-gen.gts`, `bench.gts` are the historical inspiration; ask the user for current realm URLs if you need to read them).

### Parallel agents in one realm — tracking convention

When more than one agent is building inside the same realm, **keep a small markdown tracking doc inside the realm itself** and sync it periodically with finished work. List what changed, what's been verified in browser QA, what still needs testing, and any notable skill/API learnings discovered during the session.

Why it matters:

- The user can inspect progress through `boxel-cli` (or in the live host) during a long build instead of waiting for a final summary.
- It reduces coordination drift between parallel agents by making the current source of truth visible in the same place as the cards, commands, files, and instances being built.
- It survives session boundaries. If a parallel agent reads the tracking doc on session start, they see what's already done.

Format suggestion: a single `TRACKING.md` at the realm root with sections for *Cards landed*, *Cards in progress*, *Verified*, *Pending QA*, *Learnings*. Sync after every significant landing.

### Transient `npx boxel search` failures during indexing

`npx boxel search --realm <url>` can briefly return `Realms not found` even when the realm is healthy — typically right after a new card/instance landing, while the realm-server's federated-search registration / index settles. `npx boxel file read` and `npx boxel realm wait-for-ready` may both report healthy while `npx boxel search` still 4xxs.

Don't treat the transient as proof your query syntax is wrong. Recovery sequence:

1. Read the relevant files back with `npx boxel file read` to confirm they're really in the realm.
2. `npx boxel realm wait-for-ready --realm <url>` until the realm reports ready.
3. Validate through a host-rendered result-list card when possible (`@context.searchResultsComponent`; older builds used `PrerenderedCardSearch`) — that path exercises the indexer differently than the federated-search CLI route.
4. Retry `npx boxel search` after the realm has indexed.

If the transient recurs while parallel agents are landing into the same realm, record it in the tracking doc (above) so other agents don't rewrite valid query syntax chasing a state issue.
