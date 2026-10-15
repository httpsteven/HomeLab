import { PageHeader } from "@/components/shell/AppShell";
import { NewsletterView } from "@/components/panels/NewsletterView";
import { BentoGrid } from "@/components/ui/Panel";

export const metadata = { title: "Newsletter" };

export default function NewsletterPage() {
  return (
    <>
      <PageHeader
        title="Newsletter"
        description="What landed this week, and what it cost."
      />
      <BentoGrid>
        <NewsletterView />
      </BentoGrid>
    </>
  );
}
