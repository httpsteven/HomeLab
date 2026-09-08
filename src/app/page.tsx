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

      {/* Order is priority order, but it also has to TILE. Spans are chosen so
          the common states sum to 12 across a row:
            row 1  now playing 4 + total storage 4 + server 4
            row 2  health 6 + capacity 6
            row 3  library 12
            row 4  queue 4 + services 8
          Dense auto-flow backfills whatever a state change knocks out of
          alignment, and items-start keeps a short tile from leaving a
          full-height void beside a tall one. */}
      <BentoGrid>
        <NowPlaying />
        <TotalCapacity />
        <MachineSummary />
        <HealthWarnings />
        <CapacitySummary />
        <HeadlineNumbers />
        <QueuePanel />
        <ServiceStatusRow />
      </BentoGrid>
    </>
  );
}
