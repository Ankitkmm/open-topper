import type { Metadata } from "next";
import { OfficialSubjectWorkspace } from "@/components/OfficialSubjectWorkspace";
import { getOfficialSubjectPyqShells, searchOfficialSubjectPyqs } from "@/lib/official-pyqs";
import { getSubjectPageMeta, getSubjectSyllabusNodes } from "@/lib/pyq";
import { makeProgressItemId } from "@/lib/progress-items";

export const metadata: Metadata = { title: "Essay - UPSCat", description: "Essay prompts grouped by theme, with search and topper copies kept simple." };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; syllabus?: string; question?: string }> }) {
  const params = await searchParams;
  const subject = getSubjectPageMeta("essay");
  const syllabusNodes = await getSubjectSyllabusNodes("essay");
  const syllabusLabel = syllabusNodes.find((node) => node.id === (params.syllabus || ""))?.label || "";
  const cards = params.q?.trim()
    ? await searchOfficialSubjectPyqs("essay", params.q || "", 1000, syllabusLabel)
    : getOfficialSubjectPyqShells("essay", "", 1000, syllabusLabel);
  const progressQuestionIds = getOfficialSubjectPyqShells("essay", "", 5000).map((question) => makeProgressItemId("pyq", question.id));

  return (
    <OfficialSubjectWorkspace
      subjectKey="essay"
      title={subject.title}
      description={subject.description}
      questions={cards}
      syllabusNodes={syllabusNodes}
      query={params.q || ""}
      selectedSyllabusId={params.syllabus || ""}
      focusedQuestionId={params.question || ""}
      progressQuestionIds={progressQuestionIds}
      baseHref={subject.href}
    />
  );
}
