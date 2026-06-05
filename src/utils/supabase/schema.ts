export type ProgressItemType = "pyq" | "relevant_question" | "topper_copy";

export type Database = {
  public: {
    Tables: {
      user_progress: {
        Row: {
          user_id: string;
          item_type: ProgressItemType;
          item_id: string;
          done: boolean;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          item_type: ProgressItemType;
          item_id: string;
          done: boolean;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          item_type?: ProgressItemType;
          item_id?: string;
          done?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
