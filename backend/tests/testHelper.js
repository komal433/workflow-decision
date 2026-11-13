import { describe, it, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Idiomatic expect helper for clean, readable BDD assertions
 */
export function expect(actual) {
  return {
    toBe(expected) {
      assert.strictEqual(actual, expected);
    },
    toEqual(expected) {
      assert.deepStrictEqual(actual, expected);
    },
    toHaveLength(len) {
      assert.strictEqual(actual?.length, len);
    },
    toBeGreaterThan(num) {
      assert.ok(actual > num, `Expected ${actual} > ${num}`);
    },
    toBeGreaterThanOrEqual(num) {
      assert.ok(actual >= num, `Expected ${actual} >= ${num}`);
    },
    toBeLessThan(num) {
      assert.ok(actual < num, `Expected ${actual} < ${num}`);
    },
    toBeLessThanOrEqual(num) {
      assert.ok(actual <= num, `Expected ${actual} <= ${num}`);
    },
    toContain(item) {
      if (typeof actual === 'string') {
        assert.ok(actual.includes(item), `Expected string "${actual}" to contain "${item}"`);
      } else if (Array.isArray(actual)) {
        assert.ok(actual.includes(item), `Expected array to contain ${JSON.stringify(item)}`);
      } else {
        throw new Error(`toContain called on non-string, non-array: ${actual}`);
      }
    },
    toBeNull() {
      assert.strictEqual(actual, null);
    },
    toBeUndefined() {
      assert.strictEqual(actual, undefined);
    },
    toBeTruthy() {
      assert.ok(!!actual, `Expected truthy, got ${actual}`);
    },
    toBeFalsy() {
      assert.ok(!actual, `Expected falsy, got ${actual}`);
    },
    toThrow(expectedError) {
      assert.throws(actual, expectedError);
    }
  };
}

export { describe, it, test, before, after, beforeEach, afterEach, assert };

