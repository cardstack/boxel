import Controller from '@ember/controller';

import { withPreventDefault } from '../helpers/with-prevent-default';

export default class CardErrorController extends Controller {
  model: any;
  withPreventDefault = withPreventDefault;
}
