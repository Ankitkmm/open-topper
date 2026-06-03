import type { Metadata } from "next";
import { SubjectWorkspace } from "@/components/SubjectWorkspace";
import { SUBJECT_ROUTES } from "@/lib/pyq";
import { getOfficialSubjectPyqs } from "@/lib/official-pyqs";

export const metadata: Metadata = { title: "Essay - UPSCat", description: "Essay prompts with theme connections and writing-pattern insights." };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const params = await searchParams;
  const cards = getOfficialSubjectPyqs("essay", "", 1000);
  const subject = SUBJECT_ROUTES["essay"];

  return (
    <SubjectWorkspace
      subjectKey="essay"
      title={subject.label}
      description="Essay prompts with theme connections and writing-pattern insights."
      cards={cards}
      query={params.q || ""}
    />
  );
}
