import { envDefinedMailFields, mailConfig } from "@/lib/newsletter/send";
import { readSettings } from "@/lib/settings";

/**
 * Current mail settings for the settings form.
 *
 * The password is never included — not even masked. A masked secret is still
 * a secret that left the server, and the UI only needs to know whether one is
 * stored in order to render "set" versus "not set".
 *
 * Writes go through the action allowlist, not here, so there is exactly one
 * write path in the application.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const config = await mailConfig();
  const stored = (await readSettings()).mail;

  return Response.json(
    {
      mail: {
        host: config.host,
        port: config.port,
        secure: config.secure,
        user: config.user,
        from: config.from,
        viewerRecipients: config.viewerRecipients.join(", "),
        adminRecipients: config.adminRecipients.join(", "),
        enabled: config.enabled,
        /** Whether a password exists, never what it is. */
        hasPassword: Boolean(config.pass),
        /** True when the value came from settings.json rather than the env. */
        storedFields: Object.keys(stored).filter(
          (key) => stored[key as keyof typeof stored] !== undefined && key !== "pass",
        ),
        envFields: envDefinedMailFields(),
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
