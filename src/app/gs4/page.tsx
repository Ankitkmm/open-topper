import type { Metadata } from "next";
import { SubjectWorkspace } from "@/components/SubjectWorkspace";
import { SUBJECT_ROUTES } from "@/lib/pyq";
import { getOfficialSubjectPyqs } from "@/lib/official-pyqs";

export const metadata: Metadata = { title: "GS Paper IV - UPSCat", description: "Ethics PYQs organized around value-adds, examples, and evaluator-facing structure." };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const params = await searchParams;
  const cards = getOfficialSubjectPyqs("gs4", "", 1000);
  const subject = SUBJECT_ROUTES["gs4"];

  return (
    <SubjectWorkspace
      subjectKey="gs4"
      title={subject.label}
      description="Ethics PYQs organized around value-adds, examples, and evaluator-facing structure."
      cards={cards}
      query={params.q || ""}
    />
  );
}
