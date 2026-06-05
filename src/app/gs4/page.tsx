import type { Metadata } from "next";
import { OfficialSubjectWorkspace } from "@/components/OfficialSubjectWorkspace";
import { getOfficialSubjectPyqShells, searchOfficialSubjectPyqs } from "@/lib/official-pyqs";
import { getSubjectPageMeta, getSubjectSyllabusNodes } from "@/lib/pyq";
import { makeProgressItemId } from "@/lib/progress-items";

export const metadata: Metadata = { title: "GS Paper IV - UPSCat", description: "Ethics and case-study PYQs arranged by the actual GS IV syllabus." };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; syllabus?: string; question?: string }> }) {
  const params = await searchParams;
  const subject = getSubjectPageMeta("gs4");
  const syllabusNodes = await getSubjectSyllabusNodes("gs4");
  const syllabusLabel = syllabusNodes.find((node) => node.id === (params.syllabus || ""))?.label || "";
  const cards = params.q?.trim()
    ? await searchOfficialSubjectPyqs("gs4", params.q || "", 1000, syllabusLabel)
    : getOfficialSubjectPyqShells("gs4", "", 1000, syllabusLabel);
  const progressQuestionIds = getOfficialSubjectPyqShells("gs4", "", 5000).map((question) => makeProgressItemId("pyq", question.id));

  return (
    <OfficialSubjectWorkspace
      subjectKey="gs4"
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
