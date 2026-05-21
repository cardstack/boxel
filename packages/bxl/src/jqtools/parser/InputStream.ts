import { JqParseError } from '../errors.js';

export class InputStream {
  private state = {
    pos: 0,
    line: 1,
    col: 0,
    lineStart: 0,
  };
  private prev = {
    pos: 0,
    line: 1,
    col: 0,
    lineStart: 0,
  };

  constructor(private input: string) {}

  next() {
    const ch = this.input.charAt(this.state.pos++);
    if (ch == '\n') {
      this.state.line++;
      this.state.col = 0;
      this.state.lineStart = this.state.pos;
    } else {
      this.state.col++;
    }

    return ch;
  }

  peek(offset: number = 0) {
    return this.input.charAt(this.state.pos + offset);
  }

  eof() {
    return this.peek() == '';
  }

  croak(msg: string) {
    return new JqParseError(
      `${msg} (${this.state.line}:${
        this.state.col
      })\n\n${this.getLine()}\n${this.getErrorPointer()}`
    );
  }

  snapshot() {
    this.prev = { ...this.state };
  }

  restore() {
    this.state = { ...this.prev };
  }

  private getLine() {
    let i = 0;
    while (!['\n', ''].includes(this.input.charAt(this.state.pos + i))) {
      i++;
    }
    return this.input.substring(this.state.lineStart, this.state.pos + i);
  }

  private getErrorPointer() {
    let out = '';
    for (let i = 0; i < this.state.col; i++) {
      out += '-';
    }
    out += '^';
    return out;
  }
}
