import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false, // keep the TV screen clean

  // Phones scan a QR code for /play; the controller is a static page. /tv is the
  // static TV page for browsers too old for this app (see src/tv/tv.ts).
  async rewrites() {
    return [
      { source: "/play", destination: "/controller.html" },
      { source: "/tv", destination: "/tv.html" },
    ];
  },
};

export default nextConfig;
