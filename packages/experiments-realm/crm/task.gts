import { linksTo, field } from 'https://cardstack.com/base/card-api';
import { Task } from '../task';
import { Contact } from './contact';
import { Account } from './account';

export class CrmTask extends Task {
  static displayName = 'CRM Task';
  @field contact = linksTo(Contact);
  @field account = linksTo(Account);
}
