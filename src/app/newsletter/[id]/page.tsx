import { PageHeader } from "@/components/shell/AppShell";
import { NewsletterView } from "@/components/panels/NewsletterView";
import { BentoGrid } from "@/components/ui/Panel";

export const metadata = { title: "Newsletter" };

/**
 * A past issue from the archive.
 *
 * `params` is a promise in this version of Next, so it has to be awaited —
 * the synchronous form from older versions no longer applies.
 */
export default async function ArchivedIssuePage({ params }: PageProps<"/newsletter/[id]">) {
  const { id } = await params;

  return (
    <>
      <PageHeader title="Newsletter" description="An issue from the archive." />
      <BentoGrid>
        <NewsletterView issueId={id} />
      </BentoGrid>
    </>
  );
}
