import type { Metadata } from "next";
import { SubjectWorkspace } from "@/components/SubjectWorkspace";
import { getSubjectPageMeta, getSubjectPyqs, getSubjectSyllabusNodes } from "@/lib/pyq";

export const metadata: Metadata = { title: "GS Paper IV - UPSCat", description: "Ethics and case-study PYQs arranged by the actual GS IV syllabus." };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; syllabus?: string }> }) {
  const params = await searchParams;
  const subject = getSubjectPageMeta("gs4");
  const cards = await getSubjectPyqs("gs4", params.q || "", 1000, params.syllabus || "");
  const syllabusNodes = await getSubjectSyllabusNodes("gs4");

  return (
    <SubjectWorkspace
      subjectKey="gs4"
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
