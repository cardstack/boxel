import Controller from '@ember/controller';
import { tracked } from '@glimmer/tracking';

export default class IndexController extends Controller {
  queryParams = [
    'authRedirect',
    'hostModeOrigin',
    'hostModeStack',
    'operatorModeState',
    // `sid` and `clientSecret` come from email verification process to reset password
    'sid',
    'clientSecret',
    'card',
    'cardPath',
    'debug', // temporary debug param for debugging AI assistant code patches
  ];

  @tracked authRedirect: string | null = null;
  @tracked hostModeOrigin: string | null = null;
  @tracked hostModeStack: string | null = null;
  @tracked operatorModeState: string | null = null;
  @tracked sid: string | null = null;
  @tracked clientSecret: string | null = null;
  @tracked debug = false;
}
