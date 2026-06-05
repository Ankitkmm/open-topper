import type { Metadata } from "next";
import { Suspense } from "react";
import { BrowsePageClient } from "@/components/BrowsePageClient";
import { OfficialQuestionCards } from "@/components/OfficialQuestionCards";
import { getInitialOfficialBrowseShells } from "@/lib/static-shell-data";

export const metadata: Metadata = {
  title: "Browse All Questions - UPSCat",
  description:
    "Browse all UPSC PYQs with hybrid search and subject-first navigation.",
};

export default function BrowsePage() {
  const questions = getInitialOfficialBrowseShells();

  return (
    <Suspense
      fallback={(
        <OfficialQuestionCards
          questions={questions}
          totalFiltered={questions.length}
          searchParams={{ q: "", category: "" }}
        />
      )}
    >
      <BrowsePageClient initialQuestions={questions} />
    </Suspense>
  );
}
