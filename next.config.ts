import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "hrcxlljvoemiaqhkihqp.supabase.co",
        pathname: "/storage/v1/object/public/genesis/**",
      },
    ],
  },
};

export default nextConfig;
