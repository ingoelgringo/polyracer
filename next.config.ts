import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false, // keep the TV screen clean

  // Phones scan a QR code for /play; the controller is a static page.
  async rewrites() {
    return [{ source: "/play", destination: "/controller.html" }];
  },
};

export default nextConfig;
