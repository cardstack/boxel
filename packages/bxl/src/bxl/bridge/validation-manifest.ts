export interface ValidationFunctionDefinition {
  readonly name: string;
  readonly arities: readonly number[];
  readonly volatile?: boolean;
}

export const VALIDATION_FUNCTION_DEFINITIONS = [
  { name: 'contains', arities: [2, 3] },
  { name: 'equals', arities: [2] },
  { name: 'isAbaRouting', arities: [1] },
  { name: 'isAfter', arities: [1, 2], volatile: true },
  { name: 'isAlpha', arities: [1, 2, 3] },
  { name: 'isAlphanumeric', arities: [1, 2, 3] },
  { name: 'isAscii', arities: [1] },
  { name: 'isBase32', arities: [1, 2] },
  { name: 'isBase58', arities: [1] },
  { name: 'isBase64', arities: [1, 2] },
  { name: 'isBefore', arities: [1, 2], volatile: true },
  { name: 'isBIC', arities: [1] },
  { name: 'isBoolean', arities: [1, 2] },
  { name: 'isBtcAddress', arities: [1] },
  { name: 'isByteLength', arities: [1, 2] },
  { name: 'isCreditCard', arities: [1, 2] },
  { name: 'isCurrency', arities: [1, 2] },
  { name: 'isDataURI', arities: [1] },
  { name: 'isDate', arities: [1, 2] },
  { name: 'isDecimal', arities: [1, 2] },
  { name: 'isDivisibleBy', arities: [2] },
  { name: 'isEAN', arities: [1] },
  { name: 'isEmail', arities: [1, 2] },
  { name: 'isEmpty', arities: [1, 2] },
  { name: 'isEthereumAddress', arities: [1] },
  { name: 'isFloat', arities: [1, 2] },
  { name: 'isFQDN', arities: [1, 2] },
  { name: 'isFreightContainerID', arities: [1] },
  { name: 'isFullWidth', arities: [1] },
  { name: 'isHalfWidth', arities: [1] },
  { name: 'isHash', arities: [2] },
  { name: 'isHexadecimal', arities: [1] },
  { name: 'isHexColor', arities: [1, 2] },
  { name: 'isHSL', arities: [1] },
  { name: 'isIBAN', arities: [1, 2] },
  { name: 'isIdentityCard', arities: [2] },
  { name: 'isIMEI', arities: [1, 2] },
  { name: 'isIn', arities: [2] },
  { name: 'isInt', arities: [1, 2] },
  { name: 'isIP', arities: [1, 2] },
  { name: 'isIPRange', arities: [1, 2] },
  { name: 'isISBN', arities: [1, 2] },
  { name: 'isISIN', arities: [1] },
  { name: 'isISO15924', arities: [1] },
  { name: 'isISO31661Alpha2', arities: [1, 2] },
  { name: 'isISO31661Alpha3', arities: [1, 2] },
  { name: 'isISO31661Numeric', arities: [1] },
  { name: 'isISO4217', arities: [1] },
  { name: 'isISO6346', arities: [1] },
  { name: 'isISO6391', arities: [1] },
  { name: 'isISO8601', arities: [1, 2] },
  { name: 'isISRC', arities: [1] },
  { name: 'isISSN', arities: [1, 2] },
  { name: 'isJSON', arities: [1, 2] },
  { name: 'isJWT', arities: [1] },
  { name: 'isLatLong', arities: [1, 2] },
  { name: 'isLength', arities: [1, 2] },
  { name: 'isLicensePlate', arities: [2] },
  { name: 'isLocale', arities: [1] },
  { name: 'isLowercase', arities: [1] },
  { name: 'isLuhnNumber', arities: [1] },
  { name: 'isMACAddress', arities: [1, 2] },
  { name: 'isMagnetURI', arities: [1] },
  { name: 'isMailtoURI', arities: [1, 2] },
  { name: 'isMD5', arities: [1] },
  { name: 'isMimeType', arities: [1] },
  { name: 'isMobilePhone', arities: [1, 2, 3] },
  { name: 'isMongoId', arities: [1] },
  { name: 'isMultibyte', arities: [1] },
  { name: 'isNumeric', arities: [1, 2] },
  { name: 'isOctal', arities: [1] },
  { name: 'isPassportNumber', arities: [2] },
  { name: 'isPort', arities: [1] },
  { name: 'isPostalCode', arities: [2] },
  { name: 'isRFC3339', arities: [1] },
  { name: 'isRgbColor', arities: [1, 2] },
  { name: 'isSemVer', arities: [1] },
  { name: 'isSlug', arities: [1] },
  { name: 'isStrongPassword', arities: [1, 2] },
  { name: 'isSurrogatePair', arities: [1] },
  { name: 'isTaxID', arities: [1, 2] },
  { name: 'isTime', arities: [1, 2] },
  { name: 'isULID', arities: [1] },
  { name: 'isURL', arities: [1, 2] },
  { name: 'isUUID', arities: [1, 2] },
  { name: 'isUppercase', arities: [1] },
  { name: 'isVAT', arities: [2] },
  { name: 'isVariableWidth', arities: [1] },
  { name: 'isWhitelisted', arities: [2] },
  { name: 'matches', arities: [2, 3] },
] as const satisfies readonly ValidationFunctionDefinition[];

export const VALIDATION_FUNCTIONS = VALIDATION_FUNCTION_DEFINITIONS.map(
  (definition) => definition.name,
);

export const DETERMINISTIC_VALIDATION_FUNCTIONS =
  VALIDATION_FUNCTION_DEFINITIONS
    .filter((definition) => !('volatile' in definition && definition.volatile))
    .map((definition) => definition.name);

export const VOLATILE_VALIDATION_FUNCTIONS = VALIDATION_FUNCTION_DEFINITIONS
  .filter((definition) => 'volatile' in definition && definition.volatile)
  .map((definition) => definition.name);

export const VALIDATION_FILTERS = new Set(
  VALIDATION_FUNCTION_DEFINITIONS.flatMap((definition) =>
    definition.arities.map((arity) => `${definition.name}/${arity}`),
  ),
);

const VALIDATION_DEFINITION_BY_LOWERCASE = new Map(
  VALIDATION_FUNCTION_DEFINITIONS.map(
    (definition) => [definition.name.toLowerCase(), definition] as const,
  ),
);

export function validationFunctionDefinition(
  name: string,
): ValidationFunctionDefinition | undefined {
  return VALIDATION_DEFINITION_BY_LOWERCASE.get(name.toLowerCase());
}

export function canonicalValidationFunctionName(
  name: string,
  explicitArity?: number,
): string | undefined {
  const definition = validationFunctionDefinition(name);
  if (!definition) {
    return undefined;
  }
  if (
    explicitArity !== undefined &&
    !definition.arities.includes(explicitArity)
  ) {
    return undefined;
  }
  return definition.name;
}

function isIdentifierChar(char: string | undefined) {
  return Boolean(char && /[A-Za-z0-9_]/.test(char));
}

function callOpenIndex(source: string, index: number) {
  let cursor = index;
  while (/\s/.test(source[cursor] ?? '')) {
    cursor++;
  }
  return source[cursor] === '(' ? cursor : -1;
}

function callArity(source: string, openIndex: number): number | undefined {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let sawArgument = false;
  let commaCount = 0;
  let semicolonCount = 0;

  for (let index = openIndex + 1; index < source.length; index++) {
    const char = source[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      sawArgument = true;
      continue;
    }
    if (char === '(' || char === '[' || char === '{') {
      depth++;
      sawArgument = true;
      continue;
    }
    if (char === ')' && depth === 0) {
      if (!sawArgument) return 0;
      return (semicolonCount > 0 ? semicolonCount : commaCount) + 1;
    }
    if (char === ')' || char === ']' || char === '}') {
      depth--;
      continue;
    }
    if (depth === 0 && char === ',') {
      commaCount++;
      continue;
    }
    if (depth === 0 && char === ';') {
      semicolonCount++;
      continue;
    }
    if (!/\s/.test(char)) {
      sawArgument = true;
    }
  }
  return undefined;
}

export function sourceUsesValidationFunction(source: string): boolean {
  let inString = false;
  let escaped = false;
  let inComment = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index]!;
    if (inComment) {
      if (char === '\n') inComment = false;
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '#') {
      inComment = true;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (isIdentifierChar(source[index - 1])) {
      continue;
    }
    const match = source.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (!match) {
      continue;
    }
    const openIndex = callOpenIndex(source, index + match[0].length);
    const arity = openIndex >= 0 ? callArity(source, openIndex) : undefined;
    if (
      openIndex >= 0 &&
      arity !== undefined &&
      canonicalValidationFunctionName(match[0], arity) &&
      !isIdentifierChar(source[index + match[0].length])
    ) {
      return true;
    }
    index += match[0].length - 1;
  }
  return false;
}
