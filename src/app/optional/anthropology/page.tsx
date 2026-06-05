import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthProviderBoundary } from "@/components/auth/AuthProviderBoundary";
import { SubjectWorkspace, SubjectWorkspaceFallback } from "@/components/SubjectWorkspace";
import { getSubjectPageMeta, getSubjectSyllabusNodes } from "@/lib/pyq";
import { getInitialWorkspaceSubjectShells, getSubjectProgressQuestionIds } from "@/lib/static-shell-data";

export const metadata: Metadata = {
  title: "Anthropology Optional - UPSCat",
  description: "Anthropology optional PYQs arranged by the best available syllabus cues in the repo.",
};

export default async function Page() {
  const subject = getSubjectPageMeta("anthropology");
  const questions = await getInitialWorkspaceSubjectShells("anthropology");
  const progressQuestionIds = getSubjectProgressQuestionIds("anthropology");
  const syllabusNodes = await getSubjectSyllabusNodes("anthropology");

  return (
    <AuthProviderBoundary>
      <Suspense
        fallback={
          <SubjectWorkspaceFallback
            subjectKey="anthropology"
            title={subject.title}
            description={subject.description}
            questions={questions}
            syllabusNodes={syllabusNodes}
            query=""
            selectedSyllabusId=""
            progressQuestionIds={progressQuestionIds}
            baseHref={subject.href}
          />
        }
      >
        <SubjectWorkspace
          subjectKey="anthropology"
          title={subject.title}
          description={subject.description}
          questions={questions}
          syllabusNodes={syllabusNodes}
          progressQuestionIds={progressQuestionIds}
          baseHref={subject.href}
        />
      </Suspense>
    </AuthProviderBoundary>
  );
}
