export interface SearchAnswerCard {
  answerId: string;
  questionId: string;
  question: string;
  paper: string;
  category?: string;
  subjectKey: string;
  subjectLabel?: string;
  attemptYear: number | null;
  rank: number | null;
  marksObtained: string | null;
  institute: string | null;
  topperName: string | null;
  syllabusPath: string[];
  topicTags: string[];
  valueAdds: string[];
  summary: string;
  primaryMatchScore: number;
  primaryMatchElo: number;
  pdfAvailable: boolean;
  pdfPage: number | null;
  pageStatus?: "valid" | "missing" | "fallback" | "out_of_range" | null;
  sourceStatus: string;
  score?: number;
  serverScore?: number;
  browserReranked?: boolean;
}

export interface SearchResponsePayload {
  total: number;
  nextCursor: string | null;
  results: SearchAnswerCard[];
}
