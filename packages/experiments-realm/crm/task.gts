import { linksTo, field } from 'https://cardstack.com/base/card-api';
import { Task } from '../task';
import { Contact } from './contact';

export class CrmTask extends Task {
  static displayName = 'CRM Task';
  @field contact = linksTo(Contact);
}
