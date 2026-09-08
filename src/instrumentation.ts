/**
 * Boots the collector once, when the server process starts.
 *
 * The nodejs-runtime guard matters: instrumentation also runs in the edge
 * runtime, where `ws`, `sharp` and the filesystem don't exist.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { startCollector } = await import("@/lib/collect/collector");
  const { startPushConnections } = await import("@/lib/collect/push");

  startCollector();

  // Push is best-effort and must never block startup — polling is already
  // running by this point, so a failure here just means normal cadence.
  void startPushConnections().catch(() => {});
}
