import { PageHeader } from "@/components/shell/AppShell";
import { ShortsPipelinePanel } from "@/components/panels/ShortsPipelinePanel";
import { ShortsView } from "@/components/panels/ShortsView";
import { SubtitleAuditPanel } from "@/components/panels/SubtitleAuditPanel";
import { BentoGrid } from "@/components/ui/Panel";

export const metadata = { title: "Shorts" };

export default function ShortsPage() {
  return (
    <>
      <PageHeader
        title="Shorts"
        description="Clips cut from the library, with the subtitle coverage that made them possible."
      />
      <BentoGrid>
        <ShortsView />
        <SubtitleAuditPanel />
        <ShortsPipelinePanel />
      </BentoGrid>
    </>
  );
}
