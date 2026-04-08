# Commands

Commands are executable actions that extend card functionality. They enable AI agents and users to perform operations like creating cards, generating content, exporting data, and more.

## Command Architecture

```
Command Definition (.gts)
      ↓
  Input Card (data for the command)
      ↓
  Execution (run method)
      ↓
  Result Card (output)
```

## Defining a Command

```typescript
import { Command } from 'https://cardstack.com/base/command';
import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

// Input card — what the command needs
class GenerateInput extends CardDef {
  @field prompt = contains(StringField);
  @field style = contains(StringField);
}

// Result card — what the command returns
class GenerateResult extends CardDef {
  @field content = contains(StringField);
  @field status = contains(StringField);
}

// The command itself
export class GenerateContentCommand extends Command<
  typeof GenerateInput,
  typeof GenerateResult
> {
  static displayName = 'Generate Content';
  static actionVerb = 'Generate';
  static description = 'Generate content from a prompt';

  // Fields to exclude from AI JSON schema
  static ignoreInputFields = ['cardInfo'];

  // Fields required in AI JSON schema
  static requireInputFields = ['prompt'];

  async run(input: GenerateInput): Promise<GenerateResult> {
    // Command logic here
    const content = `Generated from: ${input.prompt}`;

    const result = new GenerateResult();
    result.content = content;
    result.status = 'success';
    return result;
  }
}
```

## Command Properties

| Property | Type | Description |
|----------|------|-------------|
| `displayName` | `string` | Name shown in UI |
| `actionVerb` | `string` | Button label (default: "Apply") |
| `name` | `string` | Programmatic name (default: constructor name) |
| `description` | `string` | Human-readable description |
| `ignoreInputFields` | `string[]` | Fields excluded from AI schema |
| `requireInputFields` | `string[]` | Fields marked required in AI schema |

## Executing Commands

### From AI Agents

AI agents can invoke commands through the Matrix chat interface. The `getInputJsonSchema()` method generates a JSON Schema that the AI uses to construct input:

```typescript
const schema = GenerateContentCommand.getInputJsonSchema();
// Returns:
// {
//   "type": "object",
//   "properties": {
//     "prompt": { "type": "string" },
//     "style": { "type": "string" }
//   },
//   "required": ["prompt"]
// }
```

### Command Requests

Commands are invoked via `CommandRequest` objects:

```typescript
interface CommandRequest {
  id: string;
  name: string;
  arguments: Record<string, any>;
}
```

### Encoding/Decoding

```typescript
import {
  encodeCommandRequest,
  decodeCommandRequest,
} from '@cardstack/runtime-common';

// Encode for transmission
const encoded = encodeCommandRequest({
  id: 'cmd-123',
  name: 'GenerateContentCommand',
  arguments: { prompt: 'Write a poem' },
});

// Decode from received data
const request = decodeCommandRequest(encodedString);
```

## Command URL Format

Commands are referenced by URL with a specific format:

```
@cardstack/boxel-host/commands/{folder}/{export}
{realmUrl}/commands/{name}/{export}
```

Examples:
```
@cardstack/boxel-host/commands/generate/GenerateContentCommand
https://my-realm.boxel.ai/commands/export/ExportDataCommand
```

## Real-World Command Examples

### Export Command

```typescript
export class ExportProductCatalogCommand extends Command<
  typeof CatalogInput,
  typeof ExportResult
> {
  static displayName = 'Export Product Catalog';
  static actionVerb = 'Export';

  async run(input: CatalogInput): Promise<ExportResult> {
    const products = input.products ?? [];
    const csv = products.map(p =>
      `${p.name},${p.price},${p.sku}`
    ).join('\n');

    const result = new ExportResult();
    result.data = csv;
    result.format = 'csv';
    return result;
  }
}
```

### Theme Generation Command

```typescript
export class PatchThemeCommand extends Command<
  typeof ThemeInput,
  typeof ThemeResult
> {
  static displayName = 'Update Theme';
  static actionVerb = 'Apply';

  async run(input: ThemeInput): Promise<ThemeResult> {
    // Apply theme changes to a card
    const result = new ThemeResult();
    result.success = true;
    return result;
  }
}
```

## Commands and the Host App

The Host App has a **CommandService** (919 lines) that manages command execution:

- Loads command modules dynamically
- Creates command instances with proper DI
- Handles input validation
- Manages execution lifecycle
- Reports results back to the UI

Commands can be triggered from:
1. AI assistant chat
2. Card action buttons
3. Skill card triggers
4. Programmatic invocation

## Next Steps

- [Skills](/card-development/skills) — AI skill cards
- [AI & Agents Overview](/ai-agents/overview) — Full AI integration
- [Defining Cards](/card-development/defining-cards) — Card patterns
