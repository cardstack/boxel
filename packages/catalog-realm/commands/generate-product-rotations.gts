import {
  CardDef,
  field,
  contains,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

import { Command } from '@cardstack/runtime-common';
import SendRequestViaProxyCommand from '@cardstack/boxel-host/commands/send-request-via-proxy';

export const DEFAULT_IMAGE_MODEL = 'google/gemini-2.5-flash-image-preview';

export function buildRotationPrompt(
  angle: number,
  productDescription: string,
): string {
  return `
      Generate a high-quality product image of the following item rotated ${angle} degrees around its vertical axis: ${productDescription}.

      - Use the provided reference images to understand the product's shape, materials, colors, and details.
      - All generated images must match the style of the reference images: if the references are 2D, generate 2D-style images; if they are 3D, generate 3D-style images. The style (2D or 3D) must be consistent across all generated views.
      - Keep the lighting, style, and proportions consistent with the reference images.
      - Show the product from the ${angle}° viewpoint while maintaining photorealistic quality and the same background style.
      - The product should look like the same object, just rotated to show different sides.
      - Make sure the generated view is consistent with the original product's materials, colors, and details from the reference images.
      `.trim();
}

class GenerateProductRotationsInput extends CardDef {
  @field productImages = containsMany(StringField, {
    description: 'Array of Base64 encoded product images from different angles',
  });

  @field productDescription = contains(StringField, {
    description:
      'Detailed description of the product for consistent generation',
  });

  @field rotationAngles = contains(StringField, {
    description:
      'Comma-separated list of rotation angles (default: 0,45,90,135,180,225,270,315)',
  });
}

class GenerateProductRotationsResult extends CardDef {
  @field generatedImages = containsMany(StringField, {
    description: 'Array of Base64 encoded generated rotation images',
  });
}

export class GenerateProductRotations extends Command<
  typeof GenerateProductRotationsInput,
  typeof GenerateProductRotationsResult
> {
  static actionVerb = 'Generate';

  async getInputType() {
    return GenerateProductRotationsInput;
  }

  protected async run(
    input: GenerateProductRotationsInput,
  ): Promise<GenerateProductRotationsResult> {
    const { productImages, productDescription, rotationAngles } = input;

    if (!productImages) {
      throw new Error('No product images provided');
    }

    if (!productDescription) {
      throw new Error('No product description provided');
    }

    // Parse rotation angles or use default
    const angles = rotationAngles
      ? rotationAngles.split(',').map((angle) => parseInt(angle.trim()))
      : [0, 45, 90, 135, 180, 225, 270, 315];

    // Validate angles
    const validAngles = angles.filter(
      (angle) => !isNaN(angle) && angle >= 0 && angle < 360,
    );

    if (validAngles.length === 0) {
      throw new Error('No valid rotation angles provided');
    }

    // Send the request via host proxy
    const sendRequestCommand = new SendRequestViaProxyCommand(
      this.commandContext,
    );

    const generatedImages: string[] = [];

    // productImages is now already an array of strings
    const referenceImages = productImages.filter(
      (img) => img && img.trim().length > 0,
    );

    if (referenceImages.length === 0) {
      throw new Error('No valid reference images provided');
    }

    // Generate images for each angle
    for (const angle of validAngles) {
      const prompt = buildRotationPrompt(angle, productDescription);

      // Build content array with text and all reference images
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
              content: content,
            },
          ],
        }),
      });

      if (!result.response.ok) {
        const errorText = await result.response.text();
        console.error(`API Error for ${angle}° view:`, errorText);
        throw new Error(
          `Failed to generate ${angle}° view: ${result.response.statusText} - ${errorText}`,
        );
      }

      const responseData = await result.response.json();

      if (responseData.error) {
        const errorMsg = responseData.error.message || responseData.error;
        console.error(`API Error for ${angle}° view:`, responseData.error);
        throw new Error(`API Error for ${angle}° view: ${errorMsg}`);
      }

      const messageContent = responseData.choices?.[0]?.message;
      const images = messageContent?.images;

      if (!Array.isArray(images) || images.length === 0) {
        throw new Error(`No images found in response for ${angle}° view`);
      }

      const firstValidImage = images.find(
        (img: any) =>
          img?.image_url?.url && img.image_url.url.startsWith('data:image/'),
      );

      if (firstValidImage?.image_url?.url) {
        generatedImages.push(firstValidImage.image_url.url);
      } else {
        throw new Error(`No valid image generated for ${angle}° view`);
      }
    }

    return new GenerateProductRotationsResult({
      generatedImages,
    });
  }
}
