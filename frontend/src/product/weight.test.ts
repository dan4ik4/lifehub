import { describe, it, expect } from "vitest";
import { displayWeight, storeWeight } from "./weight";
describe("weight units", () => {
  it("converts pounds without changing canonical kilograms", () => {
    expect(displayWeight(100, "lb")).toBeCloseTo(220.462262, 5);
    expect(storeWeight("220.462", "lb")).toBe("100.000");
    expect(storeWeight("72.125", "kg")).toBe("72.125");
  });
});
