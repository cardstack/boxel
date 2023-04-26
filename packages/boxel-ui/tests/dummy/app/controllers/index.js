import FreestyleController from 'ember-freestyle/controllers/freestyle';
import CardContainerUsage from '@cardstack/boxel-ui/components/card-container/usage';
import FieldContainerUsage from '@cardstack/boxel-ui/components/field-container/usage';
import HeaderUsage from '@cardstack/boxel-ui/components/header/usage';
import InputUsage from '@cardstack/boxel-ui/components/input/usage';
import InputValidationStateUsage from '@cardstack/boxel-ui/components/input/validation-state/usage';

export default class IndexController extends FreestyleController {
  constructor() {
    super(...arguments);
    this.usageComponents = [
      ['Boxel::CardContainer', CardContainerUsage],
      ['Boxel::FieldContainer', FieldContainerUsage],
      ['Boxel::Header', HeaderUsage],
      ['Boxel::Input', InputUsage],
      ['Boxel::Input::ValidationState', InputValidationStateUsage],
    ].map(([name, c]) => {
      return {
        title: name,
        component: c,
      };
    });
  }
}
