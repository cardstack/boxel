import Component from '@glimmer/component';
import { importResource } from '../resources/import';
import { service } from '@ember/service';
import LoaderService from '../services/loader-service';

export interface Signature { 
  Args: { url: string  };
  Blocks: { 
    ready: [Record<string, any>];
    error: [{ type: string; message: string; }];
  } 
}

export default class ImportModule extends Component<Signature> {
  @service declare loaderService: LoaderService;
  imported = importResource(
    this,
    () => this.args.url,
    () => this.loaderService.loader
  );

  <template>
    {{#if this.imported.module}}
      {{yield this.imported.module to="ready"}}
    {{/if}}
    {{#if this.imported.error}}
      {{yield this.imported.error to="error"}}
    {{/if}}
  </template>
}