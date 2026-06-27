-- Seed the MVP bank catalog. Sender allowlists remain empty until verified.
INSERT INTO "BankProvider" (
    "id", "code", "name", "countryCode", "status",
    "supportedChannels", "createdAt", "updatedAt"
) VALUES
    ('bank_vcb', 'VCB', 'Vietcombank', 'VN', 'ACTIVE', ARRAY['email']::TEXT[], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('bank_tcb', 'TCB', 'Techcombank', 'VN', 'ACTIVE', ARRAY['email']::TEXT[], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('bank_mbb', 'MBB', 'MB Bank', 'VN', 'ACTIVE', ARRAY['email']::TEXT[], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('bank_acb', 'ACB', 'ACB', 'VN', 'ACTIVE', ARRAY['email']::TEXT[], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
