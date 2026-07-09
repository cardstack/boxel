import HostBaseTool from '../lib/host-base-tool';

import UseAiAssistantTool from './ai-assistant';

import type * as BaseToolModule from '@cardstack/base/command';
import type { Skill } from '@cardstack/base/skill';

export default class PatchThemeTool extends HostBaseTool<
  typeof BaseToolModule.PatchThemeInput,
  typeof BaseToolModule.SendAiAssistantMessageResult
> {
  description =
    'Open the AI assistant to suggest improvements to a theme card and generate a patch.';

  static actionVerb = 'Patch Theme';

  requireInputFields = ['cardId'];

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { PatchThemeInput } = commandModule;
    return PatchThemeInput;
  }

  protected async run(
    input: BaseToolModule.PatchThemeInput,
  ): Promise<BaseToolModule.SendAiAssistantMessageResult> {
    if (!input.cardId) {
      throw new Error('patch-theme command requires a cardId');
    }
    let prompt = [
      'Ask me for possible improvements to modify this theme card (e.g., change font, adjust backgrounds, tweak palettes, spacing, shadows).',
      'Then propose changes and outline the patches you would apply to the theme JSON or CSS variables.',
    ].join('\n');

    let linkedSkill = input.skillCard as Skill | undefined;
    let linkedSkillId =
      linkedSkill && typeof linkedSkill.id === 'string'
        ? linkedSkill.id
        : undefined;

    let useAssistant = new UseAiAssistantTool(this.commandContext);
    return await useAssistant.execute({
      roomId: 'new',
      openRoom: true,
      llmModel: 'anthropic/claude-3.5-sonnet',
      prompt,
      skillCardIds: linkedSkillId ? [linkedSkillId] : undefined,
      attachedCardIds: [input.cardId],
    });
  }
}

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { PatchThemeTool as PatchThemeCommand };
