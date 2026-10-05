import { describe, expect, it } from "vitest";
import { canonicalMetaTimezone } from "./meta-timezone";

describe("Meta reporting zones", () => {
  it("recognizes the Brazil/East alias without accepting a different Brazilian zone", () => {
    expect(canonicalMetaTimezone("Brazil/East")).toBe(canonicalMetaTimezone("America/Sao_Paulo"));
    expect(canonicalMetaTimezone("America/Manaus")).not.toBe(canonicalMetaTimezone("America/Sao_Paulo"));
  });
  it("does not silently replace unknown or absent zones with the server's local zone", () => {
    for (const zone of [null, undefined, "", "Unknown/Zone"]) {
      expect(canonicalMetaTimezone(zone)).toBeNull();
    }
  });
});
