import {
  CardDef,
  field,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

import { Command } from '@cardstack/runtime-common';
import SendRequestViaProxyCommand from '@cardstack/boxel-host/commands/send-request-via-proxy';

export const DEFAULT_IMAGE_MODEL = 'google/gemini-2.5-flash-image-preview';

class GenerateImagesRotationInput extends CardDef {
  @field productImages = containsMany(StringField, {
    description: 'Array of Base64 encoded product images from different angles',
  });

  @field prompts = containsMany(StringField, {
    description:
      'Prompt strings to request each generated rotation image. Should align with rotation angles.',
  });

  @field rotationAngles = containsMany(StringField, {
    description:
      'Angles used for metadata. Should be the same length and ordering as prompts.',
  });
}

class GenerateImagesRotationResult extends CardDef {
  @field generatedImages = containsMany(StringField, {
    description: 'Array of Base64 encoded generated rotation images',
  });
}

function sanitizePrompts(prompts: string[] | undefined): string[] {
  return (prompts ?? [])
    .map((prompt) => prompt?.trim() ?? '')
    .filter((prompt) => prompt.length > 0);
}

function sanitizeAngles(angles: string[] | undefined): number[] {
  return (angles ?? [])
    .map((angle) => parseInt(angle.trim(), 10))
    .filter((angle) => Number.isFinite(angle));
}

export class GenerateImagesRotation extends Command<
  typeof GenerateImagesRotationInput,
  typeof GenerateImagesRotationResult
> {
  static actionVerb = 'Generate';

  async getInputType() {
    return GenerateImagesRotationInput;
  }

  protected async run(
    input: GenerateImagesRotationInput,
  ): Promise<GenerateImagesRotationResult> {
    const { productImages, prompts, rotationAngles } = input;

    const referenceImages = (productImages ?? []).filter(
      (image) => typeof image === 'string' && image.trim().length > 0,
    );

    if (referenceImages.length === 0) {
      throw new Error('No product images were provided.');
    }

    const promptList = sanitizePrompts(prompts);

    if (promptList.length === 0) {
      throw new Error('At least one prompt is required to generate rotations.');
    }

    const angles = sanitizeAngles(rotationAngles);

    if (angles.length && angles.length !== promptList.length) {
      throw new Error(
        'Rotation angles must be the same length as prompts when provided.',
      );
    }

    const sendRequestCommand = new SendRequestViaProxyCommand(
      this.commandContext,
    );

    const generatedImages: string[] = [];

    for (let index = 0; index < promptList.length; index++) {
      const prompt = promptList[index];

      const content = [
        {
          type: 'text',
          text: prompt,
        },
        ...referenceImages.map((imageUrl) => ({
          type: 'image_url',
          image_url: {
            url: imageUrl,
          },
        })),
      ];

      const result = await sendRequestCommand.execute({
        url: 'https://openrouter.ai/api/v1/chat/completions',
        method: 'POST',
        requestBody: JSON.stringify({
          model: DEFAULT_IMAGE_MODEL,
          messages: [
            {
              role: 'user',
              content,
            },
          ],
        }),
      });

      if (!result.response.ok) {
        const errorText = await result.response.text();
        throw new Error(
          `Failed to generate rotation image: ${result.response.statusText} - ${errorText}`,
        );
      }

      const responseData = await result.response.json();

      if (responseData.error) {
        const errorMsg = responseData.error.message || responseData.error;
        throw new Error(
          `API Error while generating rotation image: ${errorMsg}`,
        );
      }

      const messageContent = responseData.choices?.[0]?.message;
      const images = messageContent?.images;

      if (!Array.isArray(images) || images.length === 0) {
        throw new Error('No images found in the response for a rotation view.');
      }

      const firstValidImage = images.find(
        (img: any) =>
          img?.image_url?.url && img.image_url.url.startsWith('data:image/'),
      );

      if (!firstValidImage?.image_url?.url) {
        throw new Error('No valid base64 image returned for a rotation view.');
      }

      generatedImages.push(firstValidImage.image_url.url);
    }

    return new GenerateImagesRotationResult({
      generatedImages,
    });
  }
}
