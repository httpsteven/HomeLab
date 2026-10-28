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
  // The transports' full dependency closure, computed from their package.json
  // files rather than discovered one failed deploy at a time. Tracing cannot
  // tracing. Tracing cannot see through a require() inside an external
  // package, so each missing module only announces itself at runtime, one
  // redeploy at a time: ws, then eventsource, then whatever is next. This is
  // the whole list from its package.json, so there is no next one.
  outputFileTracingIncludes: {
    "/*": [
      "./node_modules/@microsoft/signalr/**/*",
      "./node_modules/@socket.io/component-emitter/**/*",
      "./node_modules/abort-controller/**/*",
      "./node_modules/debug/**/*",
      "./node_modules/engine.io-client/**/*",
      "./node_modules/engine.io-parser/**/*",
      "./node_modules/event-target-shim/**/*",
      "./node_modules/eventsource/**/*",
      "./node_modules/fetch-cookie/**/*",
      "./node_modules/ms/**/*",
      "./node_modules/node-fetch/**/*",
      "./node_modules/psl/**/*",
      "./node_modules/punycode/**/*",
      "./node_modules/querystringify/**/*",
      "./node_modules/requires-port/**/*",
      "./node_modules/set-cookie-parser/**/*",
      "./node_modules/socket.io-client/**/*",
      "./node_modules/socket.io-parser/**/*",
      "./node_modules/tough-cookie/**/*",
      "./node_modules/tr46/**/*",
      "./node_modules/universalify/**/*",
      "./node_modules/url-parse/**/*",
      "./node_modules/webidl-conversions/**/*",
      "./node_modules/whatwg-url/**/*",
      "./node_modules/ws/**/*",
      "./node_modules/xmlhttprequest-ssl/**/*",
    ],
  },
};

export default nextConfig;
