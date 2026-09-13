import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image.
  output: "standalone",

  // sharp (poster color sampling) and ws (the Plex socket) are native/Node
  // modules — keep them external so the server bundle doesn't try to inline
  // them.
  // better-sqlite3 is a native addon reading the shorts pipeline's database;
  // it must stay external for the same reason.
  serverExternalPackages: ["sharp", "ws", "better-sqlite3"],
};

export default nextConfig;
