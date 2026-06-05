import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthProviderBoundary } from "@/components/auth/AuthProviderBoundary";
import { SubjectWorkspace, SubjectWorkspaceFallback } from "@/components/SubjectWorkspace";
import { getSubjectPageMeta, getSubjectSyllabusNodes } from "@/lib/pyq";
import { getInitialWorkspaceSubjectShells, getSubjectProgressQuestionIds } from "@/lib/static-shell-data";

export const metadata: Metadata = {
  title: "Sociology Optional - UPSCat",
  description: "Sociology optional PYQs arranged by the syllabus.",
};

export default async function Page() {
  const subject = getSubjectPageMeta("sociology");
  const questions = await getInitialWorkspaceSubjectShells("sociology");
  const progressQuestionIds = getSubjectProgressQuestionIds("sociology");
  const syllabusNodes = await getSubjectSyllabusNodes("sociology");

  return (
    <AuthProviderBoundary>
      <Suspense
        fallback={
          <SubjectWorkspaceFallback
            subjectKey="sociology"
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
          subjectKey="sociology"
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
