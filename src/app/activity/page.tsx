import { PageHeader } from "@/components/shell/AppShell";
import { ActivityView } from "@/components/panels/ActivityView";
import { BentoGrid } from "@/components/ui/Panel";

export default function ActivityPage() {
  return (
    <>
      <PageHeader
        title="Activity"
        description="What's streaming now, and what's been watched lately."
      />
      <BentoGrid>
        <ActivityView />
      </BentoGrid>
    </>
  );
}
