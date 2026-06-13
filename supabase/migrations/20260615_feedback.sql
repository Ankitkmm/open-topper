-- Feedback table for user-submitted issue reports
-- Supports anonymous feedback (no auth required)

CREATE TABLE IF NOT EXISTS public.feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  page_path TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('bug', 'suggestion', 'content', 'other')),
  message TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 5000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

-- Anyone can insert feedback (including anonymous/unauthenticated users)
CREATE POLICY feedback_insert ON public.feedback
  FOR INSERT TO authenticated, anon
  WITH CHECK (true);

-- Only service_role can read all feedback (for admin triage)
CREATE POLICY feedback_select ON public.feedback
  FOR SELECT TO service_role
  USING (true);

-- Indexes for admin queries
CREATE INDEX idx_feedback_category ON public.feedback(category);
CREATE INDEX idx_feedback_created_at ON public.feedback(created_at DESC);
CREATE INDEX idx_feedback_page_path ON public.feedback(page_path);
