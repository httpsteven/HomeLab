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

  // Marking a package external keeps it out of the bundle; it does NOT
  // guarantee the standalone output ships all of it. Tracing follows the
  // imports it can see, and it saw `ws` only through its ESM wrapper — so the
  // copy in the image had lib/ and wrapper.mjs but no index.js, which is the
  // CommonJS entry that signalr's require() resolves. Plex's socket kept
  // working (it takes the ESM path) while Sonarr and Radarr could not load the
  // module at all: the same package, present but half-copied.
  //
  // These three go in whole. A few hundred KB is a fair price for transports
  // that fail loudly at build time rather than silently at runtime.
  outputFileTracingIncludes: {
    "/*": [
      "./node_modules/ws/**/*",
      "./node_modules/@microsoft/signalr/**/*",
      "./node_modules/socket.io-client/**/*",
    ],
  },
};

export default nextConfig;
