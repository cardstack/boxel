import { action } from '@ember/object';
import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import {
  getCountryCodeForRegionCode,
  getExample,
  getSupportedRegionCodes,
  parsePhoneNumber,
} from 'awesome-phonenumber';
import { type TCountryCode, countries, getEmojiFlag } from 'countries-list';
import { debounce } from 'lodash';

import { type InputValidationState } from '../input/index.gts';
import BoxelInputGroup from '../input-group/index.gts';

interface Signature {
  Args: {
    countryCode: string;
    onCountryCodeChange: (code: string) => void;
    onInput: (value: string) => void;
    value: string;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLElement;
}

interface CountryInfo {
  callingCode?: string;
  code: string;
  example?: {
    callingCode: string;
    nationalNumber: string;
  };
  flag?: string;
  name?: string;
}

const getCountryInfo = (countryCode: string): CountryInfo | undefined => {
  let example = getExample(countryCode);
  let callingCode = getCountryCodeForRegionCode(countryCode);

  let c = countries[countryCode as TCountryCode];
  if (c === undefined) {
    //here some country code may not be found due to the discrepancy between countries-list and libphonenumber-js library
    //Only scenario where this is true is the usage of "AC"
    //Most countries consider "AC" Ascension Island as part of "SH" Saint Helena
    return;
  }
  return {
    code: countryCode,
    callingCode: callingCode.toString(),
    name: c ? c.name : undefined,
    flag: getEmojiFlag(countryCode as TCountryCode),
    example: example
      ? {
          callingCode: callingCode.toString(),
          nationalNumber: example.number?.international ?? '',
        }
      : undefined,
  };
};

class PhoneInput extends Component<Signature> {
  @tracked items: Array<CountryInfo> = [];
  @tracked selectedItem: CountryInfo = getCountryInfo('US')!;
  @tracked validationState: InputValidationState = 'initial';
  @tracked input: string = this.args.value ?? '';

  @action onSelectItem(item: CountryInfo): void {
    this.selectedItem = item;
    if (this.args.onCountryCodeChange) {
      this.args.onCountryCodeChange(item.callingCode ?? '');
    }
    if (this.input.length > 0) {
      const parsedPhoneNumber = parsePhoneNumber(this.input, {
        regionCode: this.selectedItem.code,
      });
      this.validationState = parsedPhoneNumber.valid ? 'valid' : 'invalid';
    }
  }

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    this.items = getSupportedRegionCodes()
      .map((code) => {
        return getCountryInfo(code);
      })
      .filter((c) => c !== undefined) as CountryInfo[];

    if (this.args.countryCode) {
      this.selectedItem = this.items.find(
        (item) => item.callingCode === this.args.countryCode,
      )!;
    }
  }

  get placeholder(): string | undefined {
    if (this.selectedItem) {
      return this.selectedItem.example?.nationalNumber;
    }
    return undefined;
  }

  @action onInput(v: string): void {
    this.debouncedInput(v);
  }

  private debouncedInput = debounce((input: string) => {
    this.input = input;

    if (input === '') {
      this.validationState = 'initial';
      return;
    }

    const parsedPhoneNumber = parsePhoneNumber(input, {
      regionCode: this.selectedItem.code,
    });
    this.validationState = parsedPhoneNumber.valid ? 'valid' : 'invalid';
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
  Element: HTMLDivElement;
}

// eslint-disable-next-line ember/no-empty-glimmer-component-classes
class PhoneSelectedItem extends Component<SelectedItemSignature> {
  <template>
    <div>
      {{@option.flag}}
      +{{@option.callingCode}}
    </div>
  </template>
}

export default PhoneInput;
