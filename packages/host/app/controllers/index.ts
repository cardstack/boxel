import Controller from '@ember/controller';
import { tracked } from '@glimmer/tracking';

// The app's own query params. Exported because consumers need to tell
// this internal routing state apart from foreign params that merely ride
// along on the URL (e.g. `utm_source`): the router hydrates every entry
// here onto `transition.to.queryParams`, defaults included, whether or
// not it appeared in the URL.
export const INDEX_QUERY_PARAMS = [
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

export default class IndexController extends Controller {
  queryParams = INDEX_QUERY_PARAMS;

  @tracked authRedirect: string | null = null;
  @tracked hostModeOrigin: string | null = null;
  @tracked hostModeStack: string | null = null;
  @tracked operatorModeState: string | null = null;
  @tracked sid: string | null = null;
  @tracked clientSecret: string | null = null;
  @tracked debug = false;
}
