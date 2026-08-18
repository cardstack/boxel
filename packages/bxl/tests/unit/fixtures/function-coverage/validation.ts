import type { CoverageCase } from './case.ts';

export const validationCases: CoverageCase[] = [
  // Comparison and membership. `matches` takes the pattern as a string, and
  // its third argument is the regex flag set.
  {
    covers: 'contains/2',
    source: 'contains("hello world", "world")',
    expected: true,
  },
  {
    covers: 'contains/2',
    source: 'contains("hello world", "moon")',
    expected: false,
  },
  {
    covers: 'contains/3',
    source: 'contains("hello world", "WORLD", {ignoreCase: true})',
    expected: true,
  },
  {
    covers: 'contains/3',
    source: 'contains("hello world", "WORLD", {ignoreCase: false})',
    expected: false,
  },
  { covers: 'equals/2', source: 'equals("same", "same")', expected: true },
  {
    covers: 'equals/2',
    source: 'equals("same", "different")',
    expected: false,
  },
  {
    covers: 'matches/2',
    source: 'matches("abc123", "[0-9]+")',
    expected: true,
  },
  {
    covers: 'matches/2',
    source: 'matches("abcdef", "[0-9]+")',
    expected: false,
  },
  { covers: 'matches/3', source: 'matches("ABC", "abc", "i")', expected: true },
  {
    covers: 'matches/3',
    source: 'matches("ABC", "abc", "g")',
    expected: false,
  },
  { covers: 'isIn/2', source: 'isIn("red", ["red", "blue"])', expected: true },
  {
    covers: 'isIn/2',
    source: 'isIn("green", ["red", "blue"])',
    expected: false,
  },
  // The second argument is the set of permitted characters, not a list of
  // permitted values, so any arrangement of them passes.
  {
    covers: 'isWhitelisted/2',
    source: 'isWhitelisted("cab", "abc")',
    expected: true,
  },
  {
    covers: 'isWhitelisted/2',
    source: 'isWhitelisted("cad", "abc")',
    expected: false,
  },

  // Text shape and length.
  { covers: 'isEmpty/1', source: 'isEmpty("")', expected: true },
  { covers: 'isEmpty/1', source: 'isEmpty("x")', expected: false },
  {
    covers: 'isEmpty/2',
    source: 'isEmpty("  ", {ignore_whitespace: true})',
    expected: true,
  },
  {
    covers: 'isEmpty/2',
    source: 'isEmpty("  ", {ignore_whitespace: false})',
    expected: false,
  },
  { covers: 'isLength/1', source: 'isLength("hello")', expected: true },
  { covers: 'isLength/1', source: 'isLength(42)', expected: false },
  // Length counts code points, so two astral emoji measure 2 and fall short of
  // this minimum even though they occupy four UTF-16 units.
  {
    covers: 'isLength/2',
    source: 'isLength("😀😀", {min: 3})',
    expected: false,
  },
  {
    covers: 'isLength/2',
    source: 'isLength("😀😀", {min: 2})',
    expected: true,
  },
  // Upstream validator.js reads the minimum as `arguments[1]` with no `|| 0`
  // fallback, so the one-argument form compares a length against `undefined`
  // and no string can satisfy it. The bridge is faithful to that, which leaves
  // the non-string guard as the only assertion this arity supports — and
  // makes it the one validator here with a single polarity, because false is
  // the only answer it has.
  { covers: 'isByteLength/1', source: 'isByteLength(42)', expected: false },
  // Byte length counts UTF-8 bytes: "héllo" is five characters, six bytes.
  {
    covers: 'isByteLength/2',
    source: 'isByteLength("héllo", {min: 6, max: 6})',
    expected: true,
  },
  {
    covers: 'isByteLength/2',
    source: 'isByteLength("héllo", {min: 7})',
    expected: false,
  },
  { covers: 'isLowercase/1', source: 'isLowercase("abc")', expected: true },
  { covers: 'isLowercase/1', source: 'isLowercase("Abc")', expected: false },
  { covers: 'isUppercase/1', source: 'isUppercase("ABC")', expected: true },
  { covers: 'isUppercase/1', source: 'isUppercase("aBC")', expected: false },
  { covers: 'isAscii/1', source: 'isAscii("abc")', expected: true },
  { covers: 'isAscii/1', source: 'isAscii("café")', expected: false },
  { covers: 'isSlug/1', source: 'isSlug("valid-slug_1")', expected: true },
  { covers: 'isSlug/1', source: 'isSlug("not a slug!")', expected: false },
  { covers: 'isAlpha/1', source: 'isAlpha("abc")', expected: true },
  { covers: 'isAlpha/1', source: 'isAlpha("abc1")', expected: false },
  { covers: 'isAlpha/2', source: 'isAlpha("абв", "ru-RU")', expected: true },
  // Latin letters are not in the Russian alphabet.
  { covers: 'isAlpha/2', source: 'isAlpha("abc", "ru-RU")', expected: false },
  {
    covers: 'isAlpha/3',
    source: 'isAlpha("abc-def", "en-US", {ignore: "-"})',
    expected: true,
  },
  {
    covers: 'isAlpha/3',
    source: 'isAlpha("abc-def", "en-US", {ignore: "_"})',
    expected: false,
  },
  {
    covers: 'isAlphanumeric/1',
    source: 'isAlphanumeric("abc123")',
    expected: true,
  },
  {
    covers: 'isAlphanumeric/1',
    source: 'isAlphanumeric("abc-123")',
    expected: false,
  },
  {
    covers: 'isAlphanumeric/2',
    source: 'isAlphanumeric("абв123", "ru-RU")',
    expected: true,
  },
  {
    covers: 'isAlphanumeric/2',
    source: 'isAlphanumeric("abc123", "ru-RU")',
    expected: false,
  },
  {
    covers: 'isAlphanumeric/3',
    source: 'isAlphanumeric("ab-12", "en-US", {ignore: "-"})',
    expected: true,
  },
  {
    covers: 'isAlphanumeric/3',
    source: 'isAlphanumeric("ab-12", "en-US", {ignore: "_"})',
    expected: false,
  },
  {
    covers: 'isStrongPassword/1',
    source: 'isStrongPassword("Aa1!aaaa")',
    expected: true,
  },
  // One character class and no length to spare scores below the default 50.
  {
    covers: 'isStrongPassword/1',
    source: 'isStrongPassword("password")',
    expected: false,
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
  { covers: 'isFullWidth/1', source: 'isFullWidth("Hello")', expected: false },
  { covers: 'isHalfWidth/1', source: 'isHalfWidth("Hello")', expected: true },
  {
    covers: 'isHalfWidth/1',
    source: 'isHalfWidth("Ｈｅｌｌｏ")',
    expected: false,
  },
  {
    covers: 'isVariableWidth/1',
    source: 'isVariableWidth("abcＨ")',
    expected: true,
  },
  // Variable width needs both a half-width and a full-width character.
  {
    covers: 'isVariableWidth/1',
    source: 'isVariableWidth("abc")',
    expected: false,
  },
  {
    covers: 'isMultibyte/1',
    source: 'isMultibyte("こんにちは")',
    expected: true,
  },
  { covers: 'isMultibyte/1', source: 'isMultibyte("hello")', expected: false },
  {
    covers: 'isSurrogatePair/1',
    source: 'isSurrogatePair("😀")',
    expected: true,
  },
  {
    covers: 'isSurrogatePair/1',
    source: 'isSurrogatePair("abc")',
    expected: false,
  },

  // Numbers.
  { covers: 'isNumeric/1', source: 'isNumeric("+42")', expected: true },
  { covers: 'isNumeric/1', source: 'isNumeric("abc")', expected: false },
  {
    covers: 'isNumeric/2',
    source: 'isNumeric("+42", {no_symbols: true})',
    expected: false,
  },
  {
    covers: 'isNumeric/2',
    source: 'isNumeric("42", {no_symbols: true})',
    expected: true,
  },
  { covers: 'isInt/1', source: 'isInt("42")', expected: true },
  { covers: 'isInt/1', source: 'isInt("4.2")', expected: false },
  { covers: 'isInt/2', source: 'isInt("42", {min: 100})', expected: false },
  { covers: 'isInt/2', source: 'isInt("42", {min: 40})', expected: true },
  { covers: 'isFloat/1', source: 'isFloat("2.5")', expected: true },
  { covers: 'isFloat/1', source: 'isFloat("abc")', expected: false },
  { covers: 'isFloat/2', source: 'isFloat("2.5", {max: 2})', expected: false },
  { covers: 'isFloat/2', source: 'isFloat("2.5", {max: 3})', expected: true },
  { covers: 'isDecimal/1', source: 'isDecimal("12")', expected: true },
  { covers: 'isDecimal/1', source: 'isDecimal("abc")', expected: false },
  {
    covers: 'isDecimal/2',
    source: 'isDecimal("12", {force_decimal: true})',
    expected: false,
  },
  {
    covers: 'isDecimal/2',
    source: 'isDecimal("12.5", {force_decimal: true})',
    expected: true,
  },
  {
    covers: 'isDivisibleBy/2',
    source: 'isDivisibleBy("10", 5)',
    expected: true,
  },
  {
    covers: 'isDivisibleBy/2',
    source: 'isDivisibleBy("10", 3)',
    expected: false,
  },
  { covers: 'isPort/1', source: 'isPort("8080")', expected: true },
  // Ports stop at 65535.
  { covers: 'isPort/1', source: 'isPort("70000")', expected: false },
  { covers: 'isOctal/1', source: 'isOctal("755")', expected: true },
  { covers: 'isOctal/1', source: 'isOctal("789")', expected: false },
  {
    covers: 'isHexadecimal/1',
    source: 'isHexadecimal("deadBEEF")',
    expected: true,
  },
  {
    covers: 'isHexadecimal/1',
    source: 'isHexadecimal("deadbeefg")',
    expected: false,
  },
  {
    covers: 'isLuhnNumber/1',
    source: 'isLuhnNumber("79927398713")',
    expected: true,
  },
  // Each of these negatives changes only the check digit.
  {
    covers: 'isLuhnNumber/1',
    source: 'isLuhnNumber("79927398710")',
    expected: false,
  },

  // Encodings, hashes and opaque identifiers.
  { covers: 'isBase32/1', source: 'isBase32("MZXW6===")', expected: true },
  { covers: 'isBase32/1', source: 'isBase32("not base32!")', expected: false },
  // Crockford base32 drops I, L, O and U, so its alphabet is not RFC 4648's.
  {
    covers: 'isBase32/2',
    source: 'isBase32("0123456789ABCDEFGHJKMNPQRSTVWXYZ", {crockford: true})',
    expected: true,
  },
  // Crockford's alphabet has no padding character.
  {
    covers: 'isBase32/2',
    source: 'isBase32("MZXW6===", {crockford: true})',
    expected: false,
  },
  {
    covers: 'isBase58/1',
    source:
      'isBase58("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz")',
    expected: true,
  },
  // Base58 drops exactly the four characters that read ambiguously.
  { covers: 'isBase58/1', source: 'isBase58("0OIl")', expected: false },
  { covers: 'isBase64/1', source: 'isBase64("Zm9vYmFy")', expected: true },
  { covers: 'isBase64/1', source: 'isBase64("!!!")', expected: false },
  {
    covers: 'isBase64/2',
    source: 'isBase64("-_-_", {urlSafe: true})',
    expected: true,
  },
  // The URL-safe alphabet replaces + and / with - and _.
  {
    covers: 'isBase64/2',
    source: 'isBase64("+/+/", {urlSafe: true})',
    expected: false,
  },
  {
    covers: 'isHash/2',
    source: 'isHash("d41d8cd98f00b204e9800998ecf8427e", "md5")',
    expected: true,
  },
  { covers: 'isHash/2', source: 'isHash("xyz", "md5")', expected: false },
  {
    covers: 'isMD5/1',
    source: 'isMD5("d41d8cd98f00b204e9800998ecf8427e")',
    expected: true,
  },
  {
    covers: 'isMD5/1',
    source: 'isMD5("d41d8cd98f00b204e9800998ecf8427")',
    expected: false,
  },
  { covers: 'isJSON/1', source: 'isJSON("{\\"a\\":1}")', expected: true },
  { covers: 'isJSON/1', source: 'isJSON("{a:1}")', expected: false },
  {
    covers: 'isJSON/2',
    source: 'isJSON("true", {allow_primitives: true})',
    expected: true,
  },
  {
    covers: 'isJSON/2',
    source: 'isJSON("true", {allow_primitives: false})',
    expected: false,
  },
  {
    covers: 'isJWT/1',
    source: 'isJWT("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature")',
    expected: true,
  },
  { covers: 'isJWT/1', source: 'isJWT("not.a")', expected: false },
  {
    covers: 'isDataURI/1',
    source: 'isDataURI("data:text/plain;base64,SGVsbG8=")',
    expected: true,
  },
  {
    covers: 'isDataURI/1',
    source: 'isDataURI("http://example.com")',
    expected: false,
  },
  {
    covers: 'isMagnetURI/1',
    source:
      'isMagnetURI("magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567")',
    expected: true,
  },
  {
    covers: 'isMagnetURI/1',
    source: 'isMagnetURI("magnet:?xt=urn:btih:zz")',
    expected: false,
  },
  {
    covers: 'isMimeType/1',
    source: 'isMimeType("text/plain")',
    expected: true,
  },
  {
    covers: 'isMimeType/1',
    source: 'isMimeType("textplain")',
    expected: false,
  },
  {
    covers: 'isMongoId/1',
    source: 'isMongoId("507f1f77bcf86cd799439011")',
    expected: true,
  },
  // An ObjectId is 24 hex characters; this one is 23.
  {
    covers: 'isMongoId/1',
    source: 'isMongoId("507f1f77bcf86cd79943901")',
    expected: false,
  },
  {
    covers: 'isULID/1',
    source: 'isULID("01ARZ3NDEKTSV4RRFFQ69G5FAV")',
    expected: true,
  },
  // A ULID is 26 Crockford characters; this one is 25.
  {
    covers: 'isULID/1',
    source: 'isULID("01ARZ3NDEKTSV4RRFFQ69G5FA")',
    expected: false,
  },
  {
    covers: 'isUUID/1',
    source: 'isUUID("9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d")',
    expected: true,
  },
  { covers: 'isUUID/1', source: 'isUUID("not-a-uuid")', expected: false },
  {
    covers: 'isUUID/2',
    source: 'isUUID("9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d", 1)',
    expected: false,
  },
  {
    covers: 'isUUID/2',
    source: 'isUUID("9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d", 4)',
    expected: true,
  },
  { covers: 'isSemVer/1', source: 'isSemVer("1.2.3")', expected: true },
  { covers: 'isSemVer/1', source: 'isSemVer("1.2")', expected: false },
  { covers: 'isBoolean/1', source: 'isBoolean("yes")', expected: false },
  { covers: 'isBoolean/1', source: 'isBoolean("true")', expected: true },
  {
    covers: 'isBoolean/2',
    source: 'isBoolean("yes", {loose: true})',
    expected: true,
  },
  {
    covers: 'isBoolean/2',
    source: 'isBoolean("maybe", {loose: true})',
    expected: false,
  },

  // Network and URI.
  { covers: 'isEmail/1', source: 'isEmail("ada@example.com")', expected: true },
  { covers: 'isEmail/1', source: 'isEmail(42)', expected: false },
  {
    covers: 'isEmail/2',
    source: 'isEmail("Ada <ada@example.com>", {allow_display_name: true})',
    expected: true,
  },
  {
    covers: 'isEmail/2',
    source: 'isEmail("Ada <ada@example.com>", {allow_display_name: false})',
    expected: false,
  },
  { covers: 'isURL/1', source: 'isURL("example.com")', expected: true },
  { covers: 'isURL/1', source: 'isURL("not a url")', expected: false },
  {
    covers: 'isURL/2',
    source: 'isURL("example.com", {require_protocol: true})',
    expected: false,
  },
  {
    covers: 'isURL/2',
    source: 'isURL("https://example.com", {require_protocol: true})',
    expected: true,
  },
  { covers: 'isFQDN/1', source: 'isFQDN("localhost")', expected: false },
  { covers: 'isFQDN/1', source: 'isFQDN("example.com")', expected: true },
  {
    covers: 'isFQDN/2',
    source: 'isFQDN("localhost", {require_tld: false})',
    expected: true,
  },
  {
    covers: 'isFQDN/2',
    source: 'isFQDN("localhost", {require_tld: true})',
    expected: false,
  },
  { covers: 'isIP/1', source: 'isIP("127.0.0.1")', expected: true },
  { covers: 'isIP/1', source: 'isIP("999.1.1.1")', expected: false },
  { covers: 'isIP/2', source: 'isIP("127.0.0.1", 6)', expected: false },
  { covers: 'isIP/2', source: 'isIP("::1", 6)', expected: true },
  {
    covers: 'isIPRange/1',
    source: 'isIPRange("192.168.0.0/24")',
    expected: true,
  },
  {
    covers: 'isIPRange/1',
    source: 'isIPRange("192.168.0.0")',
    expected: false,
  },
  {
    covers: 'isIPRange/2',
    source: 'isIPRange("192.168.0.0/24", 6)',
    expected: false,
  },
  { covers: 'isIPRange/2', source: 'isIPRange("::/0", 6)', expected: true },
  {
    covers: 'isMACAddress/1',
    source: 'isMACAddress("001B44113AB7")',
    expected: false,
  },
  {
    covers: 'isMACAddress/1',
    source: 'isMACAddress("00:1B:44:11:3A:B7")',
    expected: true,
  },
  {
    covers: 'isMACAddress/2',
    source: 'isMACAddress("001B44113AB7", {no_separators: true})',
    expected: true,
  },
  {
    covers: 'isMACAddress/2',
    source: 'isMACAddress("00:1B:44:11:3A:B7", {no_separators: true})',
    expected: false,
  },
  {
    covers: 'isMailtoURI/1',
    source: 'isMailtoURI("mailto:ada@example.com")',
    expected: true,
  },
  {
    covers: 'isMailtoURI/1',
    source: 'isMailtoURI("http://example.com")',
    expected: false,
  },
  {
    covers: 'isMailtoURI/2',
    source:
      'isMailtoURI("mailto:Ada <ada@example.com>", {allow_display_name: true})',
    expected: true,
  },
  {
    covers: 'isMailtoURI/2',
    source:
      'isMailtoURI("mailto:Ada <ada@example.com>", {allow_display_name: false})',
    expected: false,
  },
  {
    covers: 'isLatLong/1',
    source: 'isLatLong("37.7749,-122.4194")',
    expected: true,
  },
  { covers: 'isLatLong/1', source: 'isLatLong("100,200")', expected: false },
  // checkDMS switches to degrees/minutes/seconds, which decimal degrees fail.
  {
    covers: 'isLatLong/2',
    source: 'isLatLong("37.7749,-122.4194", {checkDMS: true})',
    expected: false,
  },
  {
    covers: 'isLatLong/2',
    source: 'isLatLong("40° 26′ 46″ N, 79° 58′ 56″ W", {checkDMS: true})',
    expected: true,
  },

  // Colors.
  { covers: 'isHexColor/1', source: 'isHexColor("ff00aa")', expected: true },
  { covers: 'isHexColor/1', source: 'isHexColor("zzz")', expected: false },
  {
    covers: 'isHexColor/2',
    source: 'isHexColor("ff00aa", {require_hashtag: true})',
    expected: false,
  },
  {
    covers: 'isHexColor/2',
    source: 'isHexColor("#ff00aa", {require_hashtag: true})',
    expected: true,
  },
  {
    covers: 'isRgbColor/1',
    source: 'isRgbColor("rgb(5%,5%,5%)")',
    expected: true,
  },
  {
    covers: 'isRgbColor/1',
    source: 'isRgbColor("hsl(1,2%,3%)")',
    expected: false,
  },
  {
    covers: 'isRgbColor/2',
    source: 'isRgbColor("rgb(5%,5%,5%)", {includePercentValues: false})',
    expected: false,
  },
  {
    covers: 'isRgbColor/2',
    source: 'isRgbColor("rgb(5,5,5)", {includePercentValues: false})',
    expected: true,
  },
  { covers: 'isHSL/1', source: 'isHSL("hsl(120, 100%, 50%)")', expected: true },
  { covers: 'isHSL/1', source: 'isHSL("rgb(1, 2, 3)")', expected: false },

  // Financial identifiers.
  {
    covers: 'isAbaRouting/1',
    source: 'isAbaRouting("021000021")',
    expected: true,
  },
  {
    covers: 'isAbaRouting/1',
    source: 'isAbaRouting("021000022")',
    expected: false,
  },
  { covers: 'isBIC/1', source: 'isBIC("DEUTDEFF")', expected: true },
  { covers: 'isBIC/1', source: 'isBIC("NOTABIC")', expected: false },
  {
    covers: 'isIBAN/1',
    source: 'isIBAN("GB82WEST12345698765432")',
    expected: true,
  },
  {
    covers: 'isIBAN/1',
    source: 'isIBAN("GB82WEST12345698765431")',
    expected: false,
  },
  {
    covers: 'isIBAN/2',
    source: 'isIBAN("GB82WEST12345698765432", {whitelist: ["DE"]})',
    expected: false,
  },
  {
    covers: 'isIBAN/2',
    source: 'isIBAN("GB82WEST12345698765432", {whitelist: ["GB"]})',
    expected: true,
  },
  {
    covers: 'isCreditCard/1',
    source: 'isCreditCard("4111111111111111")',
    expected: true,
  },
  {
    covers: 'isCreditCard/1',
    source: 'isCreditCard("4111111111111112")',
    expected: false,
  },
  {
    covers: 'isCreditCard/2',
    source: 'isCreditCard("4111111111111111", {provider: "mastercard"})',
    expected: false,
  },
  {
    covers: 'isCreditCard/2',
    source: 'isCreditCard("4111111111111111", {provider: "visa"})',
    expected: true,
  },
  { covers: 'isCurrency/1', source: 'isCurrency("1,234.56")', expected: true },
  { covers: 'isCurrency/1', source: 'isCurrency("abc")', expected: false },
  {
    covers: 'isCurrency/2',
    source: 'isCurrency("1,234.56", {require_symbol: true})',
    expected: false,
  },
  {
    covers: 'isCurrency/2',
    source: 'isCurrency("$1,234.56", {require_symbol: true})',
    expected: true,
  },
  {
    covers: 'isBtcAddress/1',
    source: 'isBtcAddress("1BoatSLRHtKNngkdXEeobR76b53LETtpyT")',
    expected: true,
  },
  {
    covers: 'isBtcAddress/1',
    source: 'isBtcAddress("notanaddress")',
    expected: false,
  },
  {
    covers: 'isEthereumAddress/1',
    source: 'isEthereumAddress("0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe")',
    expected: true,
  },
  // An address is 40 hex digits after the prefix.
  {
    covers: 'isEthereumAddress/1',
    source: 'isEthereumAddress("0x123")',
    expected: false,
  },
  { covers: 'isISIN/1', source: 'isISIN("US0378331005")', expected: true },
  { covers: 'isISIN/1', source: 'isISIN("US0378331006")', expected: false },
  { covers: 'isEAN/1', source: 'isEAN("4006381333931")', expected: true },
  { covers: 'isEAN/1', source: 'isEAN("4006381333930")', expected: false },
  { covers: 'isTaxID/1', source: 'isTaxID("123456789")', expected: true },
  { covers: 'isTaxID/1', source: 'isTaxID("12345678")', expected: false },
  {
    covers: 'isTaxID/2',
    source: 'isTaxID("123456789", "de-DE")',
    expected: false,
  },
  {
    covers: 'isTaxID/2',
    source: 'isTaxID("123456789", "en-US")',
    expected: true,
  },
  { covers: 'isVAT/2', source: 'isVAT("DE123456789", "DE")', expected: true },
  // A German VAT number carries nine digits.
  { covers: 'isVAT/2', source: 'isVAT("DE12345678", "DE")', expected: false },

  // Identity documents and serial numbers.
  {
    covers: 'isIdentityCard/2',
    source: 'isIdentityCard("12345678Z", "ES")',
    expected: true,
  },
  // The Spanish DNI letter is derived from the number, and Z is the one 12345678 gives.
  {
    covers: 'isIdentityCard/2',
    source: 'isIdentityCard("12345678A", "ES")',
    expected: false,
  },
  // The French passport format is two digits, two letters, five digits.
  {
    covers: 'isPassportNumber/2',
    source: 'isPassportNumber("12AB34567", "FR")',
    expected: true,
  },
  {
    covers: 'isPassportNumber/2',
    source: 'isPassportNumber("!!!", "FR")',
    expected: false,
  },
  // Brazil's Mercosul plate interleaves a letter into the numeric block.
  {
    covers: 'isLicensePlate/2',
    source: 'isLicensePlate("ABC1D23", "pt-BR")',
    expected: true,
  },
  {
    covers: 'isLicensePlate/2',
    source: 'isLicensePlate("!!!", "pt-BR")',
    expected: false,
  },
  { covers: 'isIMEI/1', source: 'isIMEI("490154203237518")', expected: true },
  { covers: 'isIMEI/1', source: 'isIMEI("490154203237519")', expected: false },
  {
    covers: 'isIMEI/2',
    source: 'isIMEI("49-015420-323751-8", {allow_hyphens: true})',
    expected: true,
  },
  {
    covers: 'isIMEI/2',
    source: 'isIMEI("49-015420-323751-8", {allow_hyphens: false})',
    expected: false,
  },
  { covers: 'isISBN/1', source: 'isISBN("978-0-306-40615-7")', expected: true },
  {
    covers: 'isISBN/1',
    source: 'isISBN("978-0-306-40615-8")',
    expected: false,
  },
  {
    covers: 'isISBN/2',
    source: 'isISBN("978-0-306-40615-7", 10)',
    expected: false,
  },
  { covers: 'isISBN/2', source: 'isISBN("0-306-40615-2", 10)', expected: true },
  { covers: 'isISSN/1', source: 'isISSN("03785955")', expected: true },
  { covers: 'isISSN/1', source: 'isISSN("03785956")', expected: false },
  {
    covers: 'isISSN/2',
    source: 'isISSN("03785955", {require_hyphen: true})',
    expected: false,
  },
  {
    covers: 'isISSN/2',
    source: 'isISSN("0378-5955", {require_hyphen: true})',
    expected: true,
  },
  { covers: 'isISRC/1', source: 'isISRC("USRC17607839")', expected: true },
  // An ISRC is 12 characters; this one is 11.
  { covers: 'isISRC/1', source: 'isISRC("USRC1760783")', expected: false },
  {
    covers: 'isFreightContainerID/1',
    source: 'isFreightContainerID("CSQU3054383")',
    expected: true,
  },
  {
    covers: 'isFreightContainerID/1',
    source: 'isFreightContainerID("CSQU3054384")',
    expected: false,
  },
  { covers: 'isISO6346/1', source: 'isISO6346("CSQU3054383")', expected: true },
  {
    covers: 'isISO6346/1',
    source: 'isISO6346("CSQU3054384")',
    expected: false,
  },

  // ISO codes, locales and locale-parameterized formats.
  { covers: 'isISO15924/1', source: 'isISO15924("Latn")', expected: true },
  // Script codes are four letters.
  { covers: 'isISO15924/1', source: 'isISO15924("Lat")', expected: false },
  {
    covers: 'isISO31661Alpha2/1',
    source: 'isISO31661Alpha2("XX")',
    expected: false,
  },
  {
    covers: 'isISO31661Alpha2/1',
    source: 'isISO31661Alpha2("US")',
    expected: true,
  },
  {
    covers: 'isISO31661Alpha2/2',
    source: 'isISO31661Alpha2("XX", {userAssignedCodes: ["XX"]})',
    expected: true,
  },
  {
    covers: 'isISO31661Alpha2/2',
    source: 'isISO31661Alpha2("XY", {userAssignedCodes: ["XX"]})',
    expected: false,
  },
  {
    covers: 'isISO31661Alpha3/1',
    source: 'isISO31661Alpha3("XXX")',
    expected: false,
  },
  {
    covers: 'isISO31661Alpha3/1',
    source: 'isISO31661Alpha3("USA")',
    expected: true,
  },
  {
    covers: 'isISO31661Alpha3/2',
    source: 'isISO31661Alpha3("XXX", {userAssignedCodes: ["XXX"]})',
    expected: true,
  },
  {
    covers: 'isISO31661Alpha3/2',
    source: 'isISO31661Alpha3("XXY", {userAssignedCodes: ["XXX"]})',
    expected: false,
  },
  {
    covers: 'isISO31661Numeric/1',
    source: 'isISO31661Numeric("840")',
    expected: true,
  },
  // 999 is unassigned.
  {
    covers: 'isISO31661Numeric/1',
    source: 'isISO31661Numeric("999")',
    expected: false,
  },
  { covers: 'isISO4217/1', source: 'isISO4217("USD")', expected: true },
  { covers: 'isISO4217/1', source: 'isISO4217("XXY")', expected: false },
  { covers: 'isISO6391/1', source: 'isISO6391("en")', expected: true },
  { covers: 'isISO6391/1', source: 'isISO6391("zz")', expected: false },
  { covers: 'isLocale/1', source: 'isLocale("en-US")', expected: true },
  { covers: 'isLocale/1', source: 'isLocale("!!")', expected: false },
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
    covers: 'isMobilePhone/1',
    source: 'isMobilePhone("12345")',
    expected: false,
  },
  {
    covers: 'isMobilePhone/2',
    source: 'isMobilePhone("+14155552671", "de-DE")',
    expected: false,
  },
  {
    covers: 'isMobilePhone/2',
    source: 'isMobilePhone("+14155552671", "en-US")',
    expected: true,
  },
  // Strict mode requires the number to carry its own country code.
  {
    covers: 'isMobilePhone/3',
    source: 'isMobilePhone("4155552671", "en-US", {strictMode: true})',
    expected: false,
  },
  {
    covers: 'isMobilePhone/3',
    source: 'isMobilePhone("+14155552671", "en-US", {strictMode: true})',
    expected: true,
  },

  // Dates and times. The comparison date rides in an options object, and with
  // none supplied isAfter/isBefore compare against the moment they run.
  {
    covers: 'isAfter/1',
    source: 'isAfter("2200-01-01")',
    expected: true,
  },
  { covers: 'isAfter/1', source: 'isAfter("1900-01-01")', expected: false },
  {
    covers: 'isAfter/2',
    source: 'isAfter("1900-01-02", {comparisonDate: "1900-01-01"})',
    expected: true,
  },
  {
    covers: 'isAfter/2',
    source: 'isAfter("1900-01-01", {comparisonDate: "1900-01-02"})',
    expected: false,
  },
  {
    covers: 'isBefore/1',
    source: 'isBefore("1900-01-01")',
    expected: true,
  },
  { covers: 'isBefore/1', source: 'isBefore("2200-01-01")', expected: false },
  {
    covers: 'isBefore/2',
    source: 'isBefore("2200-01-02", {comparisonDate: "2200-01-03"})',
    expected: true,
  },
  {
    covers: 'isBefore/2',
    source: 'isBefore("2200-01-03", {comparisonDate: "2200-01-02"})',
    expected: false,
  },
  {
    covers: 'isDate/1',
    source: 'isDate("10-05-2026")',
    expected: false,
  },
  { covers: 'isDate/1', source: 'isDate("2026-05-10")', expected: true },
  {
    covers: 'isDate/2',
    source: 'isDate("10-05-2026", {format: "DD-MM-YYYY"})',
    expected: true,
  },
  {
    covers: 'isDate/2',
    source: 'isDate("2026-05-10", {format: "DD-MM-YYYY"})',
    expected: false,
  },
  // Without strict mode isISO8601 checks only the shape, so February 30 passes.
  {
    covers: 'isISO8601/1',
    source: 'isISO8601("2026-02-30")',
    expected: true,
  },
  { covers: 'isISO8601/1', source: 'isISO8601("not a date")', expected: false },
  {
    covers: 'isISO8601/2',
    source: 'isISO8601("2026-02-30", {strict: true})',
    expected: false,
  },
  {
    covers: 'isISO8601/2',
    source: 'isISO8601("2026-02-28", {strict: true})',
    expected: true,
  },
  {
    covers: 'isRFC3339/1',
    source: 'isRFC3339("2026-05-10T12:34:56Z")',
    expected: true,
  },
  // RFC 3339 requires the T separator.
  {
    covers: 'isRFC3339/1',
    source: 'isRFC3339("2026-05-10 12:34:56")',
    expected: false,
  },
  {
    covers: 'isTime/1',
    source: 'isTime("11:59 PM")',
    expected: false,
  },
  { covers: 'isTime/1', source: 'isTime("23:59")', expected: true },
  {
    covers: 'isTime/2',
    source: 'isTime("11:59 PM", {hourFormat: "hour12"})',
    expected: true,
  },
  {
    covers: 'isTime/2',
    source: 'isTime("23:59", {hourFormat: "hour12"})',
    expected: false,
  },
];
