"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.expect = void 0;
function expect(value, message) {
    if (value === undefined || value === null) {
        throw new Error(`LIBRARY BUG: ${message}`);
    }
    return value;
}
exports.expect = expect;
