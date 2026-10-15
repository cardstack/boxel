import { uint8ArrayToBase64 } from '@cardstack/runtime-common';
import { DEFAULT_IMAGE_GENERATION_LLM } from '@cardstack/runtime-common/matrix-constants';

const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
};

export const IMAGE_EXTENSION_RE = /\.(png|jpe?g|webp|gif|svg|avif)$/i;

// Every extension `imageExtension` can return.
export const IMAGE_FILE_EXTENSIONS = [
  ...new Set(Object.values(IMAGE_EXTENSIONS)),
];

// The file extension for an image content type; png for one it does not know.
export function imageExtension(mimeType: string): string {
  return IMAGE_EXTENSIONS[mimeType] ?? 'png';
}

export interface GeneratedImage {
  mimeType: string;
  // The image content, without a `data:` URL prefix.
  base64: string;
}

// Sends one image request to the model through the realm server's proxy, as
// `send` does it, and returns the first image in the answer. The request
// spends the user's credit whether or not an image comes back.
export async function generateImage(
  {
    prompt,
    sourceImageDataUrl,
    model,
  }: { prompt: string; sourceImageDataUrl?: string; model?: string },
  send: (request: { url: string; requestBody: string }) => Promise<Response>,
): Promise<GeneratedImage> {
  let response = await send({
    url: OPENROUTER_CHAT_URL,
    requestBody: JSON.stringify({
      model: model?.trim() || DEFAULT_IMAGE_GENERATION_LLM,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            ...(sourceImageDataUrl
              ? [{ type: 'image_url', image_url: { url: sourceImageDataUrl } }]
              : []),
          ],
        },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`Failed to generate an image: ${response.statusText}`);
  }
  let responseData = await response.json();
  let message = responseData.choices?.[0]?.message;
  let dataUrl: string | undefined = Array.isArray(message?.images)
    ? message.images
        .map((image: any) => image?.image_url?.url)
        .find(
          (url: unknown) =>
            typeof url === 'string' && url.startsWith('data:image/'),
        )
    : undefined;
  if (!dataUrl) {
    let detail =
      typeof message?.content === 'string' && message.content
        ? message.content
        : 'No image was generated in the response.';
    throw new Error(`Image generation failed: ${detail}`);
  }
  let commaIndex = dataUrl.indexOf(',');
  if (commaIndex === -1) {
    throw new Error(
      'Generated image data URL is malformed: missing comma separator.',
    );
  }
  let mimeMatch = dataUrl.slice(0, commaIndex).match(/^data:([^;]+);base64$/);
  if (!mimeMatch) {
    throw new Error(
      'Generated image data URL has an unrecognisable MIME type.',
    );
  }
  return { mimeType: mimeMatch[1], base64: dataUrl.slice(commaIndex + 1) };
}

// A source image as the data URL the model takes. A data URL is used as it
// is; any other URL is fetched with `fetchImage`.
export async function sourceImageDataUrl(
  url: string,
  fetchImage: (url: string) => Promise<Response>,
): Promise<string> {
  if (url.startsWith('data:image/')) {
    return url;
  }
  let response = await fetchImage(url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch source image ${url}: ${response.status} ${response.statusText}`,
    );
  }
  let contentType = response.headers.get('content-type') ?? 'image/png';
  let bytes = new Uint8Array(await response.arrayBuffer());
  return `data:${contentType};base64,${uint8ArrayToBase64(bytes)}`;
}
