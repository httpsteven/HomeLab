import { startCollector } from "@/lib/collect/collector";
import { subscribe, type StoreEvent } from "@/lib/collect/store";

/**
 * SSE endpoint — the single channel every browser subscribes to.
 *
 * Chosen over websockets because the traffic is entirely one-way (control
 * actions go over ordinary POSTs), and SSE reconnects on its own, survives
 * proxies, and needs no protocol upgrade.
 *
 * Each client gets a full snapshot on connect, then per-slot patches.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEARTBEAT_MS = 20_000;

export async function GET(request: Request) {
  // A cold server whose collector hasn't started yet (e.g. instrumentation
  // disabled) still works — the first subscriber starts it.
  startCollector();

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;

      const send = (event: StoreEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };

      const unsubscribe = subscribe(send);

      // Keeps intermediaries from closing an idle connection, and gives the
      // client a liveness signal between data events.
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          closed = true;
        }
      }, HEARTBEAT_MS);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed by the runtime.
        }
      };

      request.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Stops nginx buffering the stream if this ends up behind a proxy.
      "X-Accel-Buffering": "no",
    },
  });
}
