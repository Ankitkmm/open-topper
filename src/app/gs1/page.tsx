import type { Metadata } from "next";
import { SubjectWorkspace } from "@/components/SubjectWorkspace";
import { SUBJECT_ROUTES } from "@/lib/pyq";
import { getOfficialSubjectPyqs } from "@/lib/official-pyqs";

export const metadata: Metadata = { title: "GS Paper I - UPSCat", description: "History, Geography, and Society PYQs with AI-ranked answer signals." };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const params = await searchParams;
  const cards = getOfficialSubjectPyqs("gs1", "", 1000);
  const subject = SUBJECT_ROUTES["gs1"];

  return (
    <SubjectWorkspace
      subjectKey="gs1"
      title={subject.label}
      description="History, Geography, and Society PYQs with AI-ranked answer signals."
      cards={cards}
      query={params.q || ""}
    />
  );
}
