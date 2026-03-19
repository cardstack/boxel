### Replicate API Essentials

**Gateway URL Pattern:**
```
https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/replicate/v1/models/{owner}/{model}/predictions
```

**Required Headers:**
```typescript
{
  'Content-Type': 'application/json',
  'Prefer': 'wait'  // CRITICAL: Synchronous response
}
```

**Request Structure:**
```typescript
{
  input: {
    prompt: string,
    // Model-specific parameters (see API docs)
  }
}
```

### Enum Fields for API Parameters

**CRITICAL:** Enum `value` must exactly match API spec:

```gts
import enumField from 'https://cardstack.com/base/enum';

const SizeField = enumField(StringField, {
  options: [
    { value: '1K', label: '1K (1024px)' },
    { value: '2K', label: '2K (2048px)' },
    { value: 'custom', label: 'Custom' }
  ]
});
```

### API Call Pattern

```gts
import SendRequestViaProxyCommand from '@cardstack/boxel-host/commands/send-request-via-proxy';
import UploadImageCommand from 'https://realms-staging.stack.cards/catalog/commands/upload-image';
import GetCardCommand from '@cardstack/boxel-host/commands/get-card';
import { CloudflareImage } from 'https://realms-staging.stack.cards/catalog/cloudflare-image';

// Build request
const requestBody = {
  input: { prompt: input.prompt }
};

// Add conditional parameters
if (input.size) requestBody.input.size = input.size;
if (input.aspectRatio && input.size !== 'custom') {
  requestBody.input.aspect_ratio = input.aspectRatio;
}

// Call API
const response = await new SendRequestViaProxyCommand(ctx).execute({
  url: 'https://gateway.ai.cloudflare.com/v1/.../replicate/v1/models/{owner}/{model}/predictions',
  method: 'POST',
  requestBody: JSON.stringify(requestBody),
  headers: { 'Content-Type': 'application/json', 'Prefer': 'wait' }
});

// Parse response
const data = await response.response.json();
let imageUrl = Array.isArray(data.output) ? data.output[0] : data.output;

// Upload result
const uploaded = await new UploadImageCommand(ctx).execute({
  sourceImageUrl: imageUrl,
  targetRealmUrl: input.realm
});

return await new GetCardCommand(ctx).execute({ cardId: uploaded.cardId });
```

### Response Parsing

```typescript
// Handle multiple formats
let imageUrl: string | undefined;

if (data.output && Array.isArray(data.output)) {
  imageUrl = data.output[0];
} else if (typeof data.output === 'string') {
  imageUrl = data.output;
} else if (data.output?.url) {
  imageUrl = data.output.url;
}

if (!imageUrl) throw new Error('No image URL in response');
```

### Common Mistakes

❌ Missing `Prefer: wait` header → async URL instead of result  
❌ Enum value mismatch → API rejects request  
❌ Always sending optional params → API validation errors  
❌ String booleans in API → Use actual `true`/`false`

### Finding Model Schemas

1. Visit `https://replicate.com/{owner}/{model}`
2. Check API tab for exact schema
3. Note required vs optional parameters
4. Match enum values exactly