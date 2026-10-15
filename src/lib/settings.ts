import "server-only";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Settings editable from the dashboard, stored beside the other state in
 * data/.
 *
 * Everything else in this project is configured by environment variable,
 * which is the right default for a self-hosted app: it's declarative, it
 * lives with the compose file, and nothing can change it at runtime. This
 * file exists only because mail settings are the one thing people reasonably
 * want to adjust without editing a file and rebuilding a container.
 *
 * Two rules follow from that, and both matter:
 *
 *   1. The password is WRITE-ONLY. It is never returned by any endpoint, not
 *      even masked, because a masked secret is still a secret that left the
 *      server. The UI gets a boolean saying whether one is stored.
 *   2. The file is written 0600. The dashboard has no authentication, so the
 *      filesystem is the only thing protecting it.
 */

const DATA_DIR = "data";
const FILE = "settings.json";

export interface MailSettings {
  host: string | null;
  port: number | null;
  secure: boolean | null;
  user: string | null;
  pass: string | null;
  from: string | null;
  viewerRecipients: string | null;
  adminRecipients: string | null;
  enabled: boolean | null;
}

export interface StoredSettings {
  mail: Partial<MailSettings>;
}

const EMPTY: StoredSettings = { mail: {} };

function filePath(): string {
  return join(process.cwd(), DATA_DIR, FILE);
}

const globalForSettings = globalThis as unknown as { __settings?: StoredSettings };

export async function readSettings(): Promise<StoredSettings> {
  if (globalForSettings.__settings) return globalForSettings.__settings;

  try {
    const parsed = JSON.parse(await readFile(filePath(), "utf8")) as Partial<StoredSettings>;
    globalForSettings.__settings = { mail: parsed.mail ?? {} };
  } catch {
    // No file yet, or unreadable. Falling back to env is correct: settings
    // are an override, not the only source.
    globalForSettings.__settings = EMPTY;
  }

  return globalForSettings.__settings;
}

export async function writeMailSettings(patch: Partial<MailSettings>): Promise<void> {
  const current = await readSettings();

  // `undefined` means "not supplied" and must leave the stored value alone;
  // `null` means "cleared". Spreading the patch directly does not honour that
  // — an explicit `{ user: undefined }` overwrites — so the keys are dropped
  // before the merge. This is what lets a partial save (the password field, a
  // single corrected port) avoid wiping everything it didn't mention.
  const supplied = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<MailSettings>;

  const next: StoredSettings = { mail: { ...current.mail, ...supplied } };

  await mkdir(join(process.cwd(), DATA_DIR), { recursive: true });
  const path = filePath();
  await writeFile(path, JSON.stringify(next, null, 2), "utf8");

  try {
    await chmod(path, 0o600);
  } catch {
    // Best effort — some filesystems (a bind mount from a different host OS)
    // don't support it. Not a reason to fail the save.
  }

  globalForSettings.__settings = next;
}
