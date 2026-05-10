import { strictEqual } from 'node:assert';
import {
  compileReadableSyntax,
  lintBxlExpression,
  runNativeJqAsync,
  solidifyBxlExpression,
  type ReadableSchema,
} from '../../src/index.js';

const schema: ReadableSchema = {
  fields: [
    { key: 'email', label: 'Email' },
    { key: 'website', label: 'Website' },
    { key: 'id', label: 'ID' },
    { key: 'text', label: 'Text' },
  ],
};

const input = {
  email: 'ada@example.com',
  website: 'https://example.com',
  id: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
  text: 'hello world',
};

async function value(expression: string, data: unknown = input) {
  const result = await runNativeJqAsync(expression, data, { schema });
  strictEqual(result.outputs.length, 1, expression);
  return result.outputs[0];
}

strictEqual(
  compileReadableSyntax('isemail(Email)', { schema }).source,
  'isEmail(.email)',
  'readable BXL canonicalizes validator.js functions to upstream casing',
);
strictEqual(
  compileReadableSyntax('ISURL(Website, {require_protocol: true})', { schema }).source,
  'isURL(.website; {require_protocol:true})',
  'validator.js functions keep readable comma args and upstream option shape',
);
strictEqual(
  solidifyBxlExpression('ISEMAIL(Email)', { schema }).source,
  'isEmail(Email)',
  'solidify canonicalizes validator.js functions to upstream casing',
);
strictEqual(
  solidifyBxlExpression('ISURL(Website, {require_protocol: true})', { schema }).source,
  'isURL(Website, {require_protocol:true})',
  'solidify keeps validator.js option shape with readable commas',
);
strictEqual(
  lintBxlExpression('ISEMAIL(Email)', { schema }).issues.some(
    (issue) => issue.code === 'validator-function-case-preferred',
  ),
  true,
  'linter nudges validator.js functions to upstream casing',
);

strictEqual(await value('isEmail(Email)'), true, 'isEmail validates email strings');
strictEqual(await value('isEmail("not-an-email")'), false, 'isEmail rejects invalid email strings');
strictEqual(await value('isEmail(42)'), false, 'validator.js functions return false for non-strings');

strictEqual(await value('isURL(Website)'), true, 'isURL validates URL strings');
strictEqual(
  await value('isURL("example.com", {require_protocol: true})'),
  false,
  'isURL preserves validator.js options',
);
strictEqual(
  await value('isURL("https://example.com", {require_protocol: true})'),
  true,
  'isURL accepts option objects',
);

strictEqual(await value('isUUID(ID)'), true, 'isUUID validates all UUID versions by default');
strictEqual(await value('isUUID(ID, 4)'), true, 'isUUID accepts validator.js version arg');
strictEqual(await value('isUUID(ID, 1)'), false, 'isUUID version arg is honored');

strictEqual(
  await value('isULID("01ARZ3NDEKTSV4RRFFQ69G5FAV")'),
  true,
  'isULID validates ULIDs',
);
strictEqual(await value('isIP("127.0.0.1")'), true, 'isIP validates IPv4');
strictEqual(await value('isIP("127.0.0.1", 6)'), false, 'isIP accepts version arg');
strictEqual(await value('isFQDN("example.com")'), true, 'isFQDN validates hostnames');

strictEqual(
  await value('isIBAN("GB82WEST12345698765432")'),
  true,
  'isIBAN validates bank account numbers',
);
strictEqual(await value('isBIC("DEUTDEFF")'), true, 'isBIC validates SWIFT/BIC codes');
strictEqual(
  await value('isISBN("978-0-306-40615-7", 13)'),
  true,
  'isISBN accepts validator.js version arg',
);
strictEqual(await value('isISIN("US0378331005")'), true, 'isISIN validates securities IDs');

strictEqual(await value('isHexColor("#ff00aa")'), true, 'isHexColor validates CSS hex colors');
strictEqual(
  await value('isHexColor("ff00aa", {require_hashtag: true})'),
  false,
  'isHexColor accepts option objects',
);
strictEqual(
  await value('isRFC3339("2026-05-10T12:34:56Z")'),
  true,
  'isRFC3339 validates timestamps',
);
strictEqual(await value('isISO8601("2026-05-10")'), true, 'isISO8601 validates dates');
strictEqual(
  await value('isPostalCode("94105", "US")'),
  true,
  'isPostalCode accepts validator.js locale arg',
);
strictEqual(
  await value('isPostalCode("94105", "NOPE")'),
  false,
  'invalid validator.js options return false instead of throwing',
);
strictEqual(await value('isSlug("valid-slug_1")'), true, 'isSlug validates slugs');
strictEqual(await value('isSlug("Bad Slug")'), false, 'isSlug rejects spaces');

const positiveCases: Array<[string, unknown]> = [
  ['contains(Text, "world")', true],
  ['contains(Text, "WORLD", {ignoreCase:true})', true],
  ['equals("same", "same")', true],
  ['isAbaRouting("021000021")', true],
  ['isAfter("2026-01-02", {comparisonDate:"2026-01-01"})', true],
  ['isAlpha("abc")', true],
  ['isAlpha("abc-def", "en-US", {ignore:"-"})', true],
  ['isAlphanumeric("abc123")', true],
  ['isAscii("abc")', true],
  ['isBase32("MZXW6===")', true],
  ['isBase58("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz")', true],
  ['isBase64("Zm9vYmFy")', true],
  ['isBefore("2026-01-01", {comparisonDate:"2026-01-02"})', true],
  ['isBoolean("true")', true],
  ['isBtcAddress("1BoatSLRHtKNngkdXEeobR76b53LETtpyT")', true],
  ['isByteLength("hello", {min:3, max:5})', true],
  ['isCreditCard("4111111111111111")', true],
  ['isCurrency("$1,234.56", {require_symbol:true})', true],
  ['isDataURI("data:text/plain;base64,SGVsbG8=")', true],
  ['isDate("2026-05-10", {format:"YYYY-MM-DD", strictMode:true})', true],
  ['isDecimal("12.34")', true],
  ['isDivisibleBy("10", 5)', true],
  ['isEAN("4006381333931")', true],
  ['isEthereumAddress("0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe")', true],
  ['isFloat("1.5", {min:1, max:2})', true],
  ['isFreightContainerID("CSQU3054383")', true],
  ['isFullWidth("Ｈｅｌｌｏ")', true],
  ['isHalfWidth("Hello")', true],
  ['isHash("d41d8cd98f00b204e9800998ecf8427e", "md5")', true],
  ['isHexadecimal("deadBEEF")', true],
  ['isHSL("hsl(120, 100%, 50%)")', true],
  ['isIdentityCard("12345678Z", "ES")', true],
  ['isIMEI("490154203237518")', true],
  ['isIn("red", ["red", "blue"])', true],
  ['isInt("42", {min:1})', true],
  ['isIPRange("192.168.0.0/24")', true],
  ['isISO15924("Latn")', true],
  ['isISO31661Alpha2("US")', true],
  ['isISO31661Alpha3("USA")', true],
  ['isISO31661Numeric("840")', true],
  ['isISO4217("USD")', true],
  ['isISO6346("CSQU3054383")', true],
  ['isISO6391("en")', true],
  ['isISRC("USRC17607839")', true],
  ['isISSN("0378-5955")', true],
  ['isJSON("{\\"a\\":1}")', true],
  ['isJWT("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature")', true],
  ['isLatLong("37.7749,-122.4194")', true],
  ['isLength("hello", {min:3, max:5})', true],
  ['isLicensePlate("ABC-1234", "pt-BR")', true],
  ['isLocale("en-US")', true],
  ['isLowercase("abc")', true],
  ['isLuhnNumber("79927398713")', true],
  ['isMACAddress("00:1B:44:11:3A:B7")', true],
  ['isMagnetURI("magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567")', true],
  ['isMailtoURI("mailto:ada@example.com")', true],
  ['isMD5("d41d8cd98f00b204e9800998ecf8427e")', true],
  ['isMimeType("text/plain")', true],
  ['isMobilePhone("+14155552671", "en-US", {strictMode:true})', true],
  ['isMongoId("507f1f77bcf86cd799439011")', true],
  ['isMultibyte("こんにちは")', true],
  ['isNumeric("12345")', true],
  ['isOctal("755")', true],
  ['isPassportNumber("123456789", "US")', true],
  ['isPort("8080")', true],
  ['isRgbColor("rgb(255,0,0)")', true],
  ['isSemVer("1.2.3")', true],
  ['isStrongPassword("Aa1!aaaa")', true],
  ['isStrongPassword("Aa1!aaaa", {returnScore:true})', 46],
  ['isSurrogatePair("😀")', true],
  ['isTaxID("123456789", "en-US")', true],
  ['isTime("23:59")', true],
  ['isUppercase("ABC")', true],
  ['isVAT("DE123456789", "DE")', true],
  ['isVariableWidth("abcＨ")', true],
  ['isWhitelisted("abc", "abc")', true],
  ['matches("abc123", "\\\\d+")', true],
];

for (const [expression, expected] of positiveCases) {
  strictEqual(await value(expression), expected, expression);
}

console.log('BXL validation: validator.js-style lazy functions passed');
