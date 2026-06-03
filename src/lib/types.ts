export interface ValueAdd {
  type: string;
  value: string;
}

export interface TopperEntry {
  filename: string;
  rank: string;
  subject_marks: string;
  introduction: string;
  page: string;
  links: string;
  value_adds: ValueAdd[];
}

export interface QuestionGroup {
  id: number;
  question: string;
  syllabus_tags: string[];
  keywords: string[];
  category: string;
  toppers: TopperEntry[];
}

export interface CategoriesMeta {
  categories: { name: string; count: number }[];
  total_questions: number;
  total_toppers: number;
}
