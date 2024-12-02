import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { type TCountryCode, countries, getEmojiFlag } from 'countries-list';
import {
  type CountryCallingCode,
  type CountryCode,
  getCountries,
  getCountryCallingCode,
  getExampleNumber,
  isValidPhoneNumber,
} from 'libphonenumber-js';
// @ts-expect-error import not found
import examples from 'libphonenumber-js/mobile/examples';
import { debounce } from 'lodash';

import { type InputValidationState } from '../input/index.gts';
import BoxelInputGroup from '../input-group/index.gts';

interface Signature {
  Args: {
    onInput: (value: string) => void;
    value: string;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLElement;
}

interface CountryInfo {
  callingCode?: CountryCallingCode;
  code: CountryCode;
  example?: {
    callingCode: CountryCallingCode;
    nationalNumber: string;
  };
  flag?: string;
  name?: string;
}

const getCountryInfo = (countryCode: CountryCode): CountryInfo | undefined => {
  let example = getExampleNumber(countryCode, examples);
  let callingCode = getCountryCallingCode(countryCode);
  let c = countries[countryCode as TCountryCode];
  if (c === undefined) {
    return undefined;
  }
  return {
    code: countryCode,
    callingCode,
    name: c ? c.name : undefined,
    flag: getEmojiFlag(countryCode as TCountryCode),
    example: example
      ? {
          callingCode,
          nationalNumber: example.format('NATIONAL'),
        }
      : undefined,
  };
};

export default class PhoneInput extends Component<Signature> {
  @tracked items: Array<CountryInfo> = [];
  @tracked selectedItem: CountryInfo = getCountryInfo('US')!;
  @tracked validationState: InputValidationState = 'initial';
  @tracked input: string = this.args.value ?? '';

  @action onSelectItem(item: CountryInfo): void {
    this.selectedItem = item;
    if (this.input.length > 0) {
      this.validationState = isValidPhoneNumber(
        this.input,
        this.selectedItem.code,
      )
        ? 'valid'
        : 'invalid';
    }
  }

  constructor(owner: unknown, args: any) {
    super(owner, args);
    this.items = getCountries()
      .map((code) => {
        return getCountryInfo(code);
      })
      .filter((c) => c !== undefined) as CountryInfo[];
  }

  get placeholder(): string | undefined {
    if (this.selectedItem) {
      return this.selectedItem.example?.nationalNumber;
    }
    return undefined;
  }

  get phoneNumber(): string {
    return `+${this.selectedItem.callingCode} `;
  }

  @action onInput(v: string): void {
    this.debouncedInput(v);
  }

  private debouncedInput = debounce((input: string) => {
    this.validationState = isValidPhoneNumber(input, this.selectedItem.code)
      ? 'valid'
      : 'invalid';
    this.input = input;
    //save when the state is valid
    if (this.validationState === 'valid') {
      this.args.onInput(this.input);
    }
  }, 300);

  <template>
    <BoxelInputGroup
      @placeholder={{this.placeholder}}
      @state={{this.validationState}}
      @onInput={{this.onInput}}
      @value={{this.input}}
    >
      <:before as |Accessories|>
        <Accessories.Select
          @placeholder={{this.placeholder}}
          @selected={{this.selectedItem}}
          @onChange={{this.onSelectItem}}
          @options={{this.items}}
          @selectedItemComponent={{PhoneSelectedItem}}
          @searchEnabled={{true}}
          @searchField='name'
          @matchTriggerWidth={{false}}
          aria-label='Select an country calling code'
          as |item|
        >
          <div>{{item.flag}} {{item.name}} +{{item.callingCode}}</div>
        </Accessories.Select>
      </:before>
    </BoxelInputGroup>
  </template>
}

export interface SelectedItemSignature {
  Args: {
    option: any;
  };
  Element: HTMLElement;
}

const PhoneSelectedItem: TemplateOnlyComponent<SelectedItemSignature> = [
  <template><div>{{@option.flag}} +{{@option.callingCode}}</div></template>;
