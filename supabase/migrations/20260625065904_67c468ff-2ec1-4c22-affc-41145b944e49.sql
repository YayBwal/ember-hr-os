ALTER TYPE public.candidate_status ADD VALUE IF NOT EXISTS 'hold';
ALTER TABLE public.candidates ADD COLUMN IF NOT EXISTS hold_reason text;
ALTER TABLE public.candidates ADD COLUMN IF NOT EXISTS held_at timestamptz;