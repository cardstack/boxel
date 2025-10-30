import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

import { Command } from '@cardstack/runtime-common';
import SendRequestViaProxyCommand from '@cardstack/boxel-host/commands/send-request-via-proxy';

import { buildAICues } from '../utils/external/avataar';
import Avatar from '../fields/avatar';

class CreateRealImageInput extends CardDef {
  @field avatar = contains(Avatar, {
    description: 'Avatar model configuration',
  });

  @field avatarUrl = contains(StringField, {
    description: 'URL of the avatar image to use as reference',
  });

  @field notes = contains(StringField, {
    description: 'Optional notes string used for schema/context',
  });
}

export class CreateRealImage extends Command<
  typeof CreateRealImageInput,
  undefined
> {
  static actionVerb = 'Generate';
  static displayName = 'Create Real Image';

  result?: { success: boolean; imageUrl?: string; error?: string };

  async getInputType() {
    return CreateRealImageInput;
  }

  protected async run(input: CreateRealImageInput): Promise<undefined> {
    const { avatar, avatarUrl, notes } = input;

    if (!avatarUrl) {
      throw new Error('No avatar URL available');
    }

    const aiCues = buildAICues(avatar);
    const configSchema = notes || '';

    const prompt = `Imagine this avatar as a beloved main character in a modern, live-action, TV-14 series that appeals to both kids and adults. Render a realistic, high-quality headshot portrait (1:1 aspect ratio, facing forward) as if photographed with a Sony A74 and professionally retouched for a poster.

      - Guess and visually express: age, sex, location, time of year, religion, race/ethnicity, mood (be authentic—even unusual emotions are welcome), and current situation, based on the avatar's features. Ensure broad and inclusive representation.
      - Exaggerate emotions as a talented actor would.
      - Highlight subtle details as a skilled makeup artist would: e.g., eyes open or closed, tongue, hair color, etc.
      - Any special effects (SFX) should be photorealistic and seamlessly composited.
      - Use a natural, unobtrusive background. No borders or text.

      ${aiCues}

      IMPORTANT: Only use valid avatar configuration values. Reference this schema for accurate interpretations:

      ${configSchema}

      ${avatarUrl}`;

    // Send the request via host proxy
    const sendRequestCommand = new SendRequestViaProxyCommand(
      this.commandContext,
    );
    const result = await sendRequestCommand.execute({
      url: 'https://openrouter.ai/api/v1/chat/completions',
      method: 'POST',
      requestBody: JSON.stringify({
        model: 'google/gemini-2.5-flash-image-preview',
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    });

    if (!result.response.ok) {
      this.result = {
        success: false,
        error: `Failed to make request: ${result.response.statusText}`,
      };
      return;
    }

    try {
      const responseData = await result.response.json();
      if (responseData.error) {
        const errorMsg = responseData.error.message || responseData.error;
        this.result = { success: false, error: `API Error: ${errorMsg}` };
        return;
      }

      const messageContent = responseData.choices?.[0]?.message;
      const images = messageContent?.images;
      if (!Array.isArray(images) || images.length === 0) {
        this.result = { success: false, error: 'No images found in response' };
        return;
      }

      const firstValidImage = images.find(
        (img: any) =>
          img?.image_url?.url && img.image_url.url.startsWith('data:image/'),
      );

      if (firstValidImage?.image_url?.url) {
        this.result = {
          success: true,
          imageUrl: firstValidImage.image_url.url,
        };
        return;
      }

      this.result = {
        success: false,
        error: 'No valid images generated in response',
      };
    } catch (e: any) {
      this.result = {
        success: false,
        error: e?.message || 'Unknown error occurred',
      };
    }
  }
}
