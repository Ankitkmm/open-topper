import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthProviderBoundary } from "@/components/auth/AuthProviderBoundary";
import { SubjectWorkspace, SubjectWorkspaceFallback } from "@/components/SubjectWorkspace";
import { getSubjectPageMeta, getSubjectSyllabusNodes } from "@/lib/pyq";
import { getInitialWorkspaceSubjectShells, getSubjectProgressQuestionIds } from "@/lib/static-shell-data";

export const metadata: Metadata = {
  title: "PSIR Optional - UPSCat",
  description: "PSIR optional PYQs arranged by the syllabus.",
};

export default async function Page() {
  const subject = getSubjectPageMeta("psir");
  const questions = await getInitialWorkspaceSubjectShells("psir");
  const progressQuestionIds = getSubjectProgressQuestionIds("psir");
  const syllabusNodes = await getSubjectSyllabusNodes("psir");

  return (
    <AuthProviderBoundary>
      <Suspense
        fallback={
          <SubjectWorkspaceFallback
            subjectKey="psir"
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
          subjectKey="psir"
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
