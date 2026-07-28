import Image from "next/image";
import { genesisLogoUrl } from "@/lib/brand";

export function GenesisLogo({
  size = 44,
  className,
  priority = false,
}: {
  size?: number;
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src={genesisLogoUrl}
      alt="Logomarca Genesis"
      width={size}
      height={size}
      sizes={`${size}px`}
      priority={priority}
      className={className}
    />
  );
}
