import { CardDef, contains, field, linksTo } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import { Command } from '@cardstack/runtime-common';
import GetCardCommand from '@cardstack/boxel-host/commands/get-card';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
import { Opportunity } from './opportunity';
import { PipelineStageField, canTransition } from './pipeline-stage-field';

// Advance Deal — moves an Opportunity/Deal's Pipeline Stage forward,
// guarded by the stage graph in `pipeline-stage-field.gts`. Mirrors this
// realm's established "state lives on the card, transitions are commands"
// convention (Order/Payment/CloseWon). Re-fetches the subject before reading
// its stage, per that same convention — a caller may pass a card whose
// fields were never loaded.

export class AdvanceDealInput extends CardDef {
  @field deal = linksTo(Opportunity, { searchable: true });
  @field toStage = contains(StringField);
  @field realm = contains(StringField);
}

export class AdvanceDealResult extends CardDef {
  @field deal = linksTo(Opportunity);
  @field message = contains(StringField);
}

export default class AdvanceDealCommand extends Command<
  typeof AdvanceDealInput,
  typeof AdvanceDealResult
> {
  static actionVerb = 'Advance Deal';

  async getInputType() {
    return AdvanceDealInput;
  }

  protected async run(
    input: AdvanceDealInput,
  ): Promise<AdvanceDealResult> {
    let { deal, toStage, realm } = input;
    if (!deal) throw new Error('A deal or opportunity is required');
    if (!toStage) throw new Error('A target stage is required');
    if (!realm) throw new Error('A realm is required');

    if (deal.id) {
      deal = (await new GetCardCommand(this.commandContext).execute({
        cardId: deal.id,
      })) as Opportunity;
    }

    if (!canTransition(PipelineStageField as any, deal.stage, toStage)) {
      throw new Error(
        `Cannot move a deal from "${deal.stage}" to "${toStage}"`,
      );
    }

    deal.stage = toStage;
    deal.lastStageChangedAt = new Date();
    await new SaveCardCommand(this.commandContext).execute({
      card: deal,
      realm,
    } as any);

    return new AdvanceDealResult({
      deal,
      message: `Deal moved to "${toStage}".`,
    });
  }
}
