-- One Dream Initiative Database Schema
-- Run this in your Supabase SQL editor or database

-- Users table for One Dream Initiative participants
CREATE TABLE onedream_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    bio TEXT,
    referral_token VARCHAR(100) UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Votes table to track all voting activity
CREATE TABLE onedream_votes (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID REFERENCES onedream_users(id) ON DELETE CASCADE,
    votes INTEGER NOT NULL DEFAULT 1,
    amount_usd NUMERIC(10,2) DEFAULT 0,
    source VARCHAR(50) NOT NULL, -- 'payment', 'visit', 'referral'
    referrer_id UUID REFERENCES onedream_users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Payments table to track monetary contributions
CREATE TABLE onedream_payments (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID REFERENCES onedream_users(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL, -- 'stripe', 'coinbase', 'mock'
    amount_usd NUMERIC(10,2) NOT NULL,
    provider_payment_id VARCHAR(255),
    status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'completed', 'failed'
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_onedream_users_referral_token ON onedream_users(referral_token);
CREATE INDEX idx_onedream_users_created_at ON onedream_users(created_at);
CREATE INDEX idx_onedream_votes_user_id ON onedream_votes(user_id);
CREATE INDEX idx_onedream_votes_created_at ON onedream_votes(created_at);
CREATE INDEX idx_onedream_votes_referrer_id ON onedream_votes(referrer_id);
CREATE INDEX idx_onedream_payments_user_id ON onedream_payments(user_id);
CREATE INDEX idx_onedream_payments_created_at ON onedream_payments(created_at);
CREATE INDEX idx_onedream_payments_status ON onedream_payments(status);

-- Function to automatically update updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
CREATE TRIGGER update_onedream_users_updated_at 
    BEFORE UPDATE ON onedream_users 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_onedream_payments_updated_at 
    BEFORE UPDATE ON onedream_payments 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- View for user statistics
CREATE VIEW onedream_user_stats AS
SELECT 
    u.id,
    u.name,
    u.email,
    u.referral_token,
    COALESCE(SUM(v.votes), 0) as total_votes,
    COALESCE(SUM(v.amount_usd), 0) as total_amount_usd,
    COUNT(v.id) as total_transactions,
    u.created_at
FROM onedream_users u
LEFT JOIN onedream_votes v ON u.id = v.user_id
GROUP BY u.id, u.name, u.email, u.referral_token, u.created_at;

-- View for weekly winners (last 7 days)
CREATE VIEW onedream_weekly_winners AS
SELECT 
    u.id,
    u.name,
    u.email,
    SUM(v.votes) as weekly_votes,
    SUM(v.amount_usd) as weekly_amount_usd,
    ROW_NUMBER() OVER (ORDER BY SUM(v.votes) DESC) as rank
FROM onedream_users u
JOIN onedream_votes v ON u.id = v.user_id
WHERE v.created_at >= NOW() - INTERVAL '7 days'
GROUP BY u.id, u.name, u.email
ORDER BY weekly_votes DESC
LIMIT 10;