import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthProviderBoundary } from "@/components/auth/AuthProviderBoundary";
import { OfficialSubjectPageClient } from "@/components/OfficialSubjectPageClient";
import { OfficialSubjectWorkspace } from "@/components/OfficialSubjectWorkspace";
import { getSubjectPageMeta, getSubjectSyllabusNodes } from "@/lib/study-page-data";
import { getInitialOfficialSubjectShells, getOfficialProgressQuestionIds } from "@/lib/static-shell-data";

export const metadata: Metadata = {
  title: "Geography Optional - UPSCat",
  description: "Geography optional PYQs arranged by the syllabus.",
};

export default async function Page() {
  const subject = getSubjectPageMeta("geography");
  const questions = getInitialOfficialSubjectShells("geography");
  const progressQuestionIds = getOfficialProgressQuestionIds("geography");
  const syllabusNodes = await getSubjectSyllabusNodes("geography");

  return (
    <AuthProviderBoundary>
      <Suspense
        fallback={
          <OfficialSubjectWorkspace
            subjectKey="geography"
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
          subjectKey="geography"
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
