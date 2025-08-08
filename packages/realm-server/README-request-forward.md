# Request Forward Endpoint

The `/_request-forward` endpoint allows users to proxy requests to external APIs while managing Boxel credits and API keys.

## Usage

### Endpoint

- **Path**: `/_request-forward`
- **Method**: `POST`
- **Authentication**: JWT Bearer token required

### Request Body

```json
{
  "url": "https://openrouter.ai/api/v1",
  "method": "POST",
  "requestBody": "{\"model\":\"openai/gpt-3.5-turbo\",\"messages\":[{\"role\":\"user\",\"content\":\"Hello\"}]}",
  "headers": {
    "Custom-Header": "value"
  },
  "isStreaming": false
}
```

### Fields

- `url` (required): The external endpoint URL to forward the request to
- `method` (required): HTTP method (GET, POST, PUT, DELETE, etc.)
- `requestBody` (required): JSON string containing the request body
- `headers` (optional): Additional headers to include in the request
- `isStreaming` (optional): Set to `true` to enable streaming responses (Server-Sent Events)

### Response

#### Non-Streaming Response

The endpoint returns the response from the external API with the same status code and headers.

#### Streaming Response

When `isStreaming: true` is set, the endpoint returns a Server-Sent Events (SSE) stream with the following characteristics:

- **Content-Type**: `text/event-stream`
- **Headers**: Includes CORS headers for browser compatibility
- **Format**: Each event is prefixed with `data: ` and followed by `\n\n`
- **Completion**: Stream ends with `data: [DONE]\n\n`
- **Error Handling**: Errors are sent as JSON events in the stream

Example streaming response:

```
data: {"id":"gen-123","choices":[{"delta":{"content":"Hello"}}]}

data: {"id":"gen-123","choices":[{"delta":{"content":" world"}}]}

data: [DONE]
```

## Supported External Endpoints

### OpenRouter

- **URL**: `https://openrouter.ai/api/v1`
- **Credit Strategy**: AI Credit Strategy (same as AI bot)
- **API Key**: Automatically managed by the server
- **Streaming**: ✅ Supported (Server-Sent Events)

### Adding New Endpoints

To add a new external endpoint, update `packages/realm-server/lib/external-endpoints.ts`:

```typescript
// For a free endpoint
'https://free-api.com/v1': {
  url: 'https://free-api.com/v1',
  apiKey: process.env.FREE_API_KEY!,
  creditStrategy: new NoCreditStrategy(),
  whitelisted: true,
},

// For a custom credit endpoint
'https://custom-api.com/v1': {
  url: 'https://custom-api.com/v1',
  apiKey: process.env.CUSTOM_API_KEY!,
  creditStrategy: new CustomCreditStrategy(100, async (response) => {
    // Custom credit calculation logic
    return response.usage?.tokens * 0.001 || 0;
  }),
  whitelisted: true,
  supportsStreaming: true, // Enable streaming support
},
```

## Credit Management

- Credits are managed through configurable credit strategies per endpoint
- Each endpoint can have its own credit validation and calculation rules
- Current strategies:
  - **AI Credit Strategy**: Same as AI bot (minimum credits, OpenRouter cost calculation)
  - **No Credit Strategy**: Free endpoints with no credit requirements
  - **Custom Credit Strategy**: Configurable for future endpoints
- Insufficient credits will return a 402 Payment Required error

## Error Handling

- **400 Bad Request**: Invalid request body or non-whitelisted endpoint
- **401 Forbidden**: Missing or invalid JWT token
- **402 Payment Required**: Insufficient credits
- **500 System Error**: Internal server error

## Security

- Only whitelisted endpoints are allowed
- API keys are managed server-side
- JWT authentication required for all requests
- Rate limiting may be implemented in the future

## Examples

### Non-Streaming Request

```bash
curl -X POST http://localhost:4201/_request-forward \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://openrouter.ai/api/v1/chat/completions",
    "method": "POST",
    "requestBody": "{\"model\":\"openai/gpt-3.5-turbo\",\"messages\":[{\"role\":\"user\",\"content\":\"Hello\"}]}"
  }'
```

### Streaming Request

```bash
curl -X POST http://localhost:4201/_request-forward \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://openrouter.ai/api/v1/chat/completions",
    "method": "POST",
    "requestBody": "{\"model\":\"openai/gpt-3.5-turbo\",\"messages\":[{\"role\":\"user\",\"content\":\"Write a story\"}],\"stream\":true}",
    "isStreaming": true
  }'
```

**Note**: For streaming requests, the `stream: true` parameter must be included in the `requestBody` for OpenRouter API calls.
