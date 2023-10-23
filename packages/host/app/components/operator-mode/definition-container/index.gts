import Component from '@glimmer/component';

import { BaseDefinitionContainer, BaseArgs, Active, ActiveArgs } from './base';
import { Clickable, ClickableArgs } from './clickable';

interface FileArgs
  extends Omit<BaseArgs, 'title' | 'name' | 'isActive'>,
    ActiveArgs {}

interface FileSignature {
  Element: HTMLElement;
  Args: FileArgs;
}

export class FileDefinitionContainer extends Component<FileSignature> {
  <template>
    <BaseDefinitionContainer
      @title='File'
      @name={{undefined}}
      @fileExtension={{@fileExtension}}
      @isActive={{true}}
      @fileURL={{@fileURL}}
      data-test-file-definition
    >
      <:activeContent>
        <Active @actions={{@actions}} @infoText={{@infoText}} />
      </:activeContent>
    </BaseDefinitionContainer>
  </template>
}
interface ModuleArgs extends BaseArgs, ActiveArgs {}

interface ModuleSignature {
  Element: HTMLElement;
  Args: ModuleArgs;
}

export class ModuleDefinitionContainer extends Component<ModuleSignature> {
  <template>
    <BaseDefinitionContainer
      @title={{@title}}
      @name={{@name}}
      @fileExtension={{@fileExtension}}
      @isActive={{@isActive}}
      @fileURL={{@fileURL}}
      data-test-card-module-definition
    >
      <:activeContent>
        <Active @actions={{@actions}} @infoText={{@infoText}} />
      </:activeContent>
    </BaseDefinitionContainer>
  </template>
}

interface InstanceArgs
  extends Omit<BaseArgs, 'title' | 'isActive'>,
    ActiveArgs {}

interface InstanceSignature {
  Element: HTMLElement;
  Args: InstanceArgs;
}

export class InstanceDefinitionContainer extends Component<InstanceSignature> {
  <template>
    <BaseDefinitionContainer
      @title='Card Instance'
      @fileExtension={{@fileExtension}}
      @name={{@name}}
      @isActive={{true}}
      @fileURL={{@fileURL}}
      data-test-card-instance-definition
    >
      <:activeContent>
        <Active @actions={{@actions}} @infoText={{@infoText}} />
      </:activeContent>
    </BaseDefinitionContainer>
  </template>
}

interface ClickableModuleArgs
  extends Omit<BaseArgs, 'infoText' | 'isActive'>,
    ClickableArgs {}

interface ClickableModuleSignature {
  Element: HTMLElement;
  Args: ClickableModuleArgs;
}

export class ClickableModuleDefinitionContainer extends Component<ClickableModuleSignature> {
  <template>
    <Clickable
      @onSelectDefinition={{@onSelectDefinition}}
      @url={{@url}}
      data-test-definition-container
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
  </template>
}
