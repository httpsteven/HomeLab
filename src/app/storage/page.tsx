import { PageHeader } from "@/components/shell/AppShell";
import { StorageView } from "@/components/panels/StorageView";
import { BentoGrid } from "@/components/ui/Panel";
import { readHistory } from "@/lib/history";

export const dynamic = "force-dynamic";

/**
 * Storage — the full picture: per-mount capacity, growth with a runway
 * projection, and what's actually consuming the space.
 *
 * History is read on the server (it's a file); everything else streams in
 * over SSE.
 */
export default async function StoragePage() {
  const history = await readHistory();

  return (
    <>
      <PageHeader
        title="Storage"
        description="Capacity per mount, what's consuming it, and how long you've got."
      />
      <BentoGrid>
        <StorageView history={history} />
      </BentoGrid>
    </>
  );
}
