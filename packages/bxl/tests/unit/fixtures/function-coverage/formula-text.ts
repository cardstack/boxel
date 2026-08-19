import type { CoverageCase } from './case.ts';

export const formulaTextCases: CoverageCase[] = [
  // Character codes. CHAR maps a single-byte code back to its character,
  // while UNICODE reads a whole code point — an astral character is two
  // UTF-16 units long but reports the code point, not the lead surrogate.
  { covers: 'CHAR/1', source: 'CHAR(65)', expected: 'A' },
  // 255 is the top of that byte, so anything above it is out of range rather
  // than the Unicode code point of the same number.
  { covers: 'CHAR/1', source: 'CHAR(256)', throws: /#VALUE!/ },
  { covers: 'CODE/1', source: 'CODE("A")', expected: 65 },
  { covers: 'UNICODE/1', source: 'UNICODE(.)', input: '😀', expected: 128512 },
  {
    covers: 'CLEAN/1',
    source: 'CLEAN(.)',
    input: '\u0007monthly report\u0007',
    expected: 'monthly report',
  },
  // Case, shape and length.
  { covers: 'UPPER/1', source: 'UPPER("yield")', expected: 'YIELD' },
  {
    covers: 'LOWER/1',
    source: 'LOWER("E. E. Cummings")',
    expected: 'e. e. cummings',
  },
  {
    covers: 'PROPER/1',
    source: 'PROPER("this is a TITLE")',
    expected: 'This Is A Title',
  },
  // Excel uppercases every letter that follows a non-letter, so the `w`
  // after the hyphen becomes `W`.
  {
    covers: 'PROPER/1',
    source: 'PROPER("2-way street")',
    expected: '2-Way Street',
  },
  // TRIM collapses runs of spaces between words as well as stripping the
  // ends, which a plain JavaScript trim does not do.
  {
    covers: 'TRIM/1',
    source: 'TRIM("  Acme   Legal  ")',
    expected: 'Acme Legal',
  },
  // TRIM is defined over the 7-bit ASCII space alone, so the non-breaking
  // space (U+00A0) survives it — removing that one is SUBSTITUTE's job.
  {
    covers: 'TRIM/1',
    source: 'TRIM(.)',
    input: 'Acme\u00a0Legal',
    expected: 'Acme\u00a0Legal',
  },
  { covers: 'LEN/1', source: 'LEN("Phoenix, AZ")', expected: 11 },
  { covers: 'REPT/2', source: 'REPT("*-", 3)', expected: '*-*-*-' },
  { covers: 'T/1', source: 'T("Rainfall")', expected: 'Rainfall' },
  { covers: 'T/1', source: 'T(19.5)', expected: '' },
  // Extraction. The one-argument arities take a single character.
  { covers: 'LEFT/1', source: 'LEFT("Sale Price")', expected: 'S' },
  { covers: 'LEFT/2', source: 'LEFT("Sale Price", 4)', expected: 'Sale' },
  { covers: 'RIGHT/1', source: 'RIGHT("Sale Price")', expected: 'e' },
  { covers: 'RIGHT/2', source: 'RIGHT("Sale Price", 5)', expected: 'Price' },
  // A count past the end of the string yields what is there, not an error.
  { covers: 'MID/3', source: 'MID("Fluid Flow", 7, 20)', expected: 'Flow' },
  // Position. FIND and SEARCH read the same arguments differently: FIND is
  // case-sensitive and skips the leading capital, SEARCH is not and stops
  // there. Both count from 1, and the start argument is itself 1-based.
  { covers: 'FIND/2', source: 'FIND("m", "Miriam McGovern")', expected: 6 },
  { covers: 'FIND/3', source: 'FIND("M", "Miriam McGovern", 3)', expected: 8 },
  { covers: 'SEARCH/2', source: 'SEARCH("m", "Miriam McGovern")', expected: 1 },
  {
    covers: 'SEARCH/3',
    source: 'SEARCH("m", "Miriam McGovern", 3)',
    expected: 6,
  },
  // SEARCH's find_text takes wildcards — `*` for any run of characters,
  // `?` for one — which is the other half of what separates it from FIND.
  {
    covers: 'SEARCH/2',
    source: 'SEARCH("Mc*n", "Miriam McGovern")',
    expected: 8,
  },
  // `?` stands for exactly one character, and `~` makes a wildcard literal.
  {
    covers: 'SEARCH/3',
    source: 'SEARCH("M?G", "Miriam McGovern", 3)',
    expected: 8,
  },
  { covers: 'SEARCH/2', source: 'SEARCH("~*", "3 * 4")', expected: 3 },
  // A start position past the end of the text is an error, even for a pattern
  // that can match nothing.
  { covers: 'SEARCH/3', source: 'SEARCH("*", "abc", 5)', throws: /#VALUE!/ },
  // Stars are matched by walking the text once, not by a backtracking regex, so
  // a pattern full of them answers in linear time instead of exponential.
  {
    covers: 'SEARCH/2',
    source:
      'SEARCH("*a*a*a*a*a*a*a*a*b", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")',
    throws: /#VALUE!/,
  },
  { covers: 'EXACT/2', source: 'EXACT("Word", "word")', expected: false },
  { covers: 'EXACT/2', source: 'EXACT("word", "word")', expected: true },
  // Substitution. SUBSTITUTE matches text, REPLACE matches a position span,
  // and REPLACE's new text comes last, after the start and length.
  {
    covers: 'SUBSTITUTE/3',
    source: 'SUBSTITUTE("a-a-a", "a", "b")',
    expected: 'b-b-b',
  },
  {
    covers: 'SUBSTITUTE/4',
    source: 'SUBSTITUTE("Quarter 1, 2011", "1", "2", 3)',
    expected: 'Quarter 1, 2012',
  },
  // Instance 1 is the first occurrence wherever it sits, including the very
  // start of the string.
  {
    covers: 'SUBSTITUTE/4',
    source: 'SUBSTITUTE("a-a-a", "a", "b", 1)',
    expected: 'b-a-a',
  },
  // Occurrences do not overlap: "aaa" holds one "aa", not two, so there is no
  // second instance to replace and the text comes back whole.
  {
    covers: 'SUBSTITUTE/4',
    source: 'SUBSTITUTE("aaa", "aa", "X", 2)',
    expected: 'aaa',
  },
  {
    covers: 'REPLACE/4',
    source: 'REPLACE("abcdefghijk", 6, 5, "*")',
    expected: 'abcde*k',
  },
  // Joining. CONCAT and CONCATENATE take one list; TEXTJOIN takes the
  // delimiter and an ignore-empty flag ahead of its list.
  {
    covers: 'CONCAT/1',
    source: 'CONCAT(["INV-", 1001])',
    expected: 'INV-1001',
  },
  {
    covers: 'CONCATENATE/1',
    source: 'CONCATENATE(["A", "B", "C"])',
    expected: 'ABC',
  },
  {
    covers: 'TEXTJOIN/3',
    source: 'TEXTJOIN(", ", true, ["A", "", "B"])',
    expected: 'A, B',
  },
  // Number formatting.
  {
    covers: 'TEXT/2',
    source: 'TEXT(1234.567, "$#,##0.00")',
    expected: '$1,234.57',
  },
  // A date format code renders the serial as a calendar date. Zone-pinned
  // because the answer must not depend on where the expression runs.
  {
    covers: 'TEXT/2',
    source: 'TEXT(DATE(2026, 4, 30), "yyyy-mm-dd")',
    expected: '2026-04-30',
  },
  // Month and weekday names come from the run length: three letters abbreviate,
  // four or more spell it out.
  {
    covers: 'TEXT/2',
    source: 'TEXT(DATE(2026, 4, 30), "dddd d mmm yy")',
    expected: 'Thursday 30 Apr 26',
  },
  // Five m's is the single-letter month, one more than the full name.
  {
    covers: 'TEXT/2',
    source: 'TEXT(DATE(2026, 4, 30), "mmmmm")',
    expected: 'A',
  },
  // `mm` is minutes next to an hour or a second, and months anywhere else, so
  // one format code carries both readings.
  {
    covers: 'TEXT/2',
    source: 'TEXT(DATE(2026, 4, 30) + TIME(14, 5, 9), "mm/dd h:mm:ss AM/PM")',
    expected: '04/30 2:05:09 PM',
  },
  // Minutes only where the clock puts them — after an hour, or before seconds.
  // A month run that merely precedes an hour is still a month.
  {
    covers: 'TEXT/2',
    source: 'TEXT(DATE(2026, 4, 30) + TIME(14, 5, 9), "d mmm h:mm")',
    expected: '30 Apr 14:05',
  },
  {
    covers: 'TEXT/2',
    source: 'TEXT(DATE(2026, 4, 30) + TIME(14, 5, 9), "mm hh")',
    expected: '04 14',
  },
  // A bracketed run is a colour, a condition or a locale, so a `d` inside one
  // does not make a number format a date format.
  {
    covers: 'TEXT/2',
    source: 'TEXT(1234.5, "[Red]#,##0.0")',
    expected: '1,234.5',
  },
  {
    covers: 'TEXT/2',
    source: 'TEXT(DATE(2026, 4, 30), "[$-409]yyyy-mm-dd")',
    expected: '2026-04-30',
  },
  // The bracketed clock codes are the exception: they ask for elapsed time, so
  // a day and a half is 36 hours and the minutes beside them are the clock's.
  {
    covers: 'TEXT/2',
    source: 'TEXT(1.5, "[h]:mm")',
    expected: '36:00',
  },
  {
    covers: 'TEXT/2',
    source: 'TEXT(1.5, "[mm]")',
    expected: '2160',
  },
  // A time of day below the 1970 epoch reads the same as one above it: the
  // serial is a fraction that lands a hair under the second it names, and
  // truncating it would drop that second on one side of the epoch only.
  {
    covers: 'TEXT/2',
    source: 'TEXT(TIME(12, 30, 0), "hh:mm:ss")',
    expected: '12:30:00',
  },
  {
    covers: 'TEXT/2',
    source: 'TEXT(DATE(2023, 1, 1) + TIME(12, 30, 0), "hh:mm:ss")',
    expected: '12:30:00',
  },
  { covers: 'FIXED/1', source: 'FIXED(1234.567)', expected: '1,234.57' },
  // Negative decimals round to the left of the point.
  { covers: 'FIXED/2', source: 'FIXED(1234.567, -1)', expected: '1,230' },
  { covers: 'FIXED/3', source: 'FIXED(1234.567, 1, true)', expected: '1234.6' },
  // DOLLAR parenthesizes negatives rather than signing them.
  { covers: 'DOLLAR/1', source: 'DOLLAR(-1234.567)', expected: '($1,234.57)' },
  { covers: 'DOLLAR/2', source: 'DOLLAR(1234.567, -2)', expected: '$1,200' },
  // Text to number. VALUE reads the ambient format; NUMBERVALUE is told
  // which separators to expect, decimal first, then group.
  { covers: 'VALUE/1', source: 'VALUE("$1,000")', expected: 1000 },
  { covers: 'NUMBERVALUE/1', source: 'NUMBERVALUE("2.5")', expected: 2.5 },
  // A trailing percent sign divides the result by 100.
  {
    covers: 'NUMBERVALUE/1',
    source: 'NUMBERVALUE("3.5%")',
    expected: 0.035,
  },
  // Percent signs stack, and spaces are ignored wherever they fall.
  { covers: 'NUMBERVALUE/1', source: 'NUMBERVALUE("9%%")', expected: 0.0009 },
  {
    covers: 'NUMBERVALUE/1',
    source: 'NUMBERVALUE(" 3 500 ")',
    expected: 3500,
  },
  {
    covers: 'NUMBERVALUE/2',
    source: 'NUMBERVALUE("4:25", ":")',
    expected: 4.25,
  },
  {
    covers: 'NUMBERVALUE/3',
    source: 'NUMBERVALUE("2.500,27", ",", ".")',
    expected: 2500.27,
  },
  // BXL's own helpers, in SQL rather than Excel terms: `%` spans any run of
  // characters and `_` one, and a pattern without either is an exact match.
  { covers: 'like/2', source: 'like("Alice", "A_i%")', expected: true },
  { covers: 'like/2', source: 'like("Alice", "Ali")', expected: false },
  { covers: 'words/1', source: 'words("Grace  Lin")', expected: 2 },
];
