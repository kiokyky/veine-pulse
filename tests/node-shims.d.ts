declare module 'node:assert/strict' {
  export function strictEqual<T>(actual: T, expected: T, message?: string): void;
  export function notStrictEqual<T>(actual: T, expected: T, message?: string): void;
  export function deepStrictEqual<T>(actual: T, expected: T, message?: string): void;
  export function equal<T>(actual: T, expected: T, message?: string): void;
  export function notEqual<T>(actual: T, expected: T, message?: string): void;
  export function deepEqual<T>(actual: T, expected: T, message?: string): void;
  export function match(value: string, regexp: RegExp, message?: string): void;
  export function throws(block: () => unknown, error?: unknown): void;
  export function rejects(
    block: Promise<unknown> | (() => Promise<unknown>),
    error?: (err: Error) => boolean
  ): Promise<void>;
  export function ok(value: unknown, message?: string): asserts value;
}

declare module 'node:test' {
  export default function test(name: string, fn: () => void | Promise<void>): void;
}

declare module 'node:crypto' {
  export function randomBytes(size: number): Uint8Array & { toString(encoding: 'hex'): string };
}
