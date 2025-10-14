import {
  CardDef,
  field,
  contains,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import DateField from 'https://cardstack.com/base/date';
import UseAiAssistantCommand from '@cardstack/boxel-host/commands/ai-assistant';
import {
  Command,
  isResolvedCodeRef,
  DEFAULT_CODING_LLM,
} from '@cardstack/runtime-common';
import { SearchCardsByQueryCommand } from '@cardstack/boxel-host/commands/search-cards';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
import { DailyReport } from '../daily-report-dashboard/daily-report';
import { PolicyManual } from '../daily-report-dashboard/policy-manual';
import GetCardCommand from '@cardstack/boxel-host/commands/get-card';

class DailyReportInput extends CardDef {
  @field policyManual = linksTo(PolicyManual);
  @field realm = contains(StringField);
  @field date = contains(DateField);
}
export class GenerateDailyReport extends Command<
  typeof DailyReportInput,
  undefined
> {
  static actionVerb = 'Create';

  async getInputType() {
    return DailyReportInput;
  }

  protected async run(input: DailyReportInput): Promise<undefined> {
    let { realm, policyManual, date } = input;
    if (!realm) {
      throw new Error('Realm is required');
    }
    if (!policyManual) {
      throw new Error('Policy manual is required');
    }
    let activityLogCardType = policyManual.activityLogCardType;
    if (!activityLogCardType || !isResolvedCodeRef(activityLogCardType)) {
      throw new Error('Activity log card type is required');
    }
    try {
      let searchCommand = new SearchCardsByQueryCommand(this.commandContext);
      let targetDate = date || new Date();
      let startOfDay = new Date(targetDate);
      startOfDay.setHours(0, 0, 0, 0);
      let endOfDay = new Date(targetDate);
      endOfDay.setHours(23, 59, 59, 999);
      let results = await searchCommand.execute({
        query: {
          filter: {
            range: {
              timestamp: {
                gte: startOfDay.toISOString(),
                lte: endOfDay.toISOString(),
              },
            },
            on: {
              module: activityLogCardType.module,
              name: activityLogCardType.name,
            },
          },
          sort: [
            {
              by: 'createdAt',
              direction: 'desc',
            },
          ],
        },
      });

      let foundCards = await Promise.all(
        results.cardIds.map(async (cardId) => {
          let card = await new GetCardCommand(this.commandContext).execute({
            cardId,
          });
          return card;
        }),
      );
      let dailyReportCard = new DailyReport({
        reportDate: targetDate,
        policyManual: policyManual,
        summary: foundCards.length > 0 ? 'Analysing...' : 'No Reports Found',
      });

      await new SaveCardCommand(this.commandContext).execute({
        card: dailyReportCard,
        realm,
      });

      let prompt =
        'Generate daily report for the selected date from the attached activity log cards using the policy manual and update the attached daily report card';
      let skillCardId = new URL('../Skill/daily-report-skill', import.meta.url)
        .href;
      let useCommand = new UseAiAssistantCommand(this.commandContext);
      await useCommand.execute({
        roomId: 'new',
        prompt,
        attachedCards: [policyManual, dailyReportCard, ...foundCards],
        openRoom: true,
        llmModel: DEFAULT_CODING_LLM,
        llmMode: 'act',
        skillCardIds: [skillCardId],
      });
    } catch (error: any) {
      throw new Error(`❌ Failed: ${error.message}`);
    }
  }
}
