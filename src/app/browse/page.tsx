import type { Metadata } from "next";
import { OfficialQuestionCards } from "@/components/OfficialQuestionCards";
import { searchOfficialBrowsePyqs } from "@/lib/official-pyqs";

export const metadata: Metadata = {
  title: "Browse All Questions - UPSCat",
  description:
    "Browse all UPSC PYQs with hybrid search and subject-first navigation.",
};

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    category?: string;
  }>;
}) {
  const params = await searchParams;
  const search = params.q || "";
  const category = params.category || null;
  const questions = await searchOfficialBrowsePyqs(search, category || "", 240);

  return (
    <OfficialQuestionCards
      questions={questions}
      totalFiltered={questions.length}
      searchParams={{
        q: search,
        category: category || "",
      }}
    />
  );
}
