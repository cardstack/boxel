import { CardDef, contains, field, linksTo } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import { Command } from '@cardstack/runtime-common';
import GetCardCommand from '@cardstack/boxel-host/commands/get-card';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
import { Campaign } from './campaign';

// Launch Campaign — transitions an existing Campaign from `planned` to
// `running`. `campaign.gts`'s own `CampaignStatusField` is a plain enum with
// no transition graph (unlike Order/Payment/Pipeline Stage/Payment Status),
// so this command carries its own guard rather than reaching for
// `canTransition` — extracting a full statusField for Campaign is out of
// scope here (Campaign itself isn't one of the 18 concepts this app fills;
// only the Launch Campaign command is).

export class LaunchCampaignInput extends CardDef {
  @field campaign = linksTo(Campaign, { searchable: true });
  @field realm = contains(StringField);
}

export class LaunchCampaignResult extends CardDef {
  @field campaign = linksTo(Campaign);
  @field message = contains(StringField);
}

export default class LaunchCampaignCommand extends Command<
  typeof LaunchCampaignInput,
  typeof LaunchCampaignResult
> {
  static actionVerb = 'Launch Campaign';

  async getInputType() {
    return LaunchCampaignInput;
  }

  protected async run(
    input: LaunchCampaignInput,
  ): Promise<LaunchCampaignResult> {
    let { campaign, realm } = input;
    if (!campaign) throw new Error('A campaign is required');
    if (!realm) throw new Error('A realm is required');

    if (campaign.id) {
      campaign = (await new GetCardCommand(this.commandContext).execute({
        cardId: campaign.id,
      })) as Campaign;
    }

    if (campaign.status !== 'planned') {
      throw new Error(
        `Only a "planned" campaign can be launched (this one is "${campaign.status}")`,
      );
    }

    campaign.status = 'running';
    await new SaveCardCommand(this.commandContext).execute({
      card: campaign,
      realm,
    } as any);

    return new LaunchCampaignResult({
      campaign,
      message: `"${campaign.name}" is now running.`,
    });
  }
}
