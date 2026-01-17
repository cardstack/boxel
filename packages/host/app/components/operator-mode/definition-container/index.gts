import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { BaseDefinitionContainer, Active } from './base';

import { Clickable } from './clickable';

import type { BaseArgs, ActiveArgs } from './base';
import type { ClickableArgs } from './clickable';

interface FileArgs
  extends Omit<BaseArgs, 'title' | 'name' | 'isActive'>, ActiveArgs {}

interface FileSignature {
  Element: HTMLElement;
  Args: FileArgs;
}

const FileDefinitionContainer: TemplateOnlyComponent<FileSignature> = <template>
  <BaseDefinitionContainer
    @title='File'
    @name={{undefined}}
    @fileExtension={{@fileExtension}}
    @isActive={{true}}
    @fileURL={{@fileURL}}
    data-test-file-definition
  />
  <Active @actions={{@actions}} @infoText={{@infoText}} />
</template>;

interface ModuleArgs extends BaseArgs, ActiveArgs {}

interface ModSig {
  Element: HTMLElement;
  Args: ModuleArgs;
}

const ModuleDefinitionContainer: TemplateOnlyComponent<ModSig> = <template>
  <BaseDefinitionContainer
    @title={{@title}}
    @name={{@name}}
    @fileExtension={{@fileExtension}}
    @isActive={{@isActive}}
    @fileURL={{@fileURL}}
    data-test-card-module-definition
  />
  {{#if @isActive}}
    <Active @actions={{@actions}} @infoText={{@infoText}} />
  {{/if}}
</template>;

interface InstanceArgs
  extends Omit<BaseArgs, 'title' | 'isActive'>, ActiveArgs {}

interface InstSig {
  Element: HTMLElement;
  Args: InstanceArgs;
}

const InstanceDefinitionContainer: TemplateOnlyComponent<InstSig> = <template>
  <BaseDefinitionContainer
    @title='Card Instance'
    @fileExtension={{@fileExtension}}
    @name={{@name}}
    @isActive={{true}}
    @fileURL={{@fileURL}}
    data-test-card-instance-definition
  />
  <Active @actions={{@actions}} @infoText={{@infoText}} />
</template>;

interface ClickableModuleArgs
  extends Omit<BaseArgs, 'infoText' | 'isActive'>, ClickableArgs {}

interface ClickableModuleSignature {
  Element: HTMLElement;
  Args: ClickableModuleArgs;
}

const ClickableModuleDefinitionContainer: TemplateOnlyComponent<ClickableModuleSignature> =
  <template>
    <Clickable
      @goToDefinition={{@goToDefinition}}
      @codeRef={{@codeRef}}
      @localName={{@localName}}
      data-test-clickable-definition-container
    >
      <BaseDefinitionContainer
        @title={{@title}}
        @name={{@name}}
        @fileExtension={{@fileExtension}}
        @isActive={{false}}
        @fileURL={{@fileURL}}
        data-test-card-module-definition
      />
    </Clickable>
  </template>;

export {
  FileDefinitionContainer,
  ModuleDefinitionContainer,
  InstanceDefinitionContainer,
  ClickableModuleDefinitionContainer,
};

export { Divider } from './divider';
export { BaseContainer } from './base';
