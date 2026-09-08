import { PageHeader } from "@/components/shell/AppShell";
import { HealthView } from "@/components/panels/HealthView";
import { BentoGrid } from "@/components/ui/Panel";

export default function HealthPage() {
  return (
    <>
      <PageHeader
        title="Health"
        description="The machine underneath, and what each service is reporting."
      />
      <BentoGrid>
        <HealthView />
      </BentoGrid>
    </>
  );
}
