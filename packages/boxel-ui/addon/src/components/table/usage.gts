import { cssVar } from '@cardstack/boxel-ui/helpers';
import { fn } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import {
  type CSSVariableInfo,
  cssVariable,
} from 'ember-freestyle/decorators/css-variable';

import Table from './index.gts';

export default class TableUsage extends Component {
  @tracked columns = [
    { header: 'Name', key: 'name' },
    { header: 'Age', key: 'age' },
    { header: 'Email', key: 'email' },
  ];

  @tracked rows = [
    { name: 'John Doe', age: 30, email: 'john@example.com' },
    { name: 'Jane Smith', age: 25, email: 'jane@example.com' },
    { name: 'Bob Johnson', age: 35, email: 'bob@example.com' },
  ];

  @cssVariable({ cssClassName: 'table-freestyle-container' })
  declare boxelTableBorderColor: CSSVariableInfo;
  @cssVariable({ cssClassName: 'table-freestyle-container' })
  declare boxelTableTdBg: CSSVariableInfo;
  @cssVariable({ cssClassName: 'table-freestyle-container' })
  declare boxelTableTdFontColor: CSSVariableInfo;
  @cssVariable({ cssClassName: 'table-freestyle-container' })
  declare boxelTableTdFontWeight: CSSVariableInfo;
  @cssVariable({ cssClassName: 'table-freestyle-container' })
  declare boxelTableTdPadding: CSSVariableInfo;
  @cssVariable({ cssClassName: 'table-freestyle-container' })
  declare boxelTableThBg: CSSVariableInfo;
  @cssVariable({ cssClassName: 'table-freestyle-container' })
  declare boxelTableThFontColor: CSSVariableInfo;
  @cssVariable({ cssClassName: 'table-freestyle-container' })
  declare boxelTableThFontWeight: CSSVariableInfo;
  @cssVariable({ cssClassName: 'table-freestyle-container' })
  declare boxelTableThPadding: CSSVariableInfo;

  <template>
    <FreestyleUsage @name='Table'>
      <:example>

        <div
          class='table-freestyle-container'
          style={{cssVar
            boxel-table-border-color=this.boxelTableBorderColor.value
            boxel-table-td-bg=this.boxelTableTdBg.value
            boxel-table-td-font-color=this.boxelTableTdFontColor.value
            boxel-table-td-font-weight=this.boxelTableTdFontWeight.value
            boxel-table-td-padding=this.boxelTableTdPadding.value
            boxel-table-th-bg=this.boxelTableThBg.value
            boxel-table-th-font-color=this.boxelTableThFontColor.value
            boxel-table-th-font-weight=this.boxelTableThFontWeight.value
            boxel-table-th-padding=this.boxelTableThPadding.value
          }}
        >
          <Table @columns={{this.columns}} @rows={{this.rows}} />
        </div>
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='columns'
          @description='Column definitions for the table'
          @value={{this.columns}}
          @onInput={{fn (mut this.columns)}}
        />
        <Args.Object
          @name='rows'
          @description='Data rows for the table'
          @value={{this.rows}}
          @onInput={{fn (mut this.rows)}}
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='boxel-table-border-color'
          @type='color'
          @description='Table border color'
          @defaultValue={{this.boxelTableBorderColor.defaults}}
          @value={{this.boxelTableBorderColor.value}}
          @onInput={{this.boxelTableBorderColor.update}}
        />
        <Css.Basic
          @name='boxel-table-td-bg'
          @type='color'
          @description='Table cell background color'
          @defaultValue={{this.boxelTableTdBg.defaults}}
          @value={{this.boxelTableTdBg.value}}
          @onInput={{this.boxelTableTdBg.update}}
        />
        <Css.Basic
          @name='boxel-table-td-font-color'
          @type='color'
          @description='Table cell font color'
          @defaultValue={{this.boxelTableTdFontColor.defaults}}
          @value={{this.boxelTableTdFontColor.value}}
          @onInput={{this.boxelTableTdFontColor.update}}
        />
        <Css.Basic
          @name='boxel-table-td-font-weight'
          @type='font-weight'
          @description='Table cell font weight'
          @defaultValue={{this.boxelTableTdFontWeight.defaults}}
          @value={{this.boxelTableTdFontWeight.value}}
          @onInput={{this.boxelTableTdFontWeight.update}}
        />
        <Css.Basic
          @name='boxel-table-td-padding'
          @type='size'
          @description='Table cell padding'
          @defaultValue={{this.boxelTableTdPadding.defaults}}
          @value={{this.boxelTableTdPadding.value}}
          @onInput={{this.boxelTableTdPadding.update}}
        />
        <Css.Basic
          @name='boxel-table-th-bg'
          @type='color'
          @description='Table header background color'
          @defaultValue={{this.boxelTableThBg.defaults}}
          @value={{this.boxelTableThBg.value}}
          @onInput={{this.boxelTableThBg.update}}
        />
        <Css.Basic
          @name='boxel-table-th-font-color'
          @type='color'
          @description='Table header font color'
          @defaultValue={{this.boxelTableThFontColor.defaults}}
          @value={{this.boxelTableThFontColor.value}}
          @onInput={{this.boxelTableThFontColor.update}}
        />
        <Css.Basic
          @name='boxel-table-th-font-weight'
          @type='font-weight'
          @description='Table header font weight'
          @defaultValue={{this.boxelTableThFontWeight.defaults}}
          @value={{this.boxelTableThFontWeight.value}}
          @onInput={{this.boxelTableThFontWeight.update}}
        />
        <Css.Basic
          @name='boxel-table-th-padding'
          @type='size'
          @description='Table header padding'
          @defaultValue={{this.boxelTableThPadding.defaults}}
          @value={{this.boxelTableThPadding.value}}
          @onInput={{this.boxelTableThPadding.update}}
        />
      </:cssVars>
    </FreestyleUsage>
  </template>
}
