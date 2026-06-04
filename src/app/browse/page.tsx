import type { Metadata } from "next";
import { QuestionCards } from "@/components/QuestionCards";
import { getBrowsePyqs } from "@/lib/pyq";

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
  const questions = await getBrowsePyqs({
    query: search,
    category: category || "",
    limit: 240,
  });

  return (
    <QuestionCards
      initialQuestions={questions}
      totalFiltered={questions.length}
      searchParams={{
        q: search,
        category: category || "",
      }}
    />
  );
}
