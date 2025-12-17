import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import UrlField from 'https://cardstack.com/base/url';
import { Command } from '@cardstack/runtime-common';
import SendRequestViaProxyCommand from '@cardstack/boxel-host/commands/send-request-via-proxy';
import UploadImageCommand from './upload-image';

class GenerateImageInput extends CardDef {
  @field prompt = contains(StringField);
  @field sourceImageUrl = contains(StringField);
  @field targetRealmUrl = contains(StringField);
}

class GenerateImageOutput extends CardDef {
  @field url = contains(UrlField);
  @field cardId = contains(StringField);
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const maybeBuffer = (globalThis as any).Buffer;

  if (typeof maybeBuffer !== 'undefined') {
    return maybeBuffer.from(buffer).toString('base64');
  }

  let binary = '';
  const bytes = new Uint8Array(buffer);

  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  if (typeof btoa !== 'undefined') {
    return btoa(binary);
  }

  throw new Error('Unable to convert image to base64 in this environment');
}

export class GenerateImageCommand extends Command<
  typeof GenerateImageInput,
  typeof GenerateImageOutput
> {
  static actionVerb = 'Generate';

  async getInputType() {
    return GenerateImageInput;
  }

  async getOutputType() {
    return GenerateImageOutput;
  }

  protected async run(input: GenerateImageInput): Promise<GenerateImageOutput> {
    const { prompt, sourceImageUrl, targetRealmUrl } = input;
    const sourceUrlTrimmed = sourceImageUrl?.trim();

    if (!sourceUrlTrimmed) {
      throw new Error('A source image URL is required to generate an image.');
    }

    let imageUrlForMessage: string | undefined;

    if (sourceUrlTrimmed.startsWith('data:image/')) {
      imageUrlForMessage = sourceUrlTrimmed;
    } else {
      const imageResponse = await fetch(sourceUrlTrimmed);

      if (!imageResponse.ok) {
        throw new Error(
          `Failed to fetch source image: ${imageResponse.statusText}`,
        );
      }

      const contentType =
        imageResponse.headers.get('content-type') ?? 'image/png';
      const arrayBuffer = await imageResponse.arrayBuffer();
      const base64 = arrayBufferToBase64(arrayBuffer);
      imageUrlForMessage = `data:${contentType};base64,${base64}`;
    }

    let promptText = prompt?.trim();
    if (!promptText) {
      throw new Error('A prompt is required to generate an image.');
    }

    const messages: any[] = [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: promptText,
          },
          ...(imageUrlForMessage
            ? [
                {
                  type: 'image_url',
                  image_url: {
                    url: imageUrlForMessage,
                  },
                },
              ]
            : []),
        ],
      },
    ];

    const sendRequestViaProxyCommand = new SendRequestViaProxyCommand(
      this.commandContext,
    );

    const result = await sendRequestViaProxyCommand.execute({
      url: 'https://openrouter.ai/api/v1/chat/completions',
      method: 'POST',
      requestBody: JSON.stringify({
        model: 'google/gemini-2.5-flash-image-preview',
        messages,
      }),
    });

    if (!result.response.ok) {
      throw new Error(
        `Failed to generate image: ${result.response.statusText}`,
      );
    }

    const responseData = await result.response.json();
    const messageContent = responseData.choices?.[0]?.message;

    if (!messageContent?.images || !Array.isArray(messageContent.images)) {
      throw new Error('No image was generated in the response.');
    }

    const generatedImageUrl = messageContent.images
      .map((img: any) => img.image_url?.url)
      .find((url: string) => url && url.startsWith('data:image/'));

    if (!generatedImageUrl) {
      const errorMessage =
        responseData.choices?.[0]?.message?.content ||
        'No image was generated in the response.';
      throw new Error(`Image generation failed: ${errorMessage}`);
    }

    let uploadedImageUrl: string | undefined;
    let uploadedCardId: string | undefined;
    if (targetRealmUrl) {
      try {
        let uploadCommand = new UploadImageCommand(this.commandContext);
        let uploadResult = await uploadCommand.execute({
          sourceImageUrl: generatedImageUrl,
          targetRealmUrl,
        });

        uploadedCardId = uploadResult?.cardId;

        let store = (this.commandContext as any)?.store;
        if (uploadResult?.cardId && store?.get) {
          let savedCard = await store.get(uploadResult.cardId);
          uploadedImageUrl = (savedCard as any)?.url;
        }
      } catch (error) {
        console.error(
          'UploadImageCommand failed, falling back to data URL:',
          error,
        );
      }
    }

    return new GenerateImageOutput({
      url: uploadedImageUrl ?? generatedImageUrl,
      cardId: uploadedCardId ?? '',
    });
  }
}
