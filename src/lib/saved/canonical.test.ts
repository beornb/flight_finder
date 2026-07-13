import { describe, expect, it } from "vitest";
import { stableStringify } from "./canonical";

describe("stableStringify", () => {
  it("produces the same string regardless of key order", () => {
    const a = { origin: "VIE", directOnly: true, adults: 1 };
    const b = { adults: 1, origin: "VIE", directOnly: true };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it("handles nested objects, arrays, and drops undefined values", () => {
    const value = { b: [{ y: 2, x: 1 }], a: "text", skip: undefined };
    expect(stableStringify(value)).toBe('{"a":"text","b":[{"x":1,"y":2}]}');
  });
});
