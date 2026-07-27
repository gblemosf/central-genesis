import { describe, expect, it } from "vitest";
import { dateInTimezone, subtractCalendarDays } from "@/lib/dates";

describe("reporting dates", () => {
  it("uses the Genesis timezone at UTC month boundaries", () => {
    expect(dateInTimezone(new Date("2026-08-01T01:00:00Z"))).toBe("2026-07-31");
  });

  it("subtracts calendar days without timezone drift", () => {
    expect(subtractCalendarDays("2026-03-01", 1)).toBe("2026-02-28");
  });
});
