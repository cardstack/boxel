import {
  CardDef,
  contains,
  field,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { Command } from '@cardstack/runtime-common';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
import { Lead } from './lead';
import { Account } from './account';
import { Contact } from './contact';
import { Opportunity } from './opportunity';

export class ConvertLeadInput extends CardDef {
  @field lead = linksTo(Lead, { searchable: true });
  @field realm = contains(StringField);
}

export class ConvertLeadResult extends CardDef {
  @field account = linksTo(Account);
  @field contact = linksTo(Contact);
  @field opportunity = linksTo(Opportunity);
  @field message = contains(StringField);
}

export default class ConvertLeadCommand extends Command<
  typeof ConvertLeadInput,
  typeof ConvertLeadResult
> {
  static actionVerb = 'Convert Lead';

  async getInputType() {
    return ConvertLeadInput;
  }

  protected async run(input: ConvertLeadInput): Promise<ConvertLeadResult> {
    let { lead, realm } = input;
    if (!lead) throw new Error('A lead is required');
    if (!realm) throw new Error('A realm is required');
    if (lead.status === 'disqualified') {
      throw new Error('A disqualified lead cannot be converted');
    }
    if (lead.status === 'converted') {
      throw new Error('This lead has already been converted');
    }

    let save = async <T extends CardDef>(card: T): Promise<T> =>
      (await new SaveCardCommand(this.commandContext).execute({
        card,
        realm,
      } as any)) as T;

    let emailDomain = lead.email?.split('@')[1];
    let accountName = lead.company?.trim() || lead.name || 'New Account';
    let account = await save(
      new Account({
        name: accountName,
        domain: emailDomain,
      }),
    );

    let nameParts = (lead.name ?? '').trim().split(/\s+/);
    let contact = await save(
      new Contact({
        firstName: nameParts[0],
        lastName: nameParts.slice(1).join(' ') || undefined,
        email: lead.email,
        phone: lead.phone,
        account,
      }),
    );

    let opportunity = await save(
      new Opportunity({
        name: `${accountName} — first deal`,
        stage: 'qualified',
        account,
      }),
    );

    lead.status = 'converted';
    await save(lead);

    return new ConvertLeadResult({
      account,
      contact,
      opportunity,
      message: `Converted ${lead.name} into ${accountName} (account + contact + qualified opportunity)`,
    });
  }
}
