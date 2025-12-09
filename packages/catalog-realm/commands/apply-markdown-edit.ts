import { Command } from '@cardstack/runtime-common';
import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import SendRequestViaProxyCommand from '@cardstack/boxel-host/commands/send-request-via-proxy';
import GetCardCommand from '@cardstack/boxel-host/commands/get-card';
import PatchFieldsCommand from '@cardstack/boxel-host/commands/patch-fields';

class ApplyMarkdownEditInput extends CardDef {
  @field cardId = contains(StringField);
  @field fieldPath = contains(StringField);
  @field markdownDiff = contains(StringField); // The replacement/result text
  @field instructions = contains(StringField);
  @field currentContent = contains(StringField); // Optional focused section to transform
}

// Command to apply markdown edits using relace/relace-apply-3 model
export class ApplyMarkdownEditCommand extends Command<
  typeof ApplyMarkdownEditInput,
  undefined
> {
  static actionVerb = 'Apply Markdown Edit';

  async getInputType() {
    return ApplyMarkdownEditInput;
  }

  protected async run(input: ApplyMarkdownEditInput): Promise<undefined> {
    // Validate inputs
    if (!input.cardId?.trim()) {
      throw new Error('Card ID is required');
    }
    if (!input.fieldPath?.trim()) {
      throw new Error('Field path is required');
    }
    if (!input.markdownDiff?.trim()) {
      throw new Error('Markdown diff is required');
    }
    if (!input.instructions?.trim()) {
      throw new Error('Instructions are required');
    }

    // Get the card
    const getCard = new GetCardCommand(this.commandContext);
    const card = await getCard.execute({ cardId: input.cardId });

    if (!card) {
      throw new Error(`Card not found: ${input.cardId}`);
    }

    // Get current markdown content from the field
    const fieldParts = input.fieldPath.split('.');
    let fullFieldContent = card as any;

    for (const part of fieldParts) {
      fullFieldContent = fullFieldContent?.[part];
      if (fullFieldContent === undefined || fullFieldContent === null) {
        throw new Error(`Field path "${input.fieldPath}" not found on card`);
      }
    }

    if (typeof fullFieldContent !== 'string') {
      throw new Error(`Field "${input.fieldPath}" is not a string field`);
    }

    // Determine what content to send to the model
    // If currentContent is provided, use it (focused edit mode)
    // Otherwise, fall back to full field content (legacy mode)
    const hasFocusedContent = input.currentContent?.trim();
    const contentForModel = hasFocusedContent
      ? input.currentContent
      : fullFieldContent;

    // Validate focused content exists in the field (if provided)
    if (
      hasFocusedContent &&
      !fullFieldContent.includes(input.currentContent!)
    ) {
      throw new Error(
        `The provided currentContent was not found in the field. ` +
          `Make sure it exactly matches a portion of the existing content.`,
      );
    }

    // Call OpenRouter's relace-apply-3 model to apply the diff
    const requestBody = {
      model: 'relace/relace-apply-3',
      messages: [
        {
          role: 'user',
          content: `<instruction>${input.instructions}</instruction>\n<code>${contentForModel}</code>\n<update>${input.markdownDiff}</update>`,
        },
      ],
    };

    const response = await new SendRequestViaProxyCommand(
      this.commandContext,
    ).execute({
      url: 'https://openrouter.ai/api/v1/chat/completions',
      method: 'POST',
      requestBody: JSON.stringify(requestBody),
      headers: {
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://app.boxel.ai',
        'X-Title': 'Boxel Markdown Editor',
      },
    });

    if (!response.response.ok) {
      throw new Error(
        `OpenRouter request failed: ${response.response.statusText}`,
      );
    }

    // Parse the response
    let data;
    try {
      data = await response.response.json();
    } catch (e: any) {
      throw new Error(`Failed to parse OpenRouter response: ${e.message}`);
    }

    const newContent = data.choices?.[0]?.message?.content;
    if (!newContent) {
      throw new Error('No content returned from OpenRouter');
    }

    // Compute final field content
    // If we used focused mode, replace that section in the full content
    // Otherwise, use the model's output directly
    let finalContent: string;
    if (hasFocusedContent) {
      finalContent = fullFieldContent.replace(
        input.currentContent!,
        newContent,
      );
    } else {
      finalContent = newContent;
    }

    // Patch only the specific markdown field
    await new PatchFieldsCommand(this.commandContext).execute({
      cardId: input.cardId,
      fieldUpdates: {
        [input.fieldPath]: finalContent,
      },
    });

    // Command completed - no return needed
    return undefined;
  }
}
