# Google Image Search Command

The `SearchGoogleImagesCommand` allows you to search for images on Google using the Google Custom Search API.

## Setup

### 1. Google Custom Search API Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the **Custom Search API**
4. Create a **Custom Search Engine (CSE)** at [Programmable Search Engine](https://programmablesearchengine.google.com/)
   - Set it to search the entire web (or limit to specific sites)
   - Enable "Search the entire web" option
   - Enable "Image search" option
5. Get your **API key** and **Search Engine ID (cx)**

### 2. Proxy Configuration

The Google Custom Search API key and Search Engine ID should be configured in the `ALLOWED_PROXY_DESTINATIONS` environment variable for the realm server. Add the following configuration:

```json
{
  "url": "https://www.googleapis.com/customsearch/v1",
  "apiKey": "your-google-api-key",
  "creditStrategy": "no-credit",
  "supportsStreaming": false
}
```

The API key will be automatically added to requests by the proxy system.

## Usage

### Input Parameters

- `query` (string, required): The search query for images
- `maxResults` (number, optional): Maximum number of results to return (default: 10, max: 10)

### Output

The command returns a `SearchGoogleImagesResult` with:

- `images` (array): Array of image objects containing:
  - `title`: Image title
  - `imageUrl`: Direct URL to the image
  - `thumbnailUrl`: URL to the thumbnail
  - `contextUrl`: URL to the webpage containing the image
  - `width`: Image width in pixels
  - `height`: Image height in pixels
- `totalResults` (number): Total number of results available
- `searchTime` (number): Time taken for the search in seconds

### Example

```typescript
const commandService = getService('command-service');
const searchCommand = new SearchGoogleImagesCommand(
  commandService.commandContext,
);

const result = await searchCommand.execute({
  query: 'cute puppies',
  maxResults: 5,
});

console.log(`Found ${result.images.length} images`);
result.images.forEach((image) => {
  console.log(`- ${image.title}: ${image.imageUrl}`);
});
```

## API Limits

- Google Custom Search API has a free quota of **100 queries/day**
- After the free quota, you pay per request
- Maximum 10 results per request

## Error Handling

The command will throw an error if:

- The Google API returns an error
- Network issues occur
- Proxy configuration is missing or invalid

## Security Notes

- API keys are handled securely by the proxy system
- The command uses the `sendRequestViaProxy` command for all requests
- Ensure your API key has appropriate restrictions set in Google Cloud Console
- The proxy system validates all requests against the allowed destinations list
