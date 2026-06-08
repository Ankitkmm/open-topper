import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthProviderBoundary } from "@/components/auth/AuthProviderBoundary";
import { OfficialSubjectPageClient } from "@/components/OfficialSubjectPageClient";
import { OfficialSubjectWorkspace } from "@/components/OfficialSubjectWorkspace";
import { getSubjectPageMeta, getSubjectSyllabusNodes } from "@/lib/study-page-data";
import { getInitialOfficialSubjectShells, getOfficialProgressQuestionIds } from "@/lib/static-shell-data";

export const metadata: Metadata = {
  title: "Sociology Optional - UPSCat",
  description: "Sociology optional PYQs arranged by the syllabus.",
};

export default async function Page() {
  const subject = getSubjectPageMeta("sociology");
  const questions = getInitialOfficialSubjectShells("sociology");
  const progressQuestionIds = getOfficialProgressQuestionIds("sociology");
  const syllabusNodes = await getSubjectSyllabusNodes("sociology");

  return (
    <AuthProviderBoundary>
      <Suspense
        fallback={
          <OfficialSubjectWorkspace
            subjectKey="sociology"
            title={subject.title}
            description={subject.description}
            questions={questions}
            syllabusNodes={syllabusNodes}
            query=""
            selectedSyllabusId=""
            focusedQuestionId=""
            progressQuestionIds={progressQuestionIds}
            baseHref={subject.href}
          />
        }
      >
        <OfficialSubjectPageClient
          subjectKey="sociology"
          title={subject.title}
          description={subject.description}
          initialQuestions={questions}
          syllabusNodes={syllabusNodes}
          progressQuestionIds={progressQuestionIds}
          baseHref={subject.href}
        />
      </Suspense>
    </AuthProviderBoundary>
  );
}
