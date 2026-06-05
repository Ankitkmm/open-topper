import type { Metadata } from "next";
import { SubjectWorkspace } from "@/components/SubjectWorkspace";
import { getSubjectPageMeta, getSubjectPyqShells, getSubjectSyllabusNodes } from "@/lib/pyq";
import { makeProgressItemId } from "@/lib/progress-items";

export const metadata: Metadata = {
  title: "History Optional - UPSCat",
  description: "History optional PYQs arranged by the best available syllabus cues in the repo.",
};

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; syllabus?: string }> }) {
  const params = await searchParams;
  const subject = getSubjectPageMeta("history");
  const cards = await getSubjectPyqShells("history", params.q || "", 1000, params.syllabus || "");
  const progressQuestionIds = (await getSubjectPyqShells("history", "", 5000, "")).map((question) => makeProgressItemId("pyq", question.id));
  const syllabusNodes = await getSubjectSyllabusNodes("history");

  return (
    <SubjectWorkspace
      subjectKey="history"
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
