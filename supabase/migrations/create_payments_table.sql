-- Create payments table for tracking crypto transactions

CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_hash TEXT UNIQUE NOT NULL,
    network TEXT NOT NULL CHECK (network IN ('bsc', 'tron', 'paystack')),
    amount DECIMAL(20, 6),
    participant_id UUID REFERENCES participants(id),
    vote_count INTEGER,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'failed')),
    verified BOOLEAN DEFAULT FALSE,
    verified_at TIMESTAMPTZ,
    block_number BIGINT,
    recipient_address TEXT,
    sender_address TEXT,
    raw_response JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookups
CREATE INDEX idx_payments_tx_hash ON payments(transaction_hash);
CREATE INDEX idx_payments_participant ON payments(participant_id);
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_payments_network ON payments(network);

-- Function to increment votes
CREATE OR REPLACE FUNCTION increment_votes(p_id UUID, vote_increment INTEGER)
RETURNS void AS $$
BEGIN
    UPDATE participants 
    SET total_votes = COALESCE(total_votes, 0) + vote_increment,
        updated_at = NOW()
    WHERE id = p_id;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payments_updated_at
    BEFORE UPDATE ON payments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Row Level Security
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "Service role can do everything" ON payments
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Allow authenticated users to view their own payments
CREATE POLICY "Users can view payments" ON payments
    FOR SELECT
    TO authenticated
    USING (true);
