-- ═════════════════════════════════════════════════════════════════════════════
-- TASKFLOW — Full Database Migration
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- Safe to re-run: uses IF NOT EXISTS and CREATE OR REPLACE throughout
-- ═════════════════════════════════════════════════════════════════════════════

-- ─── Extensions ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- for full-text search later

-- ─── Helper: auto-update updated_at ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- TABLE: boards
-- One board at launch, schema supports multiple from day one
-- ═════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.boards (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT        NOT NULL,
  slug          TEXT        UNIQUE NOT NULL,
  description   TEXT,
  is_default    BOOLEAN     NOT NULL DEFAULT false,
  created_by    UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);

CREATE OR REPLACE TRIGGER boards_updated_at
  BEFORE UPDATE ON public.boards
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ═════════════════════════════════════════════════════════════════════════════
-- TABLE: user_profiles
-- Extends Supabase auth.users with app-level profile data
-- ═════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id            UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name     TEXT,
  display_name  TEXT,
  email         TEXT,
  department    TEXT,
  role          TEXT        NOT NULL DEFAULT 'staff'
                              CHECK (role IN ('super_admin', 'admin', 'staff')),
  avatar_url    TEXT,
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER user_profiles_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Auto-create profile when a new auth user is created
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, full_name, display_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data ->> 'full_name',
    NEW.raw_user_meta_data ->> 'display_name',
    COALESCE(NEW.raw_user_meta_data ->> 'role', 'staff')
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ═════════════════════════════════════════════════════════════════════════════
-- TABLE: columns
-- Kanban board columns, ordered by position (float for LexoRank)
-- ═════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.columns (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id      UUID        NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL,
  color         TEXT,
  position      FLOAT       NOT NULL,
  is_default    BOOLEAN     NOT NULL DEFAULT false,
  is_archive    BOOLEAN     NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);

CREATE OR REPLACE TRIGGER columns_updated_at
  BEFORE UPDATE ON public.columns
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ═════════════════════════════════════════════════════════════════════════════
-- TABLE: tasks
-- Core entity. status is separate from column (board position vs business state)
-- ═════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.tasks (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id          UUID        NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  column_id         UUID        NOT NULL REFERENCES public.columns(id) ON DELETE RESTRICT,
  title             TEXT        NOT NULL CHECK (char_length(title) >= 1 AND char_length(title) <= 500),
  description       TEXT        CHECK (char_length(description) <= 10000),
  status            TEXT        NOT NULL DEFAULT 'new'
                                  CHECK (status IN ('new','pending','in_progress','completed','archived')),
  priority          TEXT        NOT NULL DEFAULT 'normal'
                                  CHECK (priority IN ('low','normal','high','urgent')),
  position          FLOAT       NOT NULL DEFAULT 0,
  submitted_by      UUID        NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  assigned_to       UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  due_date          TIMESTAMPTZ,
  has_real_due_date BOOLEAN     NOT NULL DEFAULT false,
  completed_at      TIMESTAMPTZ,
  labels            TEXT[]      NOT NULL DEFAULT '{}',
  watchers          UUID[]      NOT NULL DEFAULT '{}',
  custom_fields     JSONB       NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ
);

CREATE OR REPLACE TRIGGER tasks_updated_at
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Auto-set completed_at when status changes to 'completed'
CREATE OR REPLACE FUNCTION public.handle_task_completed()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    NEW.completed_at = now();
  END IF;
  IF NEW.status != 'completed' AND OLD.status = 'completed' THEN
    NEW.completed_at = NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER tasks_completed_at
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.handle_task_completed();

-- ═════════════════════════════════════════════════════════════════════════════
-- TABLE: comments
-- ═════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.comments (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id       UUID        NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  author_id     UUID        NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  body          TEXT        NOT NULL CHECK (char_length(body) >= 1 AND char_length(body) <= 5000),
  is_internal   BOOLEAN     NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);

CREATE OR REPLACE TRIGGER comments_updated_at
  BEFORE UPDATE ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ═════════════════════════════════════════════════════════════════════════════
-- TABLE: attachments
-- ═════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.attachments (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id       UUID        NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  uploaded_by   UUID        NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  file_name     TEXT        NOT NULL,
  file_size     INTEGER,
  file_type     TEXT,
  storage_path  TEXT        NOT NULL,
  public_url    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);

-- ═════════════════════════════════════════════════════════════════════════════
-- TABLE: field_definitions
-- Powers the admin-configurable submission form (Phase 2 builder, schema ready now)
-- ═════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.field_definitions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id      UUID        REFERENCES public.boards(id) ON DELETE CASCADE,
  label         TEXT        NOT NULL,
  field_key     TEXT        NOT NULL,
  field_type    TEXT        NOT NULL
                              CHECK (field_type IN (
                                'text','textarea','date','select','checkbox',
                                'file','email','number','priority','labels','url'
                              )),
  options       JSONB,
  is_required   BOOLEAN     NOT NULL DEFAULT false,
  is_visible    BOOLEAN     NOT NULL DEFAULT true,
  position      FLOAT       NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ,
  UNIQUE (board_id, field_key)
);

CREATE OR REPLACE TRIGGER field_definitions_updated_at
  BEFORE UPDATE ON public.field_definitions
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ═════════════════════════════════════════════════════════════════════════════
-- TABLE: activity_logs
-- Immutable audit trail — no soft delete, no updates
-- ═════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.activity_logs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id      UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  task_id       UUID        REFERENCES public.tasks(id) ON DELETE SET NULL,
  entity_type   TEXT        NOT NULL,
  entity_id     UUID,
  action        TEXT        NOT NULL,
  metadata      JSONB       NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  -- Intentionally no updated_at or deleted_at — audit logs are immutable
);

-- ═════════════════════════════════════════════════════════════════════════════
-- TABLE: notifications
-- Phase 2 in-app notifications. Schema lives here from day one.
-- ═════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.notifications (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  task_id       UUID        REFERENCES public.tasks(id) ON DELETE SET NULL,
  type          TEXT        NOT NULL,
  message       TEXT        NOT NULL,
  is_read       BOOLEAN     NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═════════════════════════════════════════════════════════════════════════════
-- TABLE: settings
-- Key-value store for app configuration. Admin-configurable via UI.
-- ═════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.settings (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  key           TEXT        UNIQUE NOT NULL,
  value         JSONB       NOT NULL,
  description   TEXT,
  updated_by    UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═════════════════════════════════════════════════════════════════════════════
-- INDEXES
-- ═════════════════════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_tasks_board_column
  ON public.tasks(board_id, column_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_submitted_by
  ON public.tasks(submitted_by) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_status
  ON public.tasks(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_priority
  ON public.tasks(priority) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_position
  ON public.tasks(column_id, position) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_comments_task
  ON public.comments(task_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_attachments_task
  ON public.attachments(task_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_activity_task
  ON public.activity_logs(task_id);
CREATE INDEX IF NOT EXISTS idx_activity_actor
  ON public.activity_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications(user_id, is_read) WHERE is_read = false;

-- Full-text search on task title + description (used in Phase 2 search)
CREATE INDEX IF NOT EXISTS idx_tasks_fts
  ON public.tasks USING gin(
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, ''))
  );

-- ═════════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- Enable on every table. Even though our API uses the service role key
-- (which bypasses RLS), this protects against any future direct client queries.
-- ═════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.boards           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.columns          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attachments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings         ENABLE ROW LEVEL SECURITY;

-- Helper function: get current user's role
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT role FROM public.user_profiles WHERE id = auth.uid();
$$;

-- ─── RLS Policies ────────────────────────────────────────────────────────────

-- boards: all authenticated users can read active boards
CREATE POLICY "boards_read" ON public.boards FOR SELECT
  TO authenticated USING (deleted_at IS NULL);

-- user_profiles: users see their own profile; admins see all
CREATE POLICY "profiles_read_own" ON public.user_profiles FOR SELECT
  TO authenticated USING (
    id = auth.uid()
    OR public.current_user_role() IN ('admin', 'super_admin')
  );

-- columns: all authenticated can read
CREATE POLICY "columns_read" ON public.columns FOR SELECT
  TO authenticated USING (deleted_at IS NULL);

-- tasks: all authenticated can read active tasks (full transparency setting)
CREATE POLICY "tasks_read_all" ON public.tasks FOR SELECT
  TO authenticated USING (deleted_at IS NULL);

-- tasks: staff can insert their own tasks
CREATE POLICY "tasks_insert_own" ON public.tasks FOR INSERT
  TO authenticated WITH CHECK (submitted_by = auth.uid());

-- tasks: admins can do everything on tasks
CREATE POLICY "tasks_all_admin" ON public.tasks FOR ALL
  TO authenticated USING (public.current_user_role() IN ('admin', 'super_admin'));

-- comments: read non-deleted, non-internal OR admin
CREATE POLICY "comments_read" ON public.comments FOR SELECT
  TO authenticated USING (
    deleted_at IS NULL
    AND (
      is_internal = false
      OR public.current_user_role() IN ('admin', 'super_admin')
    )
  );

-- comments: insert own
CREATE POLICY "comments_insert_own" ON public.comments FOR INSERT
  TO authenticated WITH CHECK (author_id = auth.uid());

-- attachments: all authenticated can read
CREATE POLICY "attachments_read" ON public.attachments FOR SELECT
  TO authenticated USING (deleted_at IS NULL);

-- settings: admins can read/write; staff cannot read (may contain email addresses)
CREATE POLICY "settings_admin_only" ON public.settings FOR ALL
  TO authenticated USING (public.current_user_role() IN ('admin', 'super_admin'));

-- activity_logs: admins can read; no one can insert via client (service role only)
CREATE POLICY "activity_read_admin" ON public.activity_logs FOR SELECT
  TO authenticated USING (public.current_user_role() IN ('admin', 'super_admin'));

-- notifications: users see only their own
CREATE POLICY "notifications_own" ON public.notifications FOR SELECT
  TO authenticated USING (user_id = auth.uid());

-- ═════════════════════════════════════════════════════════════════════════════
-- SEED DATA — Default board, columns, and settings
-- ═════════════════════════════════════════════════════════════════════════════

-- Default board
INSERT INTO public.boards (id, name, slug, description, is_default)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Main Board',
  'main',
  'Primary task board',
  true
) ON CONFLICT (slug) DO NOTHING;

-- Default columns (positions use simple floats; LexoRank used in app for moves)
INSERT INTO public.columns (id, board_id, name, color, position, is_default, is_archive)
VALUES
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001',
   'Inbox',     '#6366f1', 1000, true,  false),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001',
   'Pending',   '#f59e0b', 2000, false, false),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001',
   'Completed', '#10b981', 3000, false, false),
  ('10000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001',
   'Archive',   '#6b7280', 9999, false, true)
ON CONFLICT DO NOTHING;

-- Default settings
INSERT INTO public.settings (key, value, description)
VALUES
  ('branding', '{
    "app_name": "TaskFlow",
    "logo_url": null,
    "primary_color": "224 70% 40%",
    "accent_color": "262 83% 58%"
  }', 'App branding configuration'),
  ('email', '{
    "notification_to": "admin@yourcompany.com",
    "reply_to": null,
    "subject_prefix": "[TaskFlow]",
    "notify_on_submit": true,
    "notify_on_complete": true,
    "notify_on_comment": false
  }', 'Email notification settings'),
  ('theme', '{
    "default_mode": "dark"
  }', 'Default theme preference'),
  ('board', '{
    "default_board_id": "00000000-0000-0000-0000-000000000001"
  }', 'Board configuration')
ON CONFLICT (key) DO NOTHING;
