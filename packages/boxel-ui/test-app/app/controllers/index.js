import FreestyleController from 'ember-freestyle/controllers/freestyle';
import { ALL_USAGE_COMPONENTS } from '@cardstack/boxel-ui/usage';

export default class IndexController extends FreestyleController {
  constructor() {
    super(...arguments);
    this.usageComponents = ALL_USAGE_COMPONENTS.map(([name, c]) => {
      return {
        title: name,
        component: c,
      };
    });
  }
}
