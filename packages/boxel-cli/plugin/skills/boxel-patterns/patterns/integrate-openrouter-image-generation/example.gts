import { Command } from '@cardstack/runtime-common';
import {
  CardDef,
  ImageDef,
  contains,
  field,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import SendRequestViaProxyCommand from '@cardstack/boxel-host/tools/send-request-via-proxy';
import WriteBinaryFileCommand from '@cardstack/boxel-host/tools/write-binary-file';

// PATTERN: OpenRouter image generation with FileDef persistence.
//
// The generated data URL is never saved on a card. It is immediately written
// as a realm file, then linked through ImageDef.

const DEFAULT_IMAGE_MODEL = 'google/gemini-2.5-flash-image';
const CHATGPT_IMAGE_MODEL = 'openai/gpt-5.4-image-2';

class OpenRouterImageInput extends CardDef {
  @field prompt = contains(StringField);
  @field targetRealmUrl = contains(StringField);
  @field model = contains(StringField);
  @field aspectRatio = contains(StringField); // e.g. 1:1, 4:5, 16:9
  @field imageSize = contains(StringField); // e.g. 1K, 2K, 4K
}

class OpenRouterImageResult extends CardDef {
  @field image = linksTo(ImageDef);
  @field imageUrl = contains(StringField, {
    computeVia: function (this: OpenRouterImageResult) {
      return this.image?.url ?? this.image?.sourceUrl ?? '';
    },
  });
  @field model = contains(StringField);
  @field contentType = contains(StringField);
  @field contentSize = contains(NumberField);
  @field outputText = contains(StringField);
}

function extensionForContentType(contentType: string): string {
  let map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/avif': 'avif',
  };
  return map[contentType] ?? 'png';
}

function safeFileStem(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'openrouter-image'
  );
}

function parseDataImageUrl(dataUrl: string) {
  let match = dataUrl.match(
    /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/,
  );
  if (!match) {
    throw new Error('OpenRouter did not return a base64 image data URL.');
  }

  let [, contentType, base64Content] = match;
  return {
    base64Content,
    contentType,
    contentSize: Math.round((base64Content.length * 3) / 4),
    extension: extensionForContentType(contentType),
  };
}

function extractImageDataUrl(data: any): string {
  let image = data?.choices?.[0]?.message?.images?.[0];
  let url = image?.image_url?.url ?? image?.imageUrl?.url ?? image?.url;
  if (!url) {
    throw new Error('OpenRouter response had no message.images[0] data URL.');
  }
  return url;
}

async function parseProxyJson(result: any): Promise<any> {
  let response = result.response ?? result;
  let ok = response.ok ?? response.status < 400;
  if (!ok) {
    let status = response.status ?? result.status ?? 'unknown';
    throw new Error(`OpenRouter request failed: ${status}`);
  }

  if (typeof response.json === 'function') return response.json();
  if (typeof result.body === 'string') return JSON.parse(result.body);
  if (typeof response.body === 'string') return JSON.parse(response.body);
  return response;
}

export default class GenerateOpenRouterImageCommand extends Command<
  typeof OpenRouterImageInput,
  typeof OpenRouterImageResult
> {
  static actionVerb = 'Generate image';

  async getInputType() {
    return OpenRouterImageInput;
  }

  protected async run(
    input: OpenRouterImageInput,
  ): Promise<OpenRouterImageResult> {
    if (!input.prompt) throw new Error('prompt is required');
    if (!input.targetRealmUrl) throw new Error('targetRealmUrl is required');

    let model = input.model || DEFAULT_IMAGE_MODEL;
    let requestBody: any = {
      model,
      modalities: ['image', 'text'],
      messages: [
        {
          role: 'user',
          content: input.prompt,
        },
      ],
    };

    if (input.aspectRatio || input.imageSize) {
      requestBody.image_config = {};
      if (input.aspectRatio)
        requestBody.image_config.aspect_ratio = input.aspectRatio;
      if (input.imageSize)
        requestBody.image_config.image_size = input.imageSize;
    }

    let result = await new SendRequestViaProxyCommand(
      this.commandContext,
    ).execute({
      url: 'https://openrouter.ai/api/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://realms-staging.stack.cards',
        'X-Title': 'Boxel Image Generator',
      },
      requestBody: JSON.stringify(requestBody),
    });

    let data = await parseProxyJson(result);
    let imageUrl = extractImageDataUrl(data);
    let image = parseDataImageUrl(imageUrl);
    let path = `GeneratedImages/${safeFileStem(input.prompt)}-${Date.now()}.${image.extension}`;

    let written = await new WriteBinaryFileCommand(this.commandContext).execute(
      {
        path,
        realm: input.targetRealmUrl,
        base64Content: image.base64Content,
        contentType: image.contentType,
        useNonConflictingFilename: true,
      },
    );

    let fileIdentifier = written?.fileIdentifier;
    if (!fileIdentifier) {
      throw new Error('Image file write completed without a file identifier.');
    }

    return new OpenRouterImageResult({
      image: new ImageDef({
        id: fileIdentifier,
        sourceUrl: fileIdentifier,
        url: fileIdentifier,
        name: decodeURIComponent(
          fileIdentifier.split('/').pop() ?? 'generated-image',
        ),
        contentType: image.contentType,
        contentSize: image.contentSize,
      }),
      model,
      contentType: image.contentType,
      contentSize: image.contentSize,
      outputText: data?.choices?.[0]?.message?.content ?? '',
    });
  }
}

export { CHATGPT_IMAGE_MODEL, DEFAULT_IMAGE_MODEL };
