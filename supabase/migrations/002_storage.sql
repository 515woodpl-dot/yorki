-- ═════════════════════════════════════════════════════════════════════════════
-- SUPABASE STORAGE SETUP
-- Run this in Supabase SQL Editor AFTER the main migration
-- ═════════════════════════════════════════════════════════════════════════════

-- Create the attachments bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'attachments',
  'attachments',
  false,  -- private bucket; app serves access via signed URLs
  10485760,  -- 10MB limit per file
  ARRAY[
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain', 'text/csv'
  ]
) ON CONFLICT (id) DO NOTHING;

-- ─── Storage RLS Policies ─────────────────────────────────────────────────────

-- Authenticated users can read all attachments
CREATE POLICY "attachments_read_authenticated"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'attachments');

-- Authenticated users can upload (API route handles additional validation)
CREATE POLICY "attachments_upload_authenticated"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'attachments');

-- Users can delete their own uploads; admins can delete any
CREATE POLICY "attachments_delete_own_or_admin"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'attachments'
  AND (
    auth.uid()::text = (storage.foldername(name))[1]
    OR public.current_user_role() IN ('admin', 'super_admin')
  )
);
