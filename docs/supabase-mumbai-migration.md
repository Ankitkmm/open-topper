# Supabase Mumbai Migration Plan

## Why Mumbai?

- **99% of users are in India** — the product targets UPSC aspirants exclusively
- Current Supabase project is in a non-India region, adding unnecessary latency to every auth call, progress sync, and feedback write
- Mumbai (`ap-south-1`) reduces round-trip time for:
  - Auth operations (login, register, session refresh)
  - Progress sync (`PUT /api/progress` → `user_progress` table)
  - Feedback submissions (`POST /api/feedback` → `feedback` table)
- Expected improvement: ~200–400ms reduction per DB round-trip for Indian users

---

## Prerequisites

### Schema files

Two migrations in `supabase/migrations/`:

| Migration | Table | Purpose |
|-----------|-------|---------|
| `20260605_user_progress.sql` | `user_progress` | Tracks per-user progress on PYQs, relevant questions, and topper copies |
| `20260615_feedback.sql` | `feedback` | User-submitted bug reports, suggestions, content issues |

### Tables

- **`user_progress`** — composite PK (`user_id`, `item_type`, `item_id`), RLS enabled, 3 policies (select/insert/update own)
- **`feedback`** — UUID PK, nullable `user_id` FK, RLS enabled, anon insert allowed, service_role select only

### Auth configuration

- Email/password auth only (no OAuth/social providers)
- Session managed via `@supabase/ssr` cookies (pattern: `sb-*-auth-token`)
- Site URL: `https://upscat.click`

### Environment variables that must be updated

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (if used for admin/feedback reads)

---

## Migration Steps

### 1. Create new Supabase project in Mumbai (ap-south-1)

1. Go to [supabase.com](https://supabase.com) → New Project
2. Select organization
3. Region: **South Asia (Mumbai)**
4. Set a strong database password (save securely)
5. Note the new project's:
   - Project URL (`https://<project-ref>.supabase.co`)
   - Anon/public key
   - Service role key

### 2. Apply migrations to new project

Run against the new project using the Supabase CLI or SQL Editor:

```bash
# Option A: Supabase CLI (link to new project first)
supabase link --project-ref <new-project-ref>
supabase db push

# Option B: SQL Editor in Supabase Dashboard
# Paste contents of each migration file in order:
```

Apply in order:
1. `supabase/migrations/20260605_user_progress.sql`
2. `supabase/migrations/20260615_feedback.sql`

**Verify:**
- Both tables exist in the `public` schema
- RLS is enabled on both tables
- Policies are created (check via Dashboard → Authentication → Policies)
- `user_progress` has 3 policies: `user_progress_select_own`, `user_progress_insert_own`, `user_progress_update_own`
- `feedback` has 2 policies: `feedback_insert`, `feedback_select`
- Indexes exist on `feedback`: `idx_feedback_category`, `idx_feedback_created_at`, `idx_feedback_page_path`

### 3. Configure auth

In the new Supabase project dashboard:

1. **Authentication → Providers → Email**
   - Enable email/password sign-up
   - Disable email confirmations (or match current project setting)
   - Set minimum password length to match current project

2. **Authentication → URL Configuration**
   - Site URL: `https://upscat.click`
   - Redirect URLs: `https://upscat.click/**`

3. **Authentication → Settings**
   - Disable any unused auth providers
   - Review rate limits for auth endpoints

### 4. Data migration (if any users exist)

> **If no real users exist yet, skip this step entirely.** The app currently has auth QA-disabled, so there may be zero registered users.

If users do exist in the old project:

1. **Export `auth.users`:**
   ```sql
   -- Run in old project SQL Editor
   SELECT id, email, encrypted_password, created_at, updated_at
   FROM auth.users;
   ```
   Save the output securely.

2. **Export `user_progress`:**
   ```sql
   SELECT * FROM public.user_progress;
   ```

3. **Export `feedback`:**
   ```sql
   SELECT * FROM public.feedback;
   ```

4. **Import to new project:**
   - For `auth.users`: use Supabase's `auth.users` insert (requires service_role or direct DB access)
   - For `user_progress` and `feedback`: standard SQL INSERT statements via SQL Editor

5. **Verify row counts match** between old and new projects.

### 5. Update Vercel environment variables

In Vercel project settings → Environment Variables:

| Variable | New Value |
|----------|-----------|
| `NEXT_PUBLIC_SUPABASE_URL` | New Mumbai project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | New anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | New service role key (if used) |

Then trigger a redeploy:

```bash
# Via Vercel CLI
vercel --prod

# Or: push an empty commit / trigger redeploy from Vercel dashboard
```

### 6. Smoke test

After redeployment completes:

- [ ] **Auth flow:** Register a test account → login → logout → login again
- [ ] **Progress sync:** Mark a PYQ as done → refresh page → verify it persists
- [ ] **Progress API:** `GET /api/progress` returns entries, `PUT /api/progress` succeeds
- [ ] **Feedback:** Submit feedback from a study page → verify it appears in new project's `feedback` table
- [ ] **RLS policies:** Attempt to read another user's progress (should fail)
- [ ] **Anonymous feedback:** Submit feedback without being logged in (should succeed)
- [ ] **PDF access:** Verify `/pdf/[answerId]` still works (not directly Supabase-dependent, but confirm no regressions)
- [ ] **Session refresh:** Verify middleware cookie refresh works on protected routes

### 7. Rollback plan

If issues are discovered post-migration:

1. Revert Vercel environment variables to old project values
2. Trigger redeploy
3. Old project is untouched — zero data loss
4. Investigate and retry migration when ready

**Important:** Do NOT delete the old Supabase project until the new one is confirmed stable for at least 1 week.

---

## Estimated Downtime

- **Zero downtime** for the migration itself — old project stays live until env vars are swapped
- **~2 minutes** to update Vercel env vars and trigger redeploy
- During those 2 minutes, auth/progress API calls may fail (public browsing is unaffected)

---

## Risks

| Risk | Mitigation |
|------|------------|
| Users registered on old project won't exist on new project | Run data export/import in Step 4 before switching |
| Feedback data in old project lost | Export `feedback` table before switching |
| Supabase CLI version mismatch | Use SQL Editor as fallback for migration application |
| New project misconfigured | Run full smoke test before considering migration complete |
| Cookie domain issues | Supabase cookies use project-ref in name; old cookies will be ignored (not harmful) |
| Rate limit differences | Review new project's default rate limits in Auth settings |

---

## Post-Migration Cleanup

Once stable (1+ week after migration):

1. Remove/archive old Supabase project (or downgrade to free tier)
2. Update `docs/ai-handoff.md` with new project region
3. Update any CI/CD references to old project
4. Remove this migration doc's "Rollback plan" section (or mark as completed)

---

## Security Reminders

- **Never commit actual project URLs, keys, or secrets** to the repo
- All secrets go in Vercel env vars and `.env.local` (gitignored)
- The new service role key must be kept server-side only — never expose in client bundles
- Verify `NEXT_PUBLIC_TEMPORARY_QA_AUTH_DISABLED` is `"false"` (or unset) in production after migration
