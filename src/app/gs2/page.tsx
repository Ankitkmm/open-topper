import type { Metadata } from "next";
import { SubjectWorkspace } from "@/components/SubjectWorkspace";
import { SUBJECT_ROUTES } from "@/lib/pyq";
import { getOfficialSubjectPyqs } from "@/lib/official-pyqs";

export const metadata: Metadata = { title: "GS Paper II - UPSCat", description: "Polity, Governance, Constitution, and IR PYQs with guided answer-pattern search." };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const params = await searchParams;
  const cards = getOfficialSubjectPyqs("gs2", "", 1000);
  const subject = SUBJECT_ROUTES["gs2"];

  return (
    <SubjectWorkspace
      subjectKey="gs2"
      title={subject.label}
      description="Polity, Governance, Constitution, and IR PYQs with guided answer-pattern search."
      cards={cards}
      query={params.q || ""}
    />
  );
}
