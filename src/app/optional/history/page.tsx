import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthProviderBoundary } from "@/components/auth/AuthProviderBoundary";
import { OfficialSubjectPageClient } from "@/components/OfficialSubjectPageClient";
import { OfficialSubjectWorkspace } from "@/components/OfficialSubjectWorkspace";
import { getSubjectPageMeta, getSubjectSyllabusNodes } from "@/lib/study-page-data";
import { getInitialOfficialSubjectShells, getOfficialProgressQuestionIds } from "@/lib/static-shell-data";

export const metadata: Metadata = {
  title: "History Optional - UPSCat",
  description: "History optional PYQs arranged by the best available syllabus cues in the repo.",
};

export default async function Page() {
  const subject = getSubjectPageMeta("history");
  const questions = getInitialOfficialSubjectShells("history");
  const progressQuestionIds = getOfficialProgressQuestionIds("history");
  const syllabusNodes = await getSubjectSyllabusNodes("history");

  return (
    <AuthProviderBoundary>
      <Suspense
        fallback={
          <OfficialSubjectWorkspace
            subjectKey="history"
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
          subjectKey="history"
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
