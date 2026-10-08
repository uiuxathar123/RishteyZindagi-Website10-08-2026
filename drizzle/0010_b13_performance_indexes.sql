-- B13 (Performance / Scalability / Database Optimization).
--
-- Removes 4 genuinely redundant indexes found during the B13 database
-- audit (see PERFORMANCE_REPORT.md / BACKEND.md's B13 section for the
-- full evidence): each of these 4 columns already has a `.unique()`
-- constraint in schema.ts, which Postgres implements as its own unique
-- btree index -- and each ALSO had a second, separately-declared plain
-- `index(...)` on that exact same single column, confirmed via `\d
-- <table>` against the real test database:
--   - transactions.transaction_ref: transactions_transaction_ref_unique
--     (kept) + transactions_ref_idx (dropped)
--   - invoices.invoice_number: invoices_invoice_number_unique (kept) +
--     invoices_number_idx (dropped)
--   - chats.match_id: chats_match_id_unique (kept) + chats_match_idx
--     (dropped)
--   - otps.ticket_hash: otps_ticket_hash_unique (kept) +
--     otps_ticket_hash_idx (dropped)
-- A duplicate single-column btree index serves no query the unique
-- constraint's own index doesn't already serve identically -- it only
-- costs extra index-maintenance work on every INSERT/UPDATE of that
-- table, for zero read-path benefit. No query plan changes as a result
-- (the unique constraint's index remains and is used exactly as before
-- -- see tests/performance-redundant-indexes.test.ts for the regression
-- proof that uniqueness enforcement and lookup-by-column behavior are
-- unchanged).
DROP INDEX "chats_match_idx";--> statement-breakpoint
DROP INDEX "invoices_number_idx";--> statement-breakpoint
DROP INDEX "otps_ticket_hash_idx";--> statement-breakpoint
DROP INDEX "transactions_ref_idx";
