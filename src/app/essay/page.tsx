import type { Metadata } from "next";
import { SubjectWorkspace } from "@/components/SubjectWorkspace";
import { getSubjectPageMeta, getSubjectPyqs, getSubjectSyllabusNodes } from "@/lib/pyq";

export const metadata: Metadata = { title: "Essay - UPSCat", description: "Essay prompts grouped by theme, with search and topper copies kept simple." };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; syllabus?: string }> }) {
  const params = await searchParams;
  const subject = getSubjectPageMeta("essay");
  const cards = await getSubjectPyqs("essay", params.q || "", 1000, params.syllabus || "");
  const syllabusNodes = await getSubjectSyllabusNodes("essay");

  return (
    <SubjectWorkspace
      subjectKey="essay"
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
