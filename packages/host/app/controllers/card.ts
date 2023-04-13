import Controller from '@ember/controller';
import ENV from '@cardstack/host/config/environment';
import { withPreventDefault } from '../helpers/with-prevent-default';

const { isLocalRealm } = ENV;

export default class CardController extends Controller {
  isLocalRealm = isLocalRealm;
  model: any;
  withPreventDefault = withPreventDefault;
}
