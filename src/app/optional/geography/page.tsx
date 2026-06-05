import type { Metadata } from "next";
import { SubjectWorkspace } from "@/components/SubjectWorkspace";
import { getSubjectPageMeta, getSubjectPyqShells, getSubjectSyllabusNodes } from "@/lib/pyq";
import { makeProgressItemId } from "@/lib/progress-items";

export const metadata: Metadata = {
  title: "Geography Optional - UPSCat",
  description: "Geography optional PYQs arranged by the syllabus.",
};

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; syllabus?: string }> }) {
  const params = await searchParams;
  const subject = getSubjectPageMeta("geography");
  const cards = await getSubjectPyqShells("geography", params.q || "", 1000, params.syllabus || "");
  const progressQuestionIds = (await getSubjectPyqShells("geography", "", 5000, "")).map((question) => makeProgressItemId("pyq", question.id));
  const syllabusNodes = await getSubjectSyllabusNodes("geography");

  return (
    <SubjectWorkspace
      subjectKey="geography"
      title={subject.title}
      description={subject.description}
      questions={cards}
      syllabusNodes={syllabusNodes}
      query={params.q || ""}
      selectedSyllabusId={params.syllabus || ""}
      progressQuestionIds={progressQuestionIds}
      baseHref={subject.href}
    />
  );
}
