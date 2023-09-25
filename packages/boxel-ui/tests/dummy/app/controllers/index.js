import FreestyleController from 'ember-freestyle/controllers/freestyle';
import AccordionUsage from '@cardstack/boxel-ui/components/accordion/usage';
import AddButtonUsage from '@cardstack/boxel-ui/components/add-button/usage';
import ButtonUsage from '@cardstack/boxel-ui/components/button/usage';
import ButtonTabGroupUsage from '@cardstack/boxel-ui/components/button-tab-group/usage';
import CardContainerUsage from '@cardstack/boxel-ui/components/card-container/usage';
import DropdownUsage from '@cardstack/boxel-ui/components/dropdown/usage';
import FieldContainerUsage from '@cardstack/boxel-ui/components/field-container/usage';
import GridContainerUsage from '@cardstack/boxel-ui/components/grid-container/usage';
import HeaderUsage from '@cardstack/boxel-ui/components/header/usage';
import IconButtonUsage from '@cardstack/boxel-ui/components/icon-button/usage';
import InputUsage from '@cardstack/boxel-ui/components/input/usage';
import InputValidationStateUsage from '@cardstack/boxel-ui/components/input/validation-state/usage';
import LoadingIndicatorUsage from '@cardstack/boxel-ui/components/loading-indicator/usage';
import MenuUsage from '@cardstack/boxel-ui/components/menu/usage';
import MessageUsage from '@cardstack/boxel-ui/components/message/usage';
import ModalUsage from '@cardstack/boxel-ui/components/modal/usage';
import ResizablePanelGroupUsage from '@cardstack/boxel-ui/components/resizable-panel-group/usage';
import SearchInputUsage from '@cardstack/boxel-ui/components/input/search-input/usage';
import TooltipUsage from '@cardstack/boxel-ui/components/tooltip/usage';

export default class IndexController extends FreestyleController {
  constructor() {
    super(...arguments);
    this.usageComponents = [
      ['Boxel::Accordion', AccordionUsage],
      ['Boxel::AddButton', AddButtonUsage],
      ['Boxel::Button', ButtonUsage],
      ['Boxel::ButtonTabGroup', ButtonTabGroupUsage],
      ['Boxel::CardContainer', CardContainerUsage],
      ['Boxel::Dropdown', DropdownUsage],
      ['Boxel::FieldContainer', FieldContainerUsage],
      ['Boxel::GridContainer', GridContainerUsage],
      ['Boxel::Header', HeaderUsage],
      ['Boxel::IconButton', IconButtonUsage],
      ['Boxel::Input::SearchInput', SearchInputUsage],
      ['Boxel::Input::ValidationState', InputValidationStateUsage],
      ['Boxel::Input', InputUsage],
      ['Boxel::LoadingIndicator', LoadingIndicatorUsage],
      ['Boxel::Menu', MenuUsage],
      ['Boxel::Message', MessageUsage],
      ['Boxel::Modal', ModalUsage],
      ['Boxel::ResizablePanel', ResizablePanelGroupUsage],
      ['Boxel::Tooltip', TooltipUsage],
    ].map(([name, c]) => {
      return {
        title: name,
        component: c,
      };
    });
  }
}
