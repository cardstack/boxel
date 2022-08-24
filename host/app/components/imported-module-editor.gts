import Component from '@glimmer/component';
import ImportModule from './import-module';
import CardEditor from './card-editor';
import type { NewCardArgs, ExistingCardArgs } from './card-editor';

interface Signature {
  Args: {
    moduleURL: string;
    cardArgs: NewCardArgs | ExistingCardArgs;
    onSave?: (url: string) => void;
    onCancel?: () => void;
  }
}

export default class ImportedModuleEditor extends Component<Signature> {
  <template>
    <ImportModule @url={{@moduleURL}}>
      <:ready as |module|>
        <CardEditor
          @card={{@cardArgs}}
          @module={{module}}
          @onSave={{@onSave}}
          @onCancel={{@onCancel}}
        />
      </:ready>
      <:error as |error|>
        <h2>Encountered {{error.type}} error</h2>
        <pre>{{error.message}}</pre>
      </:error>
    </ImportModule>
  </template>
}
