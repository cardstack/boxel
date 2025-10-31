import Controller from '@ember/controller';

import { withPreventDefault } from '../helpers/with-prevent-default';

export default class IndexErrorController extends Controller {
  model: any;
  withPreventDefault = withPreventDefault;
}
