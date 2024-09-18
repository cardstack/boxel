import Controller from '@ember/controller';
import { tracked } from '@glimmer/tracking';

export default class CardController extends Controller {
  queryParams = [
    'card',
    'operatorModeState',
    'operatorModeEnabled',
    // `sid` and `clientSecret` come from email verification process to reset password
    'sid',
    'clientSecret',
    'workspaceChooserOpened',
  ];

  @tracked operatorModeEnabled = false;
  @tracked operatorModeState: string | null = null;
  @tracked sid: string | null = null;
  @tracked clientSecret: string | null = null;
  @tracked workspaceChooserOpened = false;
}
