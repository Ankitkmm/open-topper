import type { Metadata } from "next";
import { SubjectWorkspace } from "@/components/SubjectWorkspace";
import { SUBJECT_ROUTES } from "@/lib/pyq";
import { getOfficialSubjectPyqs } from "@/lib/official-pyqs";

export const metadata: Metadata = { title: "GS Paper III - UPSCat", description: "Economy, environment, security, disaster, and technology PYQs with linked answer signals." };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const params = await searchParams;
  const cards = getOfficialSubjectPyqs("gs3", "", 1000);
  const subject = SUBJECT_ROUTES["gs3"];

  return (
    <SubjectWorkspace
      subjectKey="gs3"
      title={subject.label}
      description="Economy, environment, security, disaster, and technology PYQs with linked answer signals."
      cards={cards}
      query={params.q || ""}
    />
  );
}
