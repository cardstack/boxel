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
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
import GetCardCommand from '@cardstack/boxel-host/commands/get-card';
import SendRequestViaProxyCommand from '@cardstack/boxel-host/commands/send-request-via-proxy';
import SearchCardsByQueryCommand from '@cardstack/boxel-host/commands/search-cards-by-query';

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

### Catalog Command Delegation

**Reuse existing commands instead of reimplementing:**

```gts
import UploadImageCommand from 'https://realms-staging.stack.cards/catalog/commands/upload-image';

const result = await new UploadImageCommand(this.commandContext).execute({
  sourceImageUrl: dataUrl,
  targetRealmUrl: input.realm
});
```

### Query Pattern in Commands

```gts
import SearchCardsByQueryCommand from '@cardstack/boxel-host/commands/search-cards-by-query';

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
- ✅ **Use host commands for all IO** - never `fetch` directly
- ✅ **Include `on` in queries** - for eq/contains/range filters
- ✅ **Delegate to catalog commands** - don't reimplement uploads/services
- ✅ **Wrap JSON parsing in try-catch** - handle malformed responses
- ✅ **Track progress states** - use `@tracked` for UI feedback