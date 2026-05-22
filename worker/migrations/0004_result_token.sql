-- Store the plaintext result token so we can include it in the "letter ready" email.
-- The token is already disclosed to the customer via the success page URL, so
-- storing it here does not introduce a new secret exposure.
ALTER TABLE orders ADD COLUMN result_token TEXT;
