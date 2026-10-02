import { describe, expect, it } from "vitest";
import { buildSetupGuide, type SetupSnapshot } from "./setup-guide";
import { databaseRequirements, isBaseAvailable } from "./configuration-catalog";
import { demoConnections, demoProjects } from "./demo-data";

const snapshot: SetupSnapshot = {
  databaseConfigured: true, serverConfigured: true, googleConfigured: true, demoMode: false,
  checks: databaseRequirements.map((item) => ({ ...item, ready: true, error: "" })),
  connections: [], projects: [],
};
const status = (value: SetupSnapshot, id: string) => buildSetupGuide(value).find((step) => step.id === id)!.status;

describe("setup guide evidence", () => {
  it("does not treat unverified credentials, job tables, or demo examples as working automation", () => {
    const connection = { ...demoConnections.find((item) => item.provider === "hotmart")!, lastVerifiedAt: null };
    expect(status({ ...snapshot, connections: [connection] }, "sales")).toBe("review");
    expect(status({ ...snapshot, connections: [{ ...connection, lastVerifiedAt: "2026-10-01" }] }, "sales")).toBe("available");
    expect(status(snapshot, "automation")).toBe("review");
    expect(buildSetupGuide({ ...snapshot, connections: demoConnections, projects: demoProjects, demoMode: true }).every((step) => step.status === "unknown")).toBe(true);
  });
  it("keeps unavailable optional providers separate from the core system", () => {
    const checks = snapshot.checks.map((item) => ({ ...item, ready: item.module !== "payt" && item.module !== "google" }));
    expect(isBaseAvailable(checks)).toBe(true);
    expect(isBaseAvailable([])).toBe(false);
    expect(status({ ...snapshot, checks }, "base")).toBe("available");
    expect(status({ ...snapshot, serverConfigured: false }, "base")).toBe("pending");
    expect(status(snapshot, "forms")).toBe("optional");
  });
  it("does not mistake catalog-only providers or revoked connections for a sales integration", () => {
    const connection = demoConnections.find((item) => item.provider === "hotmart")!;
    expect(status({ ...snapshot, connections: [{ ...connection, provider: "eduzz" }] }, "sales")).toBe("pending");
    const prepared = { ...snapshot, connections: [{ ...connection, provider: "assiny" as const }] };
    expect(status(prepared, "sales")).toBe("pending");
    expect(buildSetupGuide(prepared).find(step => step.id === "sales")?.evidence).toContain("sem processamento de vendas");
    expect(status({ ...snapshot, connections: [{ ...connection, status: "revoked" }] }, "sales")).toBe("pending");
  });
  it("reports unknown rather than missing when source queries fail", () => {
    expect(status({ ...snapshot, connectionsWarning: "query failed" }, "sales")).toBe("unknown");
    expect(status({ ...snapshot, connectionsWarning: "query failed" }, "forms")).toBe("unknown");
    expect(status({ ...snapshot, projectsWarning: "query failed" }, "project")).toBe("unknown");
  });
  it("requires server Google credentials even when an authorization record exists", () => {
    const connection = { ...demoConnections[0], provider: "google_forms" as const, status: "connected" as const, lastVerifiedAt: "2026-10-01" };
    expect(status({ ...snapshot, connections: [connection], googleConfigured: false }, "forms")).toBe("pending");
    expect(status({ ...snapshot, connections: [connection] }, "forms")).toBe("available");
    expect(status({ ...snapshot, connections: [connection], formsCount: 0 }, "forms")).toBe("review");
    expect(status({ ...snapshot, connections: [connection], formsCount: null }, "forms")).toBe("unknown");
  });
});
