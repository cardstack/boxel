import FreestyleController from 'ember-freestyle/controllers/freestyle';
import AccordionUsage from '@cardstack/boxel-ui/components/accordion/usage';
import AddButtonUsage from '@cardstack/boxel-ui/components/add-button/usage';
import CardContainerUsage from '@cardstack/boxel-ui/components/card-container/usage';
import FieldContainerUsage from '@cardstack/boxel-ui/components/field-container/usage';
import GridContainerUsage from '@cardstack/boxel-ui/components/grid-container/usage';
import HeaderUsage from '@cardstack/boxel-ui/components/header/usage';
import ButtonUsage from '@cardstack/boxel-ui/components/button/usage';
import IconButtonUsage from '@cardstack/boxel-ui/components/icon-button/usage';
import InputUsage from '@cardstack/boxel-ui/components/input/usage';
import SearchInputUsage from '@cardstack/boxel-ui/components/input/search-input/usage';
import InputValidationStateUsage from '@cardstack/boxel-ui/components/input/validation-state/usage';
import LoadingIndicatorUsage from '@cardstack/boxel-ui/components/loading-indicator/usage';
import MessageUsage from '@cardstack/boxel-ui/components/message/usage';
import ModalUsage from '@cardstack/boxel-ui/components/modal/usage';
import MenuUsage from '@cardstack/boxel-ui/components/menu/usage';
import DropdownUsage from '@cardstack/boxel-ui/components/dropdown/usage';
import TooltipUsage from '@cardstack/boxel-ui/components/tooltip/usage';
import ResizablePanelGroupUsage from '@cardstack/boxel-ui/components/resizable-panel-group/usage';
import RadioInput from '@cardstack/boxel-ui/components/radio-input/usage';

export default class IndexController extends FreestyleController {
  constructor() {
    super(...arguments);
    this.usageComponents = [
      ['Boxel::Accordion', AccordionUsage],
      ['Boxel::AddButton', AddButtonUsage],
      ['Boxel::CardContainer', CardContainerUsage],
      ['Boxel::FieldContainer', FieldContainerUsage],
      ['Boxel::GridContainer', GridContainerUsage],
      ['Boxel::Header', HeaderUsage],
      ['Boxel::Button', ButtonUsage],
      ['Boxel::IconButton', IconButtonUsage],
      ['Boxel::Input', InputUsage],
      ['Boxel::Input::SearchInput', SearchInputUsage],
      ['Boxel::Input::ValidationState', InputValidationStateUsage],
      ['Boxel::LoadingIndicator', LoadingIndicatorUsage],
      ['Boxel::Modal', ModalUsage],
      ['Boxel::Message', MessageUsage],
      ['Boxel::Menu', MenuUsage],
      ['Boxel::Dropdown', DropdownUsage],
      ['Boxel::Tooltip', TooltipUsage],
      ['Boxel::ResizablePanel', ResizablePanelGroupUsage],
      ['Boxel::RadioInput', RadioInput],
    ].map(([name, c]) => {
      return {
        title: name,
        component: c,
      };
    });
  }
}
