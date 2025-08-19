import FreestyleController from 'ember-freestyle/controllers/freestyle';
import { ALL_USAGE_COMPONENTS } from '@cardstack/boxel-ui/usage';
import THEMES from '../themes/index.ts';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { BoxelSelect, FieldContainer } from '@cardstack/boxel-ui/components';
import {
  extractCssVariables,
  styleConversions,
} from '@cardstack/boxel-ui/helpers';

function getThemeStyles(cssString: string) {
  if (!extractCssVariables) {
    return;
  }
  return styleConversions + extractCssVariables(cssString);
}

interface Theme {
  name: string;
  styles?: string;
}

export default class IndexController extends FreestyleController {
  boxelSelect = BoxelSelect;
  fieldContainer = FieldContainer;
  themes: Theme[] = [
    { name: '<None Selected>' },
    ...Object.entries(THEMES).map(([name, vars]) => ({
      name,
      styles: getThemeStyles(vars),
    })),
  ];
  usageComponents = ALL_USAGE_COMPONENTS.map(([name, c]) => {
    return {
      title: name,
      component: c,
    };
  });

  @tracked currentTheme?: Theme;

  @action selectTheme(theme: Theme) {
    this.currentTheme = theme?.styles ? theme : undefined;
  }
}
