import type { Metadata } from "next";
import { SubjectWorkspace } from "@/components/SubjectWorkspace";
import { getSubjectPageMeta, getSubjectPyqs, getSubjectSyllabusNodes } from "@/lib/pyq";

export const metadata: Metadata = { title: "GS Paper II - UPSCat", description: "Polity, governance, social justice, and IR PYQs arranged by the actual GS II syllabus." };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; syllabus?: string }> }) {
  const params = await searchParams;
  const subject = getSubjectPageMeta("gs2");
  const cards = await getSubjectPyqs("gs2", params.q || "", 1000, params.syllabus || "");
  const syllabusNodes = await getSubjectSyllabusNodes("gs2");

  return (
    <SubjectWorkspace
      subjectKey="gs2"
      title={subject.title}
      description={subject.description}
      questions={cards}
      syllabusNodes={syllabusNodes}
      query={params.q || ""}
      selectedSyllabusId={params.syllabus || ""}
      baseHref={subject.href}
    />
  );
}
