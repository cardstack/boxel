import FreestyleController from 'ember-freestyle/controllers/freestyle';
import { ALL_USAGE_COMPONENTS } from '@cardstack/boxel-ui/usage';
import {
  extractCssVariables,
  styleConversions,
} from '../utils/extract-css-variables.ts';
import THEMES from '../themes/index.ts';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { fn, get } from '@ember/helper';
import { BoxelSelect, FieldContainer } from '@cardstack/boxel-ui/components';

function getThemeStyles(cssString) {
  if (!extractCssVariables) {
    return;
  }
  return styleConversions + extractCssVariables(cssString);
}

export default class IndexController extends FreestyleController {
  constructor() {
    super(...arguments);
    this.usageComponents = ALL_USAGE_COMPONENTS.map(([name, c]) => {
      return {
        title: name,
        component: c,
      };
    });
    this.themes = [
      { name: '<None Selected>' },
      ...Object.entries(THEMES).map(([name, vars]) => ({
        name,
        styles: getThemeStyles(vars),
      })),
    ];

    this.boxelSelect = BoxelSelect;
    this.fieldContainer = FieldContainer;
  }

  @tracked currentTheme;

  @action selectTheme(theme) {
    this.currentTheme = theme?.styles ? theme : undefined;
  }
}
