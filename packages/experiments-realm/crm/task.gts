import { linksTo, field } from 'https://cardstack.com/base/card-api';
import { TaskBase } from '../task';
import { Contact } from './contact';

export class CrmTask extends TaskBase {
  static displayName = 'CRM Task';
  @field contact = linksTo(Contact);
}
