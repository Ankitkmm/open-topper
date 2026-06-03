import type { Metadata } from "next";
import { QuestionCards } from "@/components/QuestionCards";
import { getOfficialBrowsePyqs } from "@/lib/official-pyqs";

export const metadata: Metadata = {
  title: "Browse All Questions - UPSCat",
  description:
    "Browse all UPSC PYQs with linked answer signals. Search by question, topic, or keyword.",
};

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    category?: string;
    keyword?: string;
    page?: string;
  }>;
}) {
  const params = await searchParams;
  const search = params.q || "";
  const category = params.category || null;
  const keyword = params.keyword || null;

  const filtered = getOfficialBrowsePyqs(search, category || "", keyword || "", 10000);
  const initial = filtered.slice(0, 240);

  return (
    <QuestionCards
      initialQuestions={initial}
      totalFiltered={filtered.length}
      searchParams={{
        q: search,
        category: category || "",
        keyword: keyword || "",
      }}
    />
  );
}
