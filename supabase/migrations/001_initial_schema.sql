-- =============================================================================
-- Freebuff Desktop — Supabase Schema Migration
-- Migrated from Convex schema.ts
-- =============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- 1. CUSTOMERS (equivalent to Convex users table + MikWeb customer data)
-- =============================================================================
-- The Convex schema had a `users` table from authTables + custom fields.
-- With Supabase Auth, users are managed by auth.users.
-- We create a `profiles` table linked to auth.users for additional data.

CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT,
  image TEXT,
  email TEXT,
  email_verified BOOLEAN DEFAULT FALSE,
  role TEXT CHECK (role IN ('admin', 'user', 'member')) DEFAULT 'user',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for email lookup
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);

-- =============================================================================
-- 2. MIKWEB SESSIONS (customer portal sessions)
-- =============================================================================
CREATE TABLE IF NOT EXISTS mikweb_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_token TEXT UNIQUE NOT NULL,
  cpf TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  contacts JSONB NOT NULL DEFAULT '[]',
  selected_contact_id TEXT,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  last_activity_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mikweb_sessions_token ON mikweb_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_mikweb_sessions_cpf ON mikweb_sessions(cpf);

-- =============================================================================
-- 3. MIKWEB CONFIG (API configuration + branding)
-- =============================================================================
CREATE TABLE IF NOT EXISTS mikweb_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key TEXT UNIQUE NOT NULL DEFAULT 'default',
  api_url TEXT NOT NULL DEFAULT '',
  api_token TEXT NOT NULL DEFAULT '',
  provider_name TEXT,
  logo_url TEXT,
  updated_at BIGINT NOT NULL,
  updated_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_mikweb_config_key ON mikweb_config(key);

-- Insert default config row
INSERT INTO mikweb_config (key, api_url, api_token, updated_at)
VALUES ('default', '', '', EXTRACT(EPOCH FROM NOW()) * 1000)
ON CONFLICT (key) DO NOTHING;

-- =============================================================================
-- 4. MIKWEB ADMIN SESSIONS
-- =============================================================================
CREATE TABLE IF NOT EXISTS mikweb_admin_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_token TEXT UNIQUE NOT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  last_activity_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mikweb_admin_sessions_token ON mikweb_admin_sessions(session_token);

-- =============================================================================
-- 5. MIKWEB AUDIT LOG
-- =============================================================================
CREATE TABLE IF NOT EXISTS mikweb_audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type TEXT NOT NULL CHECK (type IN (
    'login_success', 'login_failure', 'login_rate_limited',
    'billing_error', 'billing_access', 'logout',
    'barcode_copied', 'pix_copied', 'pdf_viewed'
  )),
  cpf TEXT,
  customer_id TEXT,
  customer_name TEXT,
  error_message TEXT,
  ip_address TEXT,
  user_agent TEXT,
  metadata JSONB,
  timestamp BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mikweb_audit_log_type ON mikweb_audit_log(type);
CREATE INDEX IF NOT EXISTS idx_mikweb_audit_log_cpf ON mikweb_audit_log(cpf);
CREATE INDEX IF NOT EXISTS idx_mikweb_audit_log_timestamp ON mikweb_audit_log(timestamp);

-- =============================================================================
-- 6. INSTALL REQUESTS (new customer signup)
-- =============================================================================
CREATE TABLE IF NOT EXISTS install_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  full_name TEXT NOT NULL,
  cpf TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  zip_code TEXT,
  street TEXT,
  number TEXT,
  complement TEXT,
  neighborhood TEXT,
  city TEXT,
  state TEXT,
  desired_plan TEXT,
  message TEXT,
  agreed_to_terms BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
  admin_note TEXT,
  reviewed_at BIGINT,
  ip_address TEXT,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_install_requests_status ON install_requests(status);
CREATE INDEX IF NOT EXISTS idx_install_requests_created_at ON install_requests(created_at);
CREATE INDEX IF NOT EXISTS idx_install_requests_cpf ON install_requests(cpf);

-- =============================================================================
-- 7. PUSH SUBSCRIPTIONS
-- =============================================================================
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  endpoint TEXT UNIQUE NOT NULL,
  keys JSONB NOT NULL,
  session_token TEXT NOT NULL,
  cpf TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  user_agent TEXT,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_session ON push_subscriptions(session_token);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_cpf ON push_subscriptions(cpf);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint ON push_subscriptions(endpoint);

-- =============================================================================
-- ROW LEVEL SECURITY (RLS)
-- =============================================================================
-- Disable RLS for now — the Hono backend handles auth via session tokens.
-- Enable RLS later if you want direct client-side Supabase access.

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE mikweb_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mikweb_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE mikweb_admin_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mikweb_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE install_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Service role policies (backend uses service_role key)
CREATE POLICY "Service role full access" ON profiles FOR ALL USING (true);
CREATE POLICY "Service role full access" ON mikweb_sessions FOR ALL USING (true);
CREATE POLICY "Service role full access" ON mikweb_config FOR ALL USING (true);
CREATE POLICY "Service role full access" ON mikweb_admin_sessions FOR ALL USING (true);
CREATE POLICY "Service role full access" ON mikweb_audit_log FOR ALL USING (true);
CREATE POLICY "Service role full access" ON install_requests FOR ALL USING (true);
CREATE POLICY "Service role full access" ON push_subscriptions FOR ALL USING (true);

-- =============================================================================
-- FUNCTIONS
-- =============================================================================

-- Function to clean expired sessions (can be called via cron)
CREATE OR REPLACE FUNCTION clean_expired_sessions()
RETURNS void AS $$
BEGIN
  DELETE FROM mikweb_sessions WHERE expires_at < EXTRACT(EPOCH FROM NOW()) * 1000;
  DELETE FROM mikweb_admin_sessions WHERE expires_at < EXTRACT(EPOCH FROM NOW()) * 1000;
END;
$$ LANGUAGE plpgsql;

-- Function to clean expired push subscriptions (endpoints that haven't been used)
CREATE OR REPLACE FUNCTION clean_old_push_subscriptions(max_age_days INTEGER DEFAULT 90)
RETURNS void AS $$
BEGIN
  DELETE FROM push_subscriptions
  WHERE created_at < (EXTRACT(EPOCH FROM NOW()) * 1000) - (max_age_days * 24 * 60 * 60 * 1000);
END;
$$ LANGUAGE plpgsql;
