import { TIMEZONES, type CoverageCase } from './case.ts';

export const validationCases: CoverageCase[] = [
  // Comparison and membership. `matches` takes the pattern as a string, and
  // its third argument is the regex flag set.
  {
    covers: 'contains/2',
    source: 'contains("hello world", "world")',
    expected: true,
  },
  {
    covers: 'contains/3',
    source: 'contains("hello world", "WORLD", {ignoreCase: true})',
    expected: true,
  },
  { covers: 'equals/2', source: 'equals("same", "same")', expected: true },
  {
    covers: 'matches/2',
    source: 'matches("abc123", "[0-9]+")',
    expected: true,
  },
  { covers: 'matches/3', source: 'matches("ABC", "abc", "i")', expected: true },
  { covers: 'isIn/2', source: 'isIn("red", ["red", "blue"])', expected: true },
  // The second argument is the set of permitted characters, not a list of
  // permitted values, so any arrangement of them passes.
  {
    covers: 'isWhitelisted/2',
    source: 'isWhitelisted("cab", "abc")',
    expected: true,
  },

  // Text shape and length.
  { covers: 'isEmpty/1', source: 'isEmpty("")', expected: true },
  {
    covers: 'isEmpty/2',
    source: 'isEmpty("  ", {ignore_whitespace: true})',
    expected: true,
  },
  { covers: 'isLength/1', source: 'isLength("hello")', expected: true },
  // Length counts code points, so two astral emoji measure 2 and fall short of
  // this minimum even though they occupy four UTF-16 units.
  {
    covers: 'isLength/2',
    source: 'isLength("😀😀", {min: 3})',
    expected: false,
  },
  // isByteLength with no options leaves its minimum unset, so no string can
  // satisfy it; the non-string guard is the only assertion it supports.
  { covers: 'isByteLength/1', source: 'isByteLength(42)', expected: false },
  // Byte length counts UTF-8 bytes: "héllo" is five characters, six bytes.
  {
    covers: 'isByteLength/2',
    source: 'isByteLength("héllo", {min: 6, max: 6})',
    expected: true,
  },
  { covers: 'isLowercase/1', source: 'isLowercase("abc")', expected: true },
  { covers: 'isUppercase/1', source: 'isUppercase("ABC")', expected: true },
  { covers: 'isAscii/1', source: 'isAscii("abc")', expected: true },
  { covers: 'isSlug/1', source: 'isSlug("valid-slug_1")', expected: true },
  { covers: 'isAlpha/1', source: 'isAlpha("abc")', expected: true },
  { covers: 'isAlpha/2', source: 'isAlpha("абв", "ru-RU")', expected: true },
  {
    covers: 'isAlpha/3',
    source: 'isAlpha("abc-def", "en-US", {ignore: "-"})',
    expected: true,
  },
  {
    covers: 'isAlphanumeric/1',
    source: 'isAlphanumeric("abc123")',
    expected: true,
  },
  {
    covers: 'isAlphanumeric/2',
    source: 'isAlphanumeric("абв123", "ru-RU")',
    expected: true,
  },
  {
    covers: 'isAlphanumeric/3',
    source: 'isAlphanumeric("ab-12", "en-US", {ignore: "-"})',
    expected: true,
  },
  {
    covers: 'isStrongPassword/1',
    source: 'isStrongPassword("Aa1!aaaa")',
    expected: true,
  },
  // Scored, this is 4 unique characters at 1 point, 4 repeats at 0.5, and 10
  // points each for containing a lowercase, uppercase, digit and symbol.
  {
    covers: 'isStrongPassword/2',
    source: 'isStrongPassword("Aa1!aaaa", {returnScore: true})',
    expected: 46,
  },

  // Character width.
  {
    covers: 'isFullWidth/1',
    source: 'isFullWidth("Ｈｅｌｌｏ")',
    expected: true,
  },
  { covers: 'isHalfWidth/1', source: 'isHalfWidth("Hello")', expected: true },
  {
    covers: 'isVariableWidth/1',
    source: 'isVariableWidth("abcＨ")',
    expected: true,
  },
  {
    covers: 'isMultibyte/1',
    source: 'isMultibyte("こんにちは")',
    expected: true,
  },
  {
    covers: 'isSurrogatePair/1',
    source: 'isSurrogatePair("😀")',
    expected: true,
  },

  // Numbers.
  { covers: 'isNumeric/1', source: 'isNumeric("+42")', expected: true },
  {
    covers: 'isNumeric/2',
    source: 'isNumeric("+42", {no_symbols: true})',
    expected: false,
  },
  { covers: 'isInt/1', source: 'isInt("42")', expected: true },
  { covers: 'isInt/2', source: 'isInt("42", {min: 100})', expected: false },
  { covers: 'isFloat/1', source: 'isFloat("2.5")', expected: true },
  { covers: 'isFloat/2', source: 'isFloat("2.5", {max: 2})', expected: false },
  { covers: 'isDecimal/1', source: 'isDecimal("12")', expected: true },
  {
    covers: 'isDecimal/2',
    source: 'isDecimal("12", {force_decimal: true})',
    expected: false,
  },
  {
    covers: 'isDivisibleBy/2',
    source: 'isDivisibleBy("10", 5)',
    expected: true,
  },
  { covers: 'isPort/1', source: 'isPort("8080")', expected: true },
  { covers: 'isOctal/1', source: 'isOctal("755")', expected: true },
  {
    covers: 'isHexadecimal/1',
    source: 'isHexadecimal("deadBEEF")',
    expected: true,
  },
  {
    covers: 'isLuhnNumber/1',
    source: 'isLuhnNumber("79927398713")',
    expected: true,
  },

  // Encodings, hashes and opaque identifiers.
  { covers: 'isBase32/1', source: 'isBase32("MZXW6===")', expected: true },
  // Crockford base32 drops I, L, O and U, so its alphabet is not RFC 4648's.
  {
    covers: 'isBase32/2',
    source: 'isBase32("0123456789ABCDEFGHJKMNPQRSTVWXYZ", {crockford: true})',
    expected: true,
  },
  {
    covers: 'isBase58/1',
    source:
      'isBase58("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz")',
    expected: true,
  },
  { covers: 'isBase64/1', source: 'isBase64("Zm9vYmFy")', expected: true },
  {
    covers: 'isBase64/2',
    source: 'isBase64("-_-_", {urlSafe: true})',
    expected: true,
  },
  {
    covers: 'isHash/2',
    source: 'isHash("d41d8cd98f00b204e9800998ecf8427e", "md5")',
    expected: true,
  },
  {
    covers: 'isMD5/1',
    source: 'isMD5("d41d8cd98f00b204e9800998ecf8427e")',
    expected: true,
  },
  { covers: 'isJSON/1', source: 'isJSON("{\\"a\\":1}")', expected: true },
  {
    covers: 'isJSON/2',
    source: 'isJSON("true", {allow_primitives: true})',
    expected: true,
  },
  {
    covers: 'isJWT/1',
    source: 'isJWT("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature")',
    expected: true,
  },
  {
    covers: 'isDataURI/1',
    source: 'isDataURI("data:text/plain;base64,SGVsbG8=")',
    expected: true,
  },
  {
    covers: 'isMagnetURI/1',
    source:
      'isMagnetURI("magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567")',
    expected: true,
  },
  {
    covers: 'isMimeType/1',
    source: 'isMimeType("text/plain")',
    expected: true,
  },
  {
    covers: 'isMongoId/1',
    source: 'isMongoId("507f1f77bcf86cd799439011")',
    expected: true,
  },
  {
    covers: 'isULID/1',
    source: 'isULID("01ARZ3NDEKTSV4RRFFQ69G5FAV")',
    expected: true,
  },
  {
    covers: 'isUUID/1',
    source: 'isUUID("9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d")',
    expected: true,
  },
  {
    covers: 'isUUID/2',
    source: 'isUUID("9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d", 1)',
    expected: false,
  },
  { covers: 'isSemVer/1', source: 'isSemVer("1.2.3")', expected: true },
  { covers: 'isBoolean/1', source: 'isBoolean("yes")', expected: false },
  {
    covers: 'isBoolean/2',
    source: 'isBoolean("yes", {loose: true})',
    expected: true,
  },

  // Network and URI.
  { covers: 'isEmail/1', source: 'isEmail("ada@example.com")', expected: true },
  { covers: 'isEmail/1', source: 'isEmail(42)', expected: false },
  {
    covers: 'isEmail/2',
    source: 'isEmail("Ada <ada@example.com>", {allow_display_name: true})',
    expected: true,
  },
  { covers: 'isURL/1', source: 'isURL("example.com")', expected: true },
  {
    covers: 'isURL/2',
    source: 'isURL("example.com", {require_protocol: true})',
    expected: false,
  },
  { covers: 'isFQDN/1', source: 'isFQDN("localhost")', expected: false },
  {
    covers: 'isFQDN/2',
    source: 'isFQDN("localhost", {require_tld: false})',
    expected: true,
  },
  { covers: 'isIP/1', source: 'isIP("127.0.0.1")', expected: true },
  { covers: 'isIP/2', source: 'isIP("127.0.0.1", 6)', expected: false },
  {
    covers: 'isIPRange/1',
    source: 'isIPRange("192.168.0.0/24")',
    expected: true,
  },
  {
    covers: 'isIPRange/2',
    source: 'isIPRange("192.168.0.0/24", 6)',
    expected: false,
  },
  {
    covers: 'isMACAddress/1',
    source: 'isMACAddress("001B44113AB7")',
    expected: false,
  },
  {
    covers: 'isMACAddress/2',
    source: 'isMACAddress("001B44113AB7", {no_separators: true})',
    expected: true,
  },
  {
    covers: 'isMailtoURI/1',
    source: 'isMailtoURI("mailto:ada@example.com")',
    expected: true,
  },
  {
    covers: 'isMailtoURI/2',
    source:
      'isMailtoURI("mailto:Ada <ada@example.com>", {allow_display_name: true})',
    expected: true,
  },
  {
    covers: 'isLatLong/1',
    source: 'isLatLong("37.7749,-122.4194")',
    expected: true,
  },
  // checkDMS switches to degrees/minutes/seconds, which decimal degrees fail.
  {
    covers: 'isLatLong/2',
    source: 'isLatLong("37.7749,-122.4194", {checkDMS: true})',
    expected: false,
  },

  // Colors.
  { covers: 'isHexColor/1', source: 'isHexColor("ff00aa")', expected: true },
  {
    covers: 'isHexColor/2',
    source: 'isHexColor("ff00aa", {require_hashtag: true})',
    expected: false,
  },
  {
    covers: 'isRgbColor/1',
    source: 'isRgbColor("rgb(5%,5%,5%)")',
    expected: true,
  },
  {
    covers: 'isRgbColor/2',
    source: 'isRgbColor("rgb(5%,5%,5%)", {includePercentValues: false})',
    expected: false,
  },
  { covers: 'isHSL/1', source: 'isHSL("hsl(120, 100%, 50%)")', expected: true },

  // Financial identifiers.
  {
    covers: 'isAbaRouting/1',
    source: 'isAbaRouting("021000021")',
    expected: true,
  },
  { covers: 'isBIC/1', source: 'isBIC("DEUTDEFF")', expected: true },
  {
    covers: 'isIBAN/1',
    source: 'isIBAN("GB82WEST12345698765432")',
    expected: true,
  },
  {
    covers: 'isIBAN/2',
    source: 'isIBAN("GB82WEST12345698765432", {whitelist: ["DE"]})',
    expected: false,
  },
  {
    covers: 'isCreditCard/1',
    source: 'isCreditCard("4111111111111111")',
    expected: true,
  },
  {
    covers: 'isCreditCard/2',
    source: 'isCreditCard("4111111111111111", {provider: "mastercard"})',
    expected: false,
  },
  { covers: 'isCurrency/1', source: 'isCurrency("1,234.56")', expected: true },
  {
    covers: 'isCurrency/2',
    source: 'isCurrency("1,234.56", {require_symbol: true})',
    expected: false,
  },
  {
    covers: 'isBtcAddress/1',
    source: 'isBtcAddress("1BoatSLRHtKNngkdXEeobR76b53LETtpyT")',
    expected: true,
  },
  {
    covers: 'isEthereumAddress/1',
    source: 'isEthereumAddress("0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe")',
    expected: true,
  },
  { covers: 'isISIN/1', source: 'isISIN("US0378331005")', expected: true },
  { covers: 'isEAN/1', source: 'isEAN("4006381333931")', expected: true },
  { covers: 'isTaxID/1', source: 'isTaxID("123456789")', expected: true },
  {
    covers: 'isTaxID/2',
    source: 'isTaxID("123456789", "de-DE")',
    expected: false,
  },
  { covers: 'isVAT/2', source: 'isVAT("DE123456789", "DE")', expected: true },

  // Identity documents and serial numbers.
  {
    covers: 'isIdentityCard/2',
    source: 'isIdentityCard("12345678Z", "ES")',
    expected: true,
  },
  // The French passport format is two digits, two letters, five digits.
  {
    covers: 'isPassportNumber/2',
    source: 'isPassportNumber("12AB34567", "FR")',
    expected: true,
  },
  // Brazil's Mercosul plate interleaves a letter into the numeric block.
  {
    covers: 'isLicensePlate/2',
    source: 'isLicensePlate("ABC1D23", "pt-BR")',
    expected: true,
  },
  { covers: 'isIMEI/1', source: 'isIMEI("490154203237518")', expected: true },
  {
    covers: 'isIMEI/2',
    source: 'isIMEI("49-015420-323751-8", {allow_hyphens: true})',
    expected: true,
  },
  { covers: 'isISBN/1', source: 'isISBN("978-0-306-40615-7")', expected: true },
  {
    covers: 'isISBN/2',
    source: 'isISBN("978-0-306-40615-7", 10)',
    expected: false,
  },
  { covers: 'isISSN/1', source: 'isISSN("03785955")', expected: true },
  {
    covers: 'isISSN/2',
    source: 'isISSN("03785955", {require_hyphen: true})',
    expected: false,
  },
  { covers: 'isISRC/1', source: 'isISRC("USRC17607839")', expected: true },
  {
    covers: 'isFreightContainerID/1',
    source: 'isFreightContainerID("CSQU3054383")',
    expected: true,
  },
  { covers: 'isISO6346/1', source: 'isISO6346("CSQU3054383")', expected: true },

  // ISO codes, locales and locale-parameterized formats.
  { covers: 'isISO15924/1', source: 'isISO15924("Latn")', expected: true },
  {
    covers: 'isISO31661Alpha2/1',
    source: 'isISO31661Alpha2("XX")',
    expected: false,
  },
  {
    covers: 'isISO31661Alpha2/2',
    source: 'isISO31661Alpha2("XX", {userAssignedCodes: ["XX"]})',
    expected: true,
  },
  {
    covers: 'isISO31661Alpha3/1',
    source: 'isISO31661Alpha3("XXX")',
    expected: false,
  },
  {
    covers: 'isISO31661Alpha3/2',
    source: 'isISO31661Alpha3("XXX", {userAssignedCodes: ["XXX"]})',
    expected: true,
  },
  {
    covers: 'isISO31661Numeric/1',
    source: 'isISO31661Numeric("840")',
    expected: true,
  },
  { covers: 'isISO4217/1', source: 'isISO4217("USD")', expected: true },
  { covers: 'isISO6391/1', source: 'isISO6391("en")', expected: true },
  { covers: 'isLocale/1', source: 'isLocale("en-US")', expected: true },
  {
    covers: 'isPostalCode/2',
    source: 'isPostalCode("94105", "US")',
    expected: true,
  },
  // An unrecognized locale is reported as invalid rather than raised.
  {
    covers: 'isPostalCode/2',
    source: 'isPostalCode("94105", "NOPE")',
    expected: false,
  },
  {
    covers: 'isMobilePhone/1',
    source: 'isMobilePhone("+14155552671")',
    expected: true,
  },
  {
    covers: 'isMobilePhone/2',
    source: 'isMobilePhone("+14155552671", "de-DE")',
    expected: false,
  },
  // Strict mode requires the number to carry its own country code.
  {
    covers: 'isMobilePhone/3',
    source: 'isMobilePhone("4155552671", "en-US", {strictMode: true})',
    expected: false,
  },

  // Dates and times. The comparison date rides in an options object, and with
  // none supplied isAfter/isBefore compare against the moment they run.
  {
    covers: 'isAfter/1',
    source: 'isAfter("2200-01-01")',
    expected: true,
    zones: TIMEZONES,
  },
  {
    covers: 'isAfter/2',
    source: 'isAfter("1900-01-02", {comparisonDate: "1900-01-01"})',
    expected: true,
    zones: TIMEZONES,
  },
  {
    covers: 'isBefore/1',
    source: 'isBefore("1900-01-01")',
    expected: true,
    zones: TIMEZONES,
  },
  {
    covers: 'isBefore/2',
    source: 'isBefore("2200-01-02", {comparisonDate: "2200-01-03"})',
    expected: true,
    zones: TIMEZONES,
  },
  {
    covers: 'isDate/1',
    source: 'isDate("10-05-2026")',
    expected: false,
    zones: TIMEZONES,
  },
  {
    covers: 'isDate/2',
    source: 'isDate("10-05-2026", {format: "DD-MM-YYYY"})',
    expected: true,
    zones: TIMEZONES,
  },
  // Without strict mode isISO8601 checks only the shape, so February 30 passes.
  {
    covers: 'isISO8601/1',
    source: 'isISO8601("2026-02-30")',
    expected: true,
    zones: TIMEZONES,
  },
  {
    covers: 'isISO8601/2',
    source: 'isISO8601("2026-02-30", {strict: true})',
    expected: false,
    zones: TIMEZONES,
  },
  {
    covers: 'isRFC3339/1',
    source: 'isRFC3339("2026-05-10T12:34:56Z")',
    expected: true,
    zones: TIMEZONES,
  },
  {
    covers: 'isTime/1',
    source: 'isTime("11:59 PM")',
    expected: false,
    zones: TIMEZONES,
  },
  {
    covers: 'isTime/2',
    source: 'isTime("11:59 PM", {hourFormat: "hour12"})',
    expected: true,
    zones: TIMEZONES,
  },
];
