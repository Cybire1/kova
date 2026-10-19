ALTER TABLE payment_links ADD COLUMN recipient_phone text;
ALTER TABLE payment_links ADD COLUMN phone_key text;
ALTER TABLE payment_links ADD COLUMN phone_sms_sent_at timestamptz;
ALTER TABLE payment_links ADD COLUMN phone_sms_attempt_at timestamptz;
ALTER TABLE payment_links ADD COLUMN phone_code_hash text;
ALTER TABLE payment_links ADD COLUMN phone_code_expires_at timestamptz;
ALTER TABLE payment_links ADD COLUMN phone_code_tries integer NOT NULL DEFAULT 0;
ALTER TABLE payment_links ADD COLUMN phone_code_wallet text;
ALTER TABLE payment_links ADD COLUMN phone_verified_wallet text;
ALTER TABLE payment_links ADD COLUMN phone_operation_to text;
ALTER TABLE payment_links ADD COLUMN phone_operation_at integer;
ALTER TABLE payment_links ADD COLUMN phone_checked_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE phone_accounts (
  id uuid PRIMARY KEY,
  network network NOT NULL,
  phone text NOT NULL,
  wallet text,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX phone_accounts_network_phone_idx ON phone_accounts(network, phone);
CREATE INDEX payment_links_phone_status_idx ON payment_links(status) WHERE recipient_phone IS NOT NULL;
