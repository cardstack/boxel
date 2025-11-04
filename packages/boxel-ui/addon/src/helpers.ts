import { copyCardURLToClipboard } from './helpers/clipboard.ts';
import cn from './helpers/cn.ts';
import compact from './helpers/compact.ts';
import { getContrastColor } from './helpers/contrast-color.ts';
import cssVar from './helpers/css-var.ts';
import currencyFormat from './helpers/currency-format.ts';
import { dayjsFormat } from './helpers/dayjs-format.ts';
import element from './helpers/element.ts';
import {
  extractCssVariables,
  parseCssGroups,
} from './helpers/extract-css-variables.ts';
import formatAge from './helpers/format-age.ts';
import formatCountdown from './helpers/format-countdown.ts';
import formatCurrency from './helpers/format-currency.ts';
import formatDateTime from './helpers/format-date-time.ts';
import formatDuration from './helpers/format-duration.ts';
import formatFileSize from './helpers/format-file-size.ts';
import formatList from './helpers/format-list.ts';
import formatNames from './helpers/format-names.ts';
import formatNumber from './helpers/format-number.ts';
import formatOrdinal from './helpers/format-ordinal.ts';
import formatPeriod from './helpers/format-period.ts';
import formatRelativeTime from './helpers/format-relative-time.ts';
import { generateCssVariables } from './helpers/generate-css-variables.ts';
import { add, divide, multiply, subtract } from './helpers/math-helpers.ts';
import menuDivider, { MenuDivider } from './helpers/menu-divider.ts';
import menuItem, {
  type MenuItemOptions,
  MenuItem,
  menuItemFunc,
  toMenuItems,
} from './helpers/menu-item.ts';
import optional from './helpers/optional.ts';
import pick from './helpers/pick.ts';
import { sanitizeHtml, sanitizeHtmlSafe } from './helpers/sanitize-html.ts';
import { substring } from './helpers/string.ts';
import {
  type CssGroupInput,
  type CssGroups,
  type CssRuleMap,
  type CssVariableEntry,
  buildCssGroups,
  entriesToCssRuleMap,
  normalizeCssRuleMap,
} from './helpers/theme-css.ts';
import {
  and,
  bool,
  eq,
  gt,
  gte,
  lt,
  lte,
  not,
  or,
} from './helpers/truth-helpers.ts';
import type { EmailFormatValidationError } from './helpers/validate-email-format.ts';
import type { NormalizePhoneFormatResult } from './helpers/validate-phone-format.ts';

export {
  add,
  and,
  bool,
  buildCssGroups,
  cn,
  compact,
  copyCardURLToClipboard,
  cssVar,
  currencyFormat,
  dayjsFormat,
  divide,
  element,
  entriesToCssRuleMap,
  eq,
  extractCssVariables,
  formatAge,
  formatCountdown,
  formatCurrency,
  formatDateTime,
  formatDuration,
  formatFileSize,
  formatList,
  formatNames,
  formatNumber,
  formatOrdinal,
  formatPeriod,
  formatRelativeTime,
  generateCssVariables,
  getContrastColor,
  gt,
  gte,
  lt,
  lte,
  MenuDivider,
  menuDivider,
  MenuItem,
  menuItem,
  menuItemFunc,
  multiply,
  normalizeCssRuleMap,
  not,
  optional,
  or,
  parseCssGroups,
  pick,
  sanitizeHtml,
  sanitizeHtmlSafe,
  substring,
  subtract,
  toMenuItems,
};

export type {
  CssGroupInput,
  CssGroups,
  CssRuleMap,
  CssVariableEntry,
  EmailFormatValidationError,
  MenuItemOptions,
  NormalizePhoneFormatResult,
};
