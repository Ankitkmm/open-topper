import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthProviderBoundary } from "@/components/auth/AuthProviderBoundary";
import { SubjectWorkspace, SubjectWorkspaceFallback } from "@/components/SubjectWorkspace";
import { getSubjectPageMeta, getSubjectSyllabusNodes } from "@/lib/pyq";
import { getInitialWorkspaceSubjectShells, getSubjectProgressQuestionIds } from "@/lib/static-shell-data";

export const metadata: Metadata = {
  title: "Public Administration Optional - UPSCat",
  description: "Public Administration optional PYQs arranged by the syllabus.",
};

export default async function Page() {
  const subject = getSubjectPageMeta("public-administration");
  const questions = await getInitialWorkspaceSubjectShells("public-administration");
  const progressQuestionIds = getSubjectProgressQuestionIds("public-administration");
  const syllabusNodes = await getSubjectSyllabusNodes("public-administration");

  return (
    <AuthProviderBoundary>
      <Suspense
        fallback={
          <SubjectWorkspaceFallback
            subjectKey="public-administration"
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
          subjectKey="public-administration"
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
