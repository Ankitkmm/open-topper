import type { Metadata } from "next";
import { SubjectWorkspace } from "@/components/SubjectWorkspace";
import { getSubjectPageMeta, getSubjectPyqShells, getSubjectSyllabusNodes } from "@/lib/pyq";
import { makeProgressItemId } from "@/lib/progress-items";

export const metadata: Metadata = {
  title: "PSIR Optional - UPSCat",
  description: "PSIR optional PYQs arranged by the syllabus.",
};

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; syllabus?: string }> }) {
  const params = await searchParams;
  const subject = getSubjectPageMeta("psir");
  const cards = await getSubjectPyqShells("psir", params.q || "", 1000, params.syllabus || "");
  const progressQuestionIds = (await getSubjectPyqShells("psir", "", 5000, "")).map((question) => makeProgressItemId("pyq", question.id));
  const syllabusNodes = await getSubjectSyllabusNodes("psir");

  return (
    <SubjectWorkspace
      subjectKey="psir"
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
