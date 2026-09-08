import { PageHeader } from "@/components/shell/AppShell";
import { LibraryView } from "@/components/panels/LibraryView";
import { BentoGrid } from "@/components/ui/Panel";

export default function LibraryPage() {
  return (
    <>
      <PageHeader
        title="Library"
        description="Everything Sonarr and Radarr are tracking, counted and sized."
      />
      <BentoGrid>
        <LibraryView />
      </BentoGrid>
    </>
  );
}
