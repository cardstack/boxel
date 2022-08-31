import Component from '@glimmer/component';
import type { NewCardArgs, ExistingCardArgs } from '@cardstack/runtime-common';
import type { Format } from "https://cardstack.com/base/card-api";
import ImportModule from './import-module';
import Preview from './preview';

interface Signature {
  Args: {
    moduleURL: string;
    cardArgs: NewCardArgs | ExistingCardArgs;
    onSave?: (url: string) => void;
    onCancel?: () => void;
    formats?: Format[];
  }
}

export default class CardEditor extends Component<Signature> {
  <template>
    <ImportModule @url={{@moduleURL}}>
      <:ready as |module|>
        <Preview
          @card={{@cardArgs}}
          @module={{module}}
          @onSave={{@onSave}}
          @onCancel={{@onCancel}}
          @formats={{@formats}}
        />
      </:ready>
      <:error as |error|>
        <h2>Encountered {{error.type}} error</h2>
        <pre>{{error.message}}</pre>
      </:error>
    </ImportModule>
  </template>
}
