import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import SendRequestViaProxyCommand from './send-request-via-proxy';
import GetCardCommand from './get-card';
import PatchFieldsCommand from './patch-fields';
import { FieldPathParser } from '../lib/field-path-parser';

// Command to apply markdown edits using relace/relace-apply-3 model
export default class ApplyMarkdownEditCommand extends HostBaseCommand<
  typeof BaseCommandModule.ApplyMarkdownEditInput,
  undefined
> {
  static actionVerb = 'Apply Markdown Edit';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { ApplyMarkdownEditInput } = commandModule;
    return ApplyMarkdownEditInput;
  }

  protected async run(
    input: BaseCommandModule.ApplyMarkdownEditInput,
  ): Promise<undefined> {
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

    // Get current markdown content from the field (supports dotted/array paths)
    const pathParts = FieldPathParser.parseFieldPath(input.fieldPath);
    let currentNode: any = card as any;
    for (const part of pathParts) {
      if (part.startsWith('[') && part.endsWith(']')) {
        const indexStr = part.slice(1, -1);
        if (indexStr === '' || indexStr === '-1') {
          throw new Error(
            `Field path "${input.fieldPath}" uses append syntax which is invalid when reading a value`,
          );
        }
        const index = parseInt(indexStr, 10);
        if (Number.isNaN(index)) {
          throw new Error(
            `Field path "${input.fieldPath}" contains an invalid array index`,
          );
        }
        if (!Array.isArray(currentNode)) {
          throw new Error(`Field path "${input.fieldPath}" not found on card`);
        }
        currentNode = currentNode[index];
      } else {
        currentNode = currentNode?.[part];
      }

      if (currentNode === undefined || currentNode === null) {
        throw new Error(`Field path "${input.fieldPath}" not found on card`);
      }
    }

    if (typeof currentNode !== 'string') {
      throw new Error(`Field "${input.fieldPath}" is not a string field`);
    }
    const fullFieldContent = currentNode;

    // Determine what content to send to the model
    // If currentContent is provided, use it (focused edit mode)
    // Otherwise, fall back to full field content (legacy mode)
    const hasFocusedContent = Boolean(input.currentContent?.trim());
    const contentForModel = hasFocusedContent
      ? input.currentContent!
      : fullFieldContent;

    // Validate focused content exists in the field (if provided)
    let focusedContentIndex = -1;
    if (hasFocusedContent) {
      focusedContentIndex = fullFieldContent.indexOf(contentForModel);
      if (focusedContentIndex === -1) {
        throw new Error(
          `The provided currentContent was not found in the field. ` +
            `Make sure it exactly matches a portion of the existing content.`,
        );
      }
      const secondOccurrenceIndex = fullFieldContent.indexOf(
        contentForModel,
        focusedContentIndex + contentForModel.length,
      );
      if (secondOccurrenceIndex !== -1) {
        throw new Error(
          `The provided currentContent matches multiple places in the field. ` +
            `Provide a more specific selection to disambiguate the edit.`,
        );
      }
    }

    const escapeForTag = (value: string) =>
      value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Call OpenRouter's relace-apply-3 model to apply the diff
    const requestBody = {
      model: 'relace/relace-apply-3',
      messages: [
        {
          role: 'user',
          content: `<instruction>${escapeForTag(
            input.instructions,
          )}</instruction>\n<code>${escapeForTag(
            contentForModel,
          )}</code>\n<update>${escapeForTag(input.markdownDiff)}</update>`,
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
    if (newContent === undefined || newContent === null) {
      throw new Error('No content returned from OpenRouter');
    }

    // Compute final field content
    // If we used focused mode, replace that section in the full content
    // Otherwise, use the model's output directly
    let finalContent: string;
    if (hasFocusedContent) {
      let replaceStart = focusedContentIndex;
      let replaceEnd = focusedContentIndex + input.currentContent!.length;
      // When deleting content, also drop a single trailing newline to avoid accumulating blank lines
      if (newContent === '' && fullFieldContent[replaceEnd] === '\n') {
        replaceEnd += 1;
      }
      const trailingContent = fullFieldContent.slice(replaceEnd);
      // If the model already returned the full field (including the trailing content),
      // avoid appending it a second time.
      if (trailingContent && newContent.endsWith(trailingContent)) {
        finalContent = newContent;
      } else {
        finalContent =
          fullFieldContent.slice(0, replaceStart) +
          newContent +
          trailingContent;
      }
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

    return undefined;
  }
}
