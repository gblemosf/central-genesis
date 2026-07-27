import type { Metadata } from "next";
import { FunnelSimulator } from "@/components/funnel-simulator";

export const metadata: Metadata = { title: "Simulador" };

export default function SimulatorPage() {
  return <FunnelSimulator />;
}
