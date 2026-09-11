import { PageHeader } from "@/components/shell/AppShell";
import { BentoColumns } from "@/components/ui/Panel";
import { HeadlineNumbers } from "@/components/panels/HeadlineNumbers";
import { NowPlaying } from "@/components/panels/NowPlaying";
import { QueuePanel } from "@/components/panels/QueuePanel";
import { ServiceStatusRow } from "@/components/panels/ServiceStatusRow";
import { CapacitySummary, TotalCapacity } from "@/components/panels/StoragePanels";
import { HealthWarnings } from "@/components/panels/HealthWarnings";
import { MachineSummary } from "@/components/panels/MachineSummary";
import { AlertsPanel } from "@/components/panels/AlertsPanel";

/**
 * Overview — the single screen that answers "is everything fine".
 *
 * Two columns rather than a wrapping grid. These tiles differ enormously in
 * height — an idle "now playing" is a couple of lines, the server panel is
 * three gauges, a noisy health list is a dozen rows — and in any row-based
 * layout the short ones leave dead space beneath them, because a row is as
 * tall as its tallest member. Columns have no rows to align to.
 *
 * The split is by pace, not by importance: the left column is what you look at
 * (what's playing, what you own, how full it is), the right is what watches
 * you (the machine, warnings, alerting). Services spans the full width at the
 * bottom, where a six-across row belongs. Alerts sits in the right column both
 * because it belongs with the watching, and because it keeps the two columns
 * near enough in height that neither ends far short of the other.
 *
 * Priority still reads top-down within each column, and on mobile the columns
 * collapse into one stack in exactly that order.
 */
export default function OverviewPage() {
  return (
    <>
      <PageHeader
        title="Overview"
        description="Everything at a glance — streams, capacity, and service health."
      />

      <BentoColumns
        primary={
          <>
            <NowPlaying />
            <HeadlineNumbers />
            <CapacitySummary />
            <QueuePanel />
          </>
        }
        secondary={
          <>
            <TotalCapacity />
            <MachineSummary />
            <HealthWarnings />
            <AlertsPanel />
          </>
        }
        footer={<ServiceStatusRow />}
      />
    </>
  );
}
