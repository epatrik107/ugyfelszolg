-- Security: stop storing raw result tokens in the database.
-- The application now uses only result_token_hash for verification,
-- and the bearer token from the request header for email link generation.
-- Clear any previously stored raw tokens; the column is kept for schema compatibility.
UPDATE orders SET result_token = NULL WHERE result_token IS NOT NULL;
