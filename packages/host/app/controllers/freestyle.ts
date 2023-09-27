import { ComponentLike } from '@glint/template';
import FreestyleController from 'ember-freestyle/controllers/freestyle';

import SearchSheetUsage from '@cardstack/host/components/search-sheet/usage';

import formatComponentName from '../helpers/format-component-name';

interface UsageComponent {
  title: string;
  component: ComponentLike;
}

export default class IndexController extends FreestyleController {
  formatComponentName = formatComponentName;
  usageComponents: UsageComponent[];
  constructor(...args: any[]) {
    super(...args);
    this.usageComponents = [['SearchSheet', SearchSheetUsage]].map(
      ([name, c]) => {
        return {
          title: name,
          component: c,
        };
      },
    ) as UsageComponent[];
  }
}
