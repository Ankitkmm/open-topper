import type { Metadata } from "next";
import { OfficialSubjectWorkspace } from "@/components/OfficialSubjectWorkspace";
import { getOfficialSubjectPyqShells, searchOfficialSubjectPyqs } from "@/lib/official-pyqs";
import { getSubjectPageMeta, getSubjectSyllabusNodes } from "@/lib/pyq";
import { makeProgressItemId } from "@/lib/progress-items";

export const metadata: Metadata = { title: "GS Paper III - UPSCat", description: "Economy, agriculture, science, environment, disaster, and security PYQs arranged by the actual GS III syllabus." };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; syllabus?: string; question?: string }> }) {
  const params = await searchParams;
  const subject = getSubjectPageMeta("gs3");
  const syllabusNodes = await getSubjectSyllabusNodes("gs3");
  const syllabusLabel = syllabusNodes.find((node) => node.id === (params.syllabus || ""))?.label || "";
  const cards = params.q?.trim()
    ? await searchOfficialSubjectPyqs("gs3", params.q || "", 1000, syllabusLabel)
    : getOfficialSubjectPyqShells("gs3", "", 1000, syllabusLabel);
  const progressQuestionIds = getOfficialSubjectPyqShells("gs3", "", 5000).map((question) => makeProgressItemId("pyq", question.id));

  return (
    <OfficialSubjectWorkspace
      subjectKey="gs3"
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
