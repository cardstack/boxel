/**
 * The CSS properties whose numeric values are NOT lengths.
 *
 * React's `style` prop appends `px` to a number unless the property is one of
 * these; `style={{ gridColumn: 2 }}` therefore writes `2`, not `2px`. Motion's
 * own values go through the engine, but the plain part of a motion element's
 * `style` has to reproduce React's rule exactly, or a number lands as an
 * invalid length and the browser drops the declaration silently.
 *
 * Kept verbatim from React DOM's `isUnitlessNumber`, prefixes included.
 */
const UNITLESS = new Set([
  'animationIterationCount',
  'aspectRatio',
  'borderImageOutset',
  'borderImageSlice',
  'borderImageWidth',
  'boxFlex',
  'boxFlexGroup',
  'boxOrdinalGroup',
  'columnCount',
  'columns',
  'fillOpacity',
  'flex',
  'flexGrow',
  'flexNegative',
  'flexOrder',
  'flexPositive',
  'flexShrink',
  'floodOpacity',
  'fontWeight',
  'gridArea',
  'gridColumn',
  'gridColumnEnd',
  'gridColumnSpan',
  'gridColumnStart',
  'gridRow',
  'gridRowEnd',
  'gridRowSpan',
  'gridRowStart',
  'lineClamp',
  'lineHeight',
  'opacity',
  'order',
  'orphans',
  'scale',
  'stopOpacity',
  'strokeDasharray',
  'strokeDashoffset',
  'strokeMiterlimit',
  'strokeOpacity',
  'strokeWidth',
  'tabSize',
  'widows',
  'zIndex',
  'zoom',
  // vendor-prefixed spellings React also treats as unitless
  'MozAnimationIterationCount',
  'MozBoxFlex',
  'MozBoxFlexGroup',
  'MozLineClamp',
  'msAnimationIterationCount',
  'msFlex',
  'msFlexGrow',
  'msFlexNegative',
  'msFlexOrder',
  'msFlexPositive',
  'msFlexShrink',
  'msGridColumn',
  'msGridColumnSpan',
  'msGridRow',
  'msGridRowSpan',
  'msZoom',
  'WebkitAnimationIterationCount',
  'WebkitBoxFlex',
  'WebkitBoxFlexGroup',
  'WebkitBoxOrdinalGroup',
  'WebkitColumnCount',
  'WebkitColumns',
  'WebkitFlex',
  'WebkitFlexGrow',
  'WebkitFlexPositive',
  'WebkitFlexShrink',
  'WebkitLineClamp',
]);

/** a number written into `style`, the way React would write it */
export const styleValue = (key: string, value: number | string): string =>
  typeof value === 'number' && value !== 0 && !UNITLESS.has(key)
    ? `${value}px`
    : String(value);
