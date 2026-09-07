-- Track provenance of placement_question_bank rows: AI-generated vs sourced
-- from real company placement papers (bulk-ingested from faculty-provided
-- prep material). Bank-first serving in /api/placement/prep/generate already
-- prefers bank rows over a fresh AI call, so populating real questions here
-- naturally mixes them ahead of AI-generated ones — no serving-code change.
alter table placement_question_bank
  add column if not exists source text not null default 'ai_generated'
    check (source in ('ai_generated', 'real_company')),
  add column if not exists source_document text,
  add column if not exists is_verified boolean not null default true,
  add column if not exists content_hash text;

-- Guards against duplicate ingestion: the same question recurring across
-- overlapping source files (common in bulk prep-material dumps), or a
-- re-run of the ingestion script after an interruption. Plain (non-partial)
-- index: Postgres unique indexes already permit unlimited NULLs (each NULL
-- is distinct), so pre-existing AI-generated rows with content_hash IS NULL
-- are unaffected — and a plain index is required for Supabase's upsert(...,
-- {onConflict:'content_hash'}) to match it as a conflict target (a partial
-- index's WHERE predicate isn't part of the inference clause it generates).
create unique index if not exists placement_question_bank_content_hash_idx
  on placement_question_bank (content_hash);

create index if not exists placement_question_bank_source_idx
  on placement_question_bank (source);
