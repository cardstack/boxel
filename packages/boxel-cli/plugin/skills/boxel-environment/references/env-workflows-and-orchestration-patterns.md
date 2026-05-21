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

````json
Prompt "debug this error: ..."
→ [if stuck] → `set-active-llm_1887` with `attributes.roomId` set to the current room and `attributes.llmId` set to "google/gemini-2.5-pro"
→ Prompt "debug this error: ..."

### Code Generation
```json
`switch-submode_dd88` with `attributes.submode` set to "code"
→ `read-file-for-ai-assistant_a831` with `attributes.fileUrl` set to "https://[domain]/user/card.gts"
→ Emit a code patch search/replace block
→ (offer refresh)
````

### Card Creation

```json
`switch-submode_dd88` with `attributes.submode` set to "code"
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
export class MigrateNameFields extends Command<
  typeof JsonCard,
  typeof JsonCard
> {
  async getInputType() {
    return JsonCard;
  }
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
