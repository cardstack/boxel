import FreestyleController from 'ember-freestyle/controllers/freestyle';
import AccordionUsage from '@cardstack/boxel-ui/components/accordion/usage';
import AddButtonUsage from '@cardstack/boxel-ui/components/add-button/usage';
import CardContainerUsage from '@cardstack/boxel-ui/components/card-container/usage';
import DropdownButtonUsage from '@cardstack/boxel-ui/components/dropdown-button/usage';
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
<<<<<<< HEAD
import RadioInput from '@cardstack/boxel-ui/components/radio-input/usage';
=======
>>>>>>> 931f10c3 (Convert icon usage to components and drop svg-jar)

export default class IndexController extends FreestyleController {
  constructor() {
    super(...arguments);
    this.usageComponents = [
      ['Boxel::Accordion', AccordionUsage],
      ['Boxel::AddButton', AddButtonUsage],
      ['Boxel::Button', ButtonUsage],
      ['Boxel::CardContainer', CardContainerUsage],
      ['Boxel::Dropdown', DropdownUsage],
      ['Boxel::DropdownButton', DropdownButtonUsage],
      ['Boxel::FieldContainer', FieldContainerUsage],
      ['Boxel::GridContainer', GridContainerUsage],
      ['Boxel::Header', HeaderUsage],
      ['Boxel::IconButton', IconButtonUsage],
      ['Boxel::Input::SearchInput', SearchInputUsage],
      ['Boxel::Input::ValidationState', InputValidationStateUsage],
      ['Boxel::Input', InputUsage],
      ['Boxel::LoadingIndicator', LoadingIndicatorUsage],
      ['Boxel::Message', MessageUsage],
      ['Boxel::Menu', MenuUsage],
      ['Boxel::Modal', ModalUsage],
      ['Boxel::Tooltip', TooltipUsage],
      ['Boxel::ResizablePanel', ResizablePanelGroupUsage],
<<<<<<< HEAD
      ['Boxel::RadioInput', RadioInput],
=======
>>>>>>> 931f10c3 (Convert icon usage to components and drop svg-jar)
    ].map(([name, c]) => {
      return {
        title: name,
        component: c,
      };
    });
  }
}
