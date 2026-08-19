## Command Development Essentials

Commands extend `Command<InputCardDef, OutputCardDef | undefined>` and execute workflows through host APIs.

### Core Structure

```gts
import { Command } from '@cardstack/runtime-common';
import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

class MyInput extends CardDef {
  @field targetRealm = contains(StringField);
}

export class MyCommand extends Command<typeof MyInput, undefined> {
  static actionVerb = 'Process';
  async getInputType() { return MyInput; }
  
  protected async run(input: MyInput): Promise<undefined> {
    // Validation first
    if (!input.targetRealm) throw new Error('Target realm required');
    
    // Execute workflow
    // Return result or undefined
  }
}
```

### Host Commands (IO Operations)

**Never use `fetch` directly - always use host commands:**

```gts
import SaveCardCommand from '@cardstack/boxel-host/tools/save-card';
import GetCardCommand from '@cardstack/boxel-host/tools/get-card';
import SendRequestViaProxyCommand from '@cardstack/boxel-host/tools/send-request-via-proxy';
import { SearchCardsByQueryCommand } from '@cardstack/boxel-host/tools/search-cards';

// Save a card
await new SaveCardCommand(this.commandContext).execute({
  card: myCard,
  realm: 'https://realm-url/'
});

// Get a card
const card = await new GetCardCommand(this.commandContext).execute({
  cardId: 'https://realm/Card/id'
});

// External API call
const response = await new SendRequestViaProxyCommand(this.commandContext).execute({
  url: 'https://api.example.com/endpoint',
  method: 'POST',
  requestBody: JSON.stringify(data),
  headers: { 'Content-Type': 'application/json' }
});
```

### OpenRouter API Pattern

```gts
const headers = {
  'Content-Type': 'application/json',
  'HTTP-Referer': 'https://realms-staging.stack.cards',
  'X-Title': 'Your App Name'
};

const response = await new SendRequestViaProxyCommand(ctx).execute({
  url: 'https://openrouter.ai/api/v1/chat/completions',
  method: 'POST',
  requestBody: JSON.stringify({
    model: 'google/gemini-2.5-flash',
    messages: [{ role: 'user', content: 'Your prompt' }]
  }),
  headers
});

if (!response.response.ok) throw new Error('API call failed');
const data = await response.response.json();
const text = data.choices?.[0]?.message?.content ?? '';
```

For image generation, use the `integrate-openrouter-image-generation` pattern instead of ad-hoc provider APIs. The request must include `modalities: ['image', 'text']`, and returned data URLs must be persisted with `WriteBinaryFileCommand` before being linked from a card.

### Generated Binary File Persistence

For generated images, audio, or other bytes, write a real realm file and then link it with FileDef/ImageDef/PngDef. Do not use deprecated image-card persistence.

```gts
import WriteBinaryFileCommand from '@cardstack/boxel-host/tools/write-binary-file';

const result = await new WriteBinaryFileCommand(this.commandContext).execute({
  path: 'GeneratedImages/result.png',
  realm: input.realm,
  base64Content,
  contentType: 'image/png',
  useNonConflictingFilename: true,
});
```

### Query Pattern in Commands

```gts
import { SearchCardsByQueryCommand } from '@cardstack/boxel-host/tools/search-cards';

const results = await new SearchCardsByQueryCommand(this.commandContext).execute({
  query: {
    filter: {
      on: { module: new URL('./product', import.meta.url).href, name: 'Product' },
      eq: { status: 'active' }
    }
  },
  realmURLs: [input.realm]
});
```

### Progress Tracking

```gts
import { tracked } from '@glimmer/tracking';

export class MyCommand extends Command<typeof Input, undefined> {
  @tracked step: 'idle' | 'processing' | 'completed' | 'error' = 'idle';
  
  protected async run(input: Input): Promise<undefined> {
    this.step = 'processing';
    try {
      // Do work
      this.step = 'completed';
    } catch (e) {
      this.step = 'error';
      throw e;
    }
  }
}
```

### Optimistic Run Card Pipelines

For multi-step work, create a durable run card and update it optimistically instead of serially awaiting every progress save. This keeps the UI responsive while still producing a queryable execution trace.

```gts
import SaveCardCommand from '@cardstack/boxel-host/tools/save-card';

class OptimisticSave {
  pending: Array<Promise<any>> = [];
  constructor(readonly commandContext: any) {}

  save(card: any, realm: string) {
    let saved = new SaveCardCommand(this.commandContext).execute({ card, realm });
    this.pending.push(saved);
    saved.catch(() => {});
    return saved;
  }

  settle() {
    let pending = this.pending.slice();
    this.pending = [];
    return Promise.allSettled(pending);
  }
}
```

Use this shape when an operation has observable stages:

- Create one typed run card with `status`, `steps`, `logs`, `progressCurrent`, `progressTotal`, timestamps, and output fields.
- Mutate the same run card instance as the workflow advances, then queue `SaveCardCommand` without awaiting cosmetic progress writes.
- Await only dependency boundaries: first save if you need the card URL immediately, external API calls, binary/file persistence, and final `settle()`.
- Reassign `containsMany` arrays when changing nested steps or logs so tracking and serialization see the change.
- On failure, save a terminal `failed` state with the error message before returning.

Pattern: `boxel-patterns/patterns/command-optimistic-pipeline`.

### Menu Integration

```gts
import { getCardMenuItems } from '@cardstack/runtime-common';

[getCardMenuItems](params: GetCardMenuItemParams): MenuItemOptions[] {
  return [{
    label: 'My Action',
    icon: MyIcon,
    action: async () => {
      await new MyCommand(params.commandContext).execute({
        cardId: this.id,
        realm: params.realmURL
      });
      await params.saveCard(this);
    }
  }, ...super[getCardMenuItems](params)];
}
```

### Critical Rules

- ✅ **Validate inputs first** - fail early with clear errors
- ✅ **Use host commands for normal IO** - prefer `SaveCardCommand`, `GetCardCommand`, `SearchCardsByQueryCommand`, and `SendRequestViaProxyCommand`
- ✅ **Include `on` in queries** - for eq/contains/range filters
- ✅ **Delegate to catalog commands** - don't reimplement uploads/services
- ✅ **Wrap JSON parsing in try-catch** - handle malformed responses
- ✅ **Track progress states** - use `@tracked` for UI feedback
- ✅ **Record long-running work as cards** - use a run/job card with typed steps and logs instead of hidden console state
- ⚠️ **Only use direct `fetch` for documented host-command gaps** - e.g. sticky-bat's binary upload workaround for virtual-network byte corruption, with authorization and `X-Boxel-Client-Request-Id`
