import { InputStream } from './InputStream.js';

export interface PuncToken {
  type: 'punc';
  value: string;
}

export interface OpToken {
  type: 'op';
  value: string;
}

export interface IdentToken {
  type: 'ident';
  value: string;
}

export interface KwToken {
  type: 'kw';
  value: string;
}

export interface FormatToken {
  type: 'format';
  value: string;
}

export interface VarToken {
  type: 'var';
  value: string;
}

export interface StrToken {
  type: 'str';
  value: string;
}

export interface NullToken {
  type: 'null';
  value: null;
}

export interface BoolToken {
  type: 'bool';
  value: boolean;
}

export interface NumToken {
  type: 'num';
  value: number;
}

type AnyToken =
  | PuncToken
  | OpToken
  | IdentToken
  | KwToken
  | FormatToken
  | VarToken
  | StrToken
  | NullToken
  | BoolToken
  | NumToken;
export type TokenType = AnyToken['type'];
export type Token<Type extends TokenType = TokenType> = Extract<
  AnyToken,
  {
    type: Type;
  }
>;

export class Tokenizer {
  private current: Token | null = null;
  private consumed: Token[] = [];
  lastErrorPhase: 'tokenize' | 'parse' = 'parse';
  private static tokenTypeToString = {
    punc: 'punctuation',
    op: 'operator',
    ident: 'identifier',
    kw: 'keyword',
    format: 'format',
    var: 'variable',
    str: 'string',
    null: 'null',
    bool: 'boolean',
    num: 'number',
  };
  private static escapeCharacters = {
    b: '\b',
    f: '\f',
    n: '\n',
    r: '\r',
    t: '\t',
    v: '\v',
    "'": "'",
    '"': '"',
    '\\': '\\',
  };
  private static keywords = new Set([
    '__loc__',
    'and',
    'as',
    'break',
    'catch',
    'def',
    'elif',
    'else',
    'end',
    'foreach',
    'if',
    'import',
    'include',
    'label',
    'module',
    'modulemeta',
    'not',
    'or',
    'reduce',
    'then',
    'try',
  ]);

  private static operators = new Set([
    '!=',
    '%',
    '%=',
    '*',
    '*=',
    '+',
    '+=',
    ',',
    '-',
    '-=',
    '.',
    '..',
    '/',
    '//',
    '//=',
    '/=',
    '<',
    '<=',
    '=',
    '==',
    '>',
    '>=',
    '?',
    '?//',
    '|',
    '|=',
  ]);

  private interpolationContexts: number[] = [];

  constructor(
    private input: InputStream,
    private readonly recordConsumedTokens = false,
  ) {}

  next() {
    const tok = this.current;
    this.current = null;
    const next = tok || this.readNext();
    if (next && this.recordConsumedTokens) {
      this.consumed.push(next);
    }
    return next;
  }

  peek() {
    return this.current || (this.current = this.readNext());
  }

  eof() {
    return this.peek() === null;
  }

  croak(msg: string, phase: 'tokenize' | 'parse' = 'parse') {
    this.lastErrorPhase = phase;
    this.input.restore();
    return this.input.croak(msg);
  }

  consumedTokens(): Token[] {
    return this.consumed.slice();
  }

  toArray(): Token[] {
    const out: Token[] = [];
    while (!this.eof()) {
      out.push(this.next()!);
    }
    return out;
  }

  private readNext(): Token | null {
    if (this.interpolationContextJustExited()) {
      this.input.snapshot();
      this.interpolationContexts.pop();
      return this.readString();
    }

    this.readWhile(Tokenizer.isWhitespace);
    this.input.snapshot();
    if (this.input.eof()) return null;
    const c = this.input.peek();

    if (c === '#') {
      this.skipComment();
      return this.readNext();
    }

    if (Tokenizer.isDigit(c)) {
      return this.readNumber();
    }
    if (c == '"') {
      this.input.next();
      return this.readString();
    }
    if (Tokenizer.isIdentStart(c)) {
      return this.readIdent();
    }
    if (Tokenizer.isPuncChar(c)) {
      return this.readPunc();
    }

    if (Tokenizer.isOpChar(c)) {
      return this.readOp();
    }

    throw this.croak(`Can't handle character: ${c}`, 'tokenize');
  }

  private readWhile(predicate: (c: string) => boolean) {
    let out = '';
    while (!this.input.eof() && predicate(this.input.peek())) {
      out += this.input.next();
    }
    return out;
  }

  private skipComment(): void {
    this.readWhile((c) => c !== '\n');
  }

  private readIdent(): Token {
    const ident = this.readWhile(Tokenizer.isIdentChar);

    if (ident === 'null') {
      return { type: 'null', value: null };
    }
    if (ident === 'true') return { type: 'bool', value: true };
    if (ident === 'false') return { type: 'bool', value: false };

    return {
      type: Tokenizer.keywords.has(ident)
        ? 'kw'
        : ident.charAt(0) === '@'
        ? 'format'
        : ident.charAt(0) === '$'
        ? 'var'
        : 'ident',
      value: ident,
    };
  }

  private interpolationContextJustExited() {
    return (
      this.interpolationContexts[this.interpolationContexts.length - 1] === 0
    );
  }

  private updateInterpolationContext(c: string) {
    const len = this.interpolationContexts.length;
    if (len === 0) return;
    if (c === '(') {
      this.interpolationContexts[len - 1]++;
    } else if (c === ')') {
      this.interpolationContexts[len - 1]--;
    }
  }

  private readPunc(): Token {
    let value = this.input.next();
    if (value == '\\') {
      if (this.input.peek() !== '(')
        throw this.croak(
          `Can't handle character: ${this.input.peek()}`,
          'tokenize'
        );
      value += this.input.next();
      this.interpolationContexts.push(1);
    } else {
      this.updateInterpolationContext(value);
    }

    return { type: 'punc', value };
  }

  private readOp(): Token {
    let value = this.input.next();

    if (
      Tokenizer.operators.has(value + this.input.peek() + this.input.peek(1))
    ) {
      value += this.input.next() + this.input.next();
    } else if (Tokenizer.operators.has(value + this.input.peek())) {
      value += this.input.next();
    }

    return {
      type: 'op',
      value: value,
    };
  }

  private readString(): Token {
    let escaped = false;
    let str = '';
    while (!this.input.eof()) {
      if (this.input.peek() == '\\' && this.input.peek(1) === '(') {
        break;
      }

      const c = this.input.next();
      if (escaped) {
        str += this.getEscaped(c);
        escaped = false;
      } else if (c == '\\') {
        escaped = true;
      } else if (c == '"') {
        break;
      } else {
        str += c;
      }
    }

    return {
      type: 'str',
      value: str,
    };
  }

  private readNumber(): Token {
    let hasDot = false;
    return {
      type: 'num',
      value: Number(
        this.readWhile((c) => {
          if (c === '.') {
            if (hasDot) return false;
            hasDot = true;
            return true;
          }

          return Tokenizer.isDigit(c);
        })
      ),
    };
  }

  private static isWhitespace(c: string) {
    return ' \t\n'.indexOf(c) >= 0;
  }

  private static isOpChar(c: string) {
    return '.=!|+-*/%?<>,'.indexOf(c) >= 0;
  }

  private static isPuncChar(c: string) {
    return '()[]{}:;\\'.indexOf(c) >= 0;
  }

  private static isDigit(c: string) {
    return /[0-9]/.test(c);
  }

  private static isIdentStart(c: string) {
    return /[a-zA-Z@$_]/.test(c);
  }

  private static isIdentChar(c: string) {
    return Tokenizer.isIdentStart(c) || /[0-9]/.test(c);
  }

  private getEscaped(c: string) {
    const key = c as keyof typeof Tokenizer.escapeCharacters;
    if (!Tokenizer.escapeCharacters[key])
      throw this.croak(`Can't parse an escape character: ${c}`, 'tokenize');
    return Tokenizer.escapeCharacters[key];
  }

  static stringifyTokenType(tokenType: TokenType) {
    return this.tokenTypeToString[tokenType];
  }

  static stringifyToken(token: Token | null): string {
    if (token === null) return 'EOF';
    if (['null', 'bool', 'value'].includes(token.type)) {
      return `${this.tokenTypeToString[token.type]}: ${token.value}`;
    }
    return `${this.tokenTypeToString[token.type]}: "${token.value}"`;
  }
}
