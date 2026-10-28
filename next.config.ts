import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image.
  output: "standalone",

  // sharp (poster color sampling) and ws (the Plex socket) are native/Node
  // modules — keep them external so the server bundle doesn't try to inline
  // them.
  // better-sqlite3 is a native addon reading the shorts pipeline's database;
  // it must stay external for the same reason.
  //
  // @microsoft/signalr and socket.io-client are here for a different reason:
  // not native code, but CommonJS that resolves its own internals with a
  // dynamic require(). Bundled, that becomes "dynamic usage of require is not
  // supported" at runtime — and because push.ts imports them lazily inside a
  // try/catch, the failure doesn't surface as an error. Sonarr and Radarr just
  // quietly fall back to polling, which looks like a working dashboard that is
  // merely a bit stale. External keeps them as real modules on disk.
  serverExternalPackages: [
    "sharp",
    "ws",
    "better-sqlite3",
    "@microsoft/signalr",
    "socket.io-client",
  ],
};

export default nextConfig;
