import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image.
  output: "standalone",

  // sharp (poster color sampling) and ws (the Plex socket) are native/Node
  // modules — keep them external so the server bundle doesn't try to inline
  // them.
  serverExternalPackages: ["sharp", "ws"],
};

export default nextConfig;
