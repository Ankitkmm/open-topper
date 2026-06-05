import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthProviderBoundary } from "@/components/auth/AuthProviderBoundary";
import { SubjectWorkspace, SubjectWorkspaceFallback } from "@/components/SubjectWorkspace";
import { getSubjectPageMeta, getSubjectSyllabusNodes } from "@/lib/study-page-data";
import { getInitialWorkspaceSubjectShells, getSubjectProgressQuestionIds } from "@/lib/static-shell-data";

export const metadata: Metadata = {
  title: "History Optional - UPSCat",
  description: "History optional PYQs arranged by the best available syllabus cues in the repo.",
};

export default async function Page() {
  const subject = getSubjectPageMeta("history");
  const questions = await getInitialWorkspaceSubjectShells("history");
  const progressQuestionIds = getSubjectProgressQuestionIds("history");
  const syllabusNodes = await getSubjectSyllabusNodes("history");

  return (
    <AuthProviderBoundary>
      <Suspense
        fallback={
          <SubjectWorkspaceFallback
            subjectKey="history"
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
          subjectKey="history"
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
