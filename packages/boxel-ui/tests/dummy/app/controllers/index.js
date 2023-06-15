import FreestyleController from 'ember-freestyle/controllers/freestyle';
import CardContainerUsage from '@cardstack/boxel-ui/components/card-container/usage';
import FieldContainerUsage from '@cardstack/boxel-ui/components/field-container/usage';
import HeaderUsage from '@cardstack/boxel-ui/components/header/usage';
import ButtonUsage from '@cardstack/boxel-ui/components/button/usage';
import IconButtonUsage from '@cardstack/boxel-ui/components/icon-button/usage';
import InputUsage from '@cardstack/boxel-ui/components/input/usage';
import InputValidationStateUsage from '@cardstack/boxel-ui/components/input/validation-state/usage';
import LoadingIndicatorUsage from '@cardstack/boxel-ui/components/loading-indicator/usage';
import MessageUsage from '@cardstack/boxel-ui/components/message/usage';
import ModalUsage from '@cardstack/boxel-ui/components/modal/usage';
import DropdownUsage from '@cardstack/boxel-ui/components/dropdown/usage';

export default class IndexController extends FreestyleController {
  constructor() {
    super(...arguments);
    this.usageComponents = [
      ['Boxel::CardContainer', CardContainerUsage],
      ['Boxel::FieldContainer', FieldContainerUsage],
      ['Boxel::Header', HeaderUsage],
      ['Boxel::Button', ButtonUsage],
      ['Boxel::IconButton', IconButtonUsage],
      ['Boxel::Input', InputUsage],
      ['Boxel::Input::ValidationState', InputValidationStateUsage],
      ['Boxel::LoadingIndicator', LoadingIndicatorUsage],
      ['Boxel::Modal', ModalUsage],
      ['Boxel::Message', MessageUsage],
      ['Boxel::Dropdown', DropdownUsage],
    ].map(([name, c]) => {
      return {
        title: name,
        component: c,
      };
    });
  }
}
