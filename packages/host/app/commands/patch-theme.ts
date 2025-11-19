import type * as BaseCommandModule from 'https://cardstack.com/base/command';
import type { Skill } from 'https://cardstack.com/base/skill';

import HostBaseCommand from '../lib/host-base-command';

import UseAiAssistantCommand from './ai-assistant';

export default class PatchThemeCommand extends HostBaseCommand<
  typeof BaseCommandModule.PatchThemeInput,
  typeof BaseCommandModule.SendAiAssistantMessageResult
> {
  description =
    'Open the AI assistant to suggest improvements to a theme card and generate a patch.';

  static actionVerb = 'Patch Theme';

  requireInputFields = ['cardId'];

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { PatchThemeInput } = commandModule;
    return PatchThemeInput;
  }

  protected async run(
    input: BaseCommandModule.PatchThemeInput,
  ): Promise<BaseCommandModule.SendAiAssistantMessageResult> {
    if (!input.cardId) {
      throw new Error('patch-theme command requires a cardId');
    }
    let prompt = [
      'Ask me for possible improvements to modify this theme card (e.g., change font, adjust backgrounds, tweak palettes, spacing, shadows).',
      'Then propose changes and outline the patches you would apply to the theme JSON or CSS variables.',
    ].join('\n');

    let skillIds: string[] = [];
    let linkedSkill = input.skillCard as Skill | undefined;
    let linkedSkillId =
      linkedSkill && typeof linkedSkill.id === 'string'
        ? linkedSkill.id
        : undefined;
    if (linkedSkillId) {
      skillIds.push(linkedSkillId);
    } else {
      try {
        let themeDesignURL = (import.meta as any).loader.importSync?.(
          '@cardstack/catalog/Skill/theme-design',
        )?.id;
        if (typeof themeDesignURL === 'string') {
          skillIds.push(themeDesignURL);
        }
      } catch {
        // Swallow resolution issues; continue without skills
      }
    }

    let useAssistant = new UseAiAssistantCommand(this.commandContext);
    return await useAssistant.execute({
      roomId: 'new',
      openRoom: true,
      llmModel: 'anthropic/claude-3.5-sonnet',
      prompt,
      skillCardIds: skillIds.length ? skillIds : undefined,
      attachedCardIds: [input.cardId],
    });
  }
}
