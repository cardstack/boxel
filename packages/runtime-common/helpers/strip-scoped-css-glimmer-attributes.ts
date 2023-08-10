export default function stripScopedCSSGlimmerAttributes(compiledTemplateString: string) {
  let attributeArray = `\\[(14|24),\\\\"data\\-scopedcss\\-[0-9a-f]{10}\\\\",\\\\"\\\\"\\]`;
  let double = new RegExp(`\\[${attributeArray}\\]`, 'g');
  let single = new RegExp(`${attributeArray},`, 'g');

  return compiledTemplateString.replace(double, 'null').replace(single, '');
}
