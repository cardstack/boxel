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
      @realmInfo={{@realmInfo}}
      @realmIconURL={{@realmIconURL}}
      @isActive={{true}}
      data-test-file-definition
    >
      <:activeContent>
        <Active @actions={{@actions}} @infoText={{@infoText}} />
      </:activeContent>
    </BaseDefinitionContainer>
  </template>
}
interface ModuleArgs extends Omit<BaseArgs, 'title'>, ActiveArgs {}

interface ModuleSignature {
  Element: HTMLElement;
  Args: ModuleArgs;
}

export class ModuleDefinitionContainer extends Component<ModuleSignature> {
  <template>
    <BaseDefinitionContainer
      @title='Card Definition'
      @name={{@name}}
      @fileExtension={{@fileExtension}}
      @realmInfo={{@realmInfo}}
      @realmIconURL={{@realmIconURL}}
      @isActive={{@isActive}}
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
      @realmInfo={{@realmInfo}}
      @realmIconURL={{@realmIconURL}}
      @isActive={{true}}
      data-test-card-instance-definition
    >
      <:activeContent>
        <Active @actions={{@actions}} @infoText={{@infoText}} />
      </:activeContent>
    </BaseDefinitionContainer>
  </template>
}

interface ClickableModuleArgs
  extends Omit<BaseArgs, 'title' | 'infoText' | 'isActive'>,
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
        @title='Card Definition'
        @name={{@name}}
        @fileExtension={{@fileExtension}}
        @realmInfo={{@realmInfo}}
        @realmIconURL={{@realmIconURL}}
        @isActive={{false}}
        data-test-card-module-definition
      />
    </Clickable>
  </template>
}
