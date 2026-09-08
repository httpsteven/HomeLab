import { PageHeader } from "@/components/shell/AppShell";
import { BentoGrid } from "@/components/ui/Panel";
import { HeadlineNumbers } from "@/components/panels/HeadlineNumbers";
import { NowPlaying } from "@/components/panels/NowPlaying";
import { QueuePanel } from "@/components/panels/QueuePanel";
import { ServiceStatusRow } from "@/components/panels/ServiceStatusRow";
import { CapacitySummary, TotalCapacity } from "@/components/panels/StoragePanels";
import { HealthWarnings } from "@/components/panels/HealthWarnings";
import { MachineSummary } from "@/components/panels/MachineSummary";

/**
 * Overview — the single screen that answers "is everything fine".
 *
 * Order is priority order, and it holds on mobile where everything collapses
 * to one column: what's happening now, then what might be wrong, then the
 * numbers, then the detail.
 */
export default function OverviewPage() {
  return (
    <>
      <PageHeader
        title="Overview"
        description="Everything at a glance — streams, capacity, and service health."
      />

      <BentoGrid>
        <NowPlaying />
        <TotalCapacity />
        <HealthWarnings />
        <HeadlineNumbers />
        <CapacitySummary />
        <MachineSummary />
        <QueuePanel />
        <ServiceStatusRow />
      </BentoGrid>
    </>
  );
}
