-- One Dream Initiative Database Setup
-- Run these commands in your Supabase SQL Editor

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Participants table - stores user information 
CREATE TABLE participants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(50) UNIQUE NOT NULL, -- Short username for referral links
    total_votes INTEGER DEFAULT 0, -- Total votes received (from confirmed payments only)
    total_amount DECIMAL(10,2) DEFAULT 0.00, -- Total amount received in payments
    current_stage VARCHAR(20) DEFAULT 'Bronze',
    achievement_badges TEXT[] DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. Payments table - tracks vote payments (MOVED UP to resolve FK dependency)
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    participant_id UUID NOT NULL REFERENCES participants(id), -- Vote recipient
    transaction_id VARCHAR(255) UNIQUE NOT NULL, -- Payment gateway transaction ID
    payment_method VARCHAR(50) NOT NULL, -- 'stripe', 'crypto', 'paypal', etc.
    payment_provider_id VARCHAR(255), -- Stripe payment intent ID, etc.
    amount DECIMAL(10,2) NOT NULL, -- Must be multiple of $2.00 for votes
    currency VARCHAR(3) DEFAULT 'USD',
    payer_email VARCHAR(255), -- Who made the payment
    payer_name VARCHAR(255),
    status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'completed', 'failed', 'refunded'
    payment_metadata JSONB, -- Store additional payment details
    confirmed_at TIMESTAMP WITH TIME ZONE, -- When payment was confirmed
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 7. Votes table - tracks ONLY confirmed payment-based votes (NOW REFERENCES payments)
CREATE TABLE votes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    participant_id UUID NOT NULL REFERENCES participants(id), -- Vote recipient
    payment_id UUID NOT NULL REFERENCES payments(id), -- Must have confirmed payment
    payment_transaction_id VARCHAR(255) NOT NULL, -- Reference to original payment transaction
    vote_sequence INTEGER NOT NULL, -- Sequence number for bulk votes (1, 2, 3, etc.)
    amount_paid DECIMAL(10,2) NOT NULL, -- Amount paid for this vote
    vote_value INTEGER DEFAULT 1, -- Always 1 vote per $2 payment
    payment_method VARCHAR(50) NOT NULL, -- 'stripe', 'crypto', 'paypal'
    is_validated BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(payment_id, vote_sequence) -- Ensure unique votes per payment
);

-- 8. Referral links table - one unique short link per user (profile display only)
CREATE TABLE referral_links (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    participant_id UUID NOT NULL REFERENCES participants(id) UNIQUE, -- One link per user
    username VARCHAR(50) NOT NULL UNIQUE, -- Short identifier (e.g., /vote/john)
    title VARCHAR(255) DEFAULT 'Vote for One Dream Initiative',
    description TEXT DEFAULT 'Help us reach our goal by sending a vote payment!',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 9. Link visits table - analytics only (does NOT affect vote counts)
CREATE TABLE link_visits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    referral_link_id UUID NOT NULL REFERENCES referral_links(id),
    visitor_ip INET,
    visitor_fingerprint VARCHAR(255),
    visitor_user_agent TEXT,
    visit_source VARCHAR(100), -- 'direct', 'social', 'email', etc.
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Global statistics table - tracks overall campaign progress
CREATE TABLE global_stats (
    id INTEGER PRIMARY KEY DEFAULT 1,
    total_votes INTEGER DEFAULT 0,
    total_participants INTEGER DEFAULT 0,
    campaign_goal INTEGER DEFAULT 1000000,
    current_stage VARCHAR(20) DEFAULT 'Bronze',
    stage_progress DECIMAL(5,2) DEFAULT 0.00,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT single_row CHECK (id = 1)
);

-- 3. Analytics events table - tracks user interactions
CREATE TABLE analytics_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    participant_id UUID REFERENCES participants(id),
    event_type VARCHAR(50) NOT NULL, -- 'vote', 'referral_click', 'milestone_reached', 'stage_upgrade'
    event_data JSONB,
    session_id VARCHAR(255),
    user_agent TEXT,
    ip_address INET,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Milestones table - defines achievement milestones
CREATE TABLE milestones (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    vote_threshold INTEGER NOT NULL,
    stage VARCHAR(20) NOT NULL,
    badge_icon VARCHAR(10),
    reward_description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Remove vote packages table (single $2 payment model)
-- Votes are now $2 each, no packages needed

-- Insert initial global stats record
INSERT INTO global_stats (id, total_votes, total_participants, campaign_goal) 
VALUES (1, 0, 0, 1000000)
ON CONFLICT (id) DO NOTHING;

-- Add data integrity constraints
ALTER TABLE payments ADD CONSTRAINT payments_amount_positive CHECK (amount > 0);

-- Remove vote packages - using simple $2 per vote model
-- Insert default milestones (based on vote count from payments only)
INSERT INTO milestones (name, description, vote_threshold, stage, badge_icon, reward_description) VALUES
('First Vote', 'Receive your first vote payment', 1, 'Bronze', '🎯', 'Welcome to the movement!'),
('Bronze Supporter', 'Reach 10 votes through payments', 10, 'Bronze', '🥉', 'Bronze stage achievement'),
('Silver Rising', 'Achieve 50 votes through supporter payments', 50, 'Silver', '🥈', 'Silver stage achievement'),
('Gold Champion', 'Reach 100 votes and become a key candidate', 100, 'Gold', '🥇', 'Gold stage achievement'),
('Diamond Legend', 'Achieve 250+ votes and join the elite', 250, 'Diamond', '💎', 'Diamond stage achievement'),
('Rising Star', 'Gain momentum with steady support', 25, 'Silver', '⭐', 'Building strong support'),
('Community Hero', 'Help reach campaign milestones', 150, 'Gold', '🏗️', 'Building the future together');

-- Create indexes for better performance
CREATE INDEX idx_participants_email ON participants(email);
CREATE INDEX idx_participants_username ON participants(username);
CREATE INDEX idx_votes_participant_id ON votes(participant_id);
CREATE INDEX idx_votes_payment_id ON votes(payment_id);
CREATE INDEX idx_votes_payment_transaction_id ON votes(payment_transaction_id);
CREATE INDEX idx_votes_created_at ON votes(created_at);
CREATE INDEX idx_payments_participant_id ON payments(participant_id);
CREATE INDEX idx_payments_transaction_id ON payments(transaction_id);
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_payments_created_at ON payments(created_at);
CREATE INDEX idx_link_visits_referral_link_id ON link_visits(referral_link_id);
CREATE INDEX idx_link_visits_created_at ON link_visits(created_at);
CREATE INDEX idx_analytics_events_participant_id ON analytics_events(participant_id);
CREATE INDEX idx_analytics_events_event_type ON analytics_events(event_type);
CREATE INDEX idx_analytics_events_created_at ON analytics_events(created_at);
CREATE INDEX idx_referral_links_participant_id ON referral_links(participant_id);
CREATE INDEX idx_referral_links_username ON referral_links(username);
CREATE INDEX idx_referral_links_is_active ON referral_links(is_active);

-- Function to generate unique username for short links
CREATE OR REPLACE FUNCTION generate_username(base_name VARCHAR(255))
RETURNS VARCHAR(50) AS $$
DECLARE
    clean_name VARCHAR(50);
    candidate VARCHAR(50);
    counter INTEGER := 0;
    exists_check INTEGER;
BEGIN
    -- Clean the name: lowercase, remove spaces/special chars, limit length
    clean_name := LOWER(REGEXP_REPLACE(COALESCE(base_name, ''), '[^a-zA-Z0-9]', '', 'g'));
    clean_name := SUBSTR(clean_name, 1, 20);
    
    -- If empty after cleaning, use 'user'
    IF clean_name = '' THEN
        clean_name := 'user';
    END IF;
    
    candidate := clean_name;
    
    LOOP
        SELECT COUNT(*) INTO exists_check 
        FROM participants 
        WHERE username = candidate;
        
        EXIT WHEN exists_check = 0;
        
        counter := counter + 1;
        candidate := clean_name || counter::TEXT;
    END LOOP;
    
    RETURN candidate;
END;
$$ LANGUAGE plpgsql;

-- Function to update participant stats when votes are added (payment-based only)
CREATE OR REPLACE FUNCTION update_participant_stats()
RETURNS TRIGGER AS $$
BEGIN
    -- Update participant's vote count and total amount (only from confirmed payments)
    UPDATE participants 
    SET 
        total_votes = total_votes + NEW.vote_value,
        total_amount = total_amount + NEW.amount_paid,
        updated_at = NOW()
    WHERE id = NEW.participant_id;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to update global stats
CREATE OR REPLACE FUNCTION update_global_stats()
RETURNS TRIGGER AS $$
DECLARE
    new_total_votes INTEGER;
    new_total_participants INTEGER;
    goal INTEGER;
    progress DECIMAL(5,2);
    new_stage VARCHAR(20);
BEGIN
    -- Get current totals (more robust with SUM and COALESCE)
    SELECT COALESCE(SUM(vote_value), 0)::INTEGER INTO new_total_votes FROM votes WHERE is_validated = TRUE;
    SELECT COUNT(*) INTO new_total_participants FROM participants;
    SELECT campaign_goal INTO goal FROM global_stats WHERE id = 1;
    
    -- Fallback if goal is NULL or 0
    IF goal IS NULL OR goal = 0 THEN
        goal := 1000000; -- fallback
    END IF;
    
    -- Calculate progress percentage
    progress := ROUND((new_total_votes::DECIMAL / goal) * 100, 2);
    
    -- Determine stage based on progress
    IF progress >= 75 THEN
        new_stage := 'Diamond';
    ELSIF progress >= 50 THEN
        new_stage := 'Gold';
    ELSIF progress >= 25 THEN
        new_stage := 'Silver';
    ELSE
        new_stage := 'Bronze';
    END IF;
    
    -- Update global stats
    UPDATE global_stats 
    SET 
        total_votes = new_total_votes,
        total_participants = new_total_participants,
        stage_progress = progress,
        current_stage = new_stage,
        last_updated = NOW()
    WHERE id = 1;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Function to update participant stage based on total votes received
CREATE OR REPLACE FUNCTION update_participant_stage()
RETURNS TRIGGER AS $$
DECLARE
    vote_count INTEGER;
    new_stage VARCHAR(20);
BEGIN
    -- Get total votes for participant
    SELECT total_votes INTO vote_count
    FROM participants 
    WHERE id = NEW.participant_id;
    
    -- Determine new stage based on confirmed payment votes
    IF vote_count >= 250 THEN
        new_stage := 'Diamond';
    ELSIF vote_count >= 100 THEN
        new_stage := 'Gold';
    ELSIF vote_count >= 50 THEN
        new_stage := 'Silver';
    ELSE
        new_stage := 'Bronze';
    END IF;
    
    -- Update participant stage if changed
    UPDATE participants 
    SET 
        current_stage = new_stage,
        updated_at = NOW()
    WHERE id = NEW.participant_id 
    AND current_stage != new_stage;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers
CREATE TRIGGER trigger_update_participant_stats
    AFTER INSERT ON votes
    FOR EACH ROW
    EXECUTE FUNCTION update_participant_stats();

CREATE TRIGGER trigger_update_global_stats
    AFTER INSERT ON votes
    FOR EACH ROW
    EXECUTE FUNCTION update_global_stats();

CREATE TRIGGER trigger_update_participant_stage
    AFTER INSERT ON votes
    FOR EACH ROW
    EXECUTE FUNCTION update_participant_stage();

-- Create trigger to auto-generate username and referral link
CREATE OR REPLACE FUNCTION auto_generate_user_data()
RETURNS TRIGGER AS $$
DECLARE
    new_username VARCHAR(50);
BEGIN
    -- Generate unique username if not provided
    IF NEW.username IS NULL OR NEW.username = '' THEN
        NEW.username := generate_username(NEW.name);
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_auto_generate_user_data
    BEFORE INSERT ON participants
    FOR EACH ROW
    EXECUTE FUNCTION auto_generate_user_data();

-- Trigger to create referral link after participant is created
CREATE OR REPLACE FUNCTION create_referral_link()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO referral_links (participant_id, username, title, description)
    VALUES (
        NEW.id,
        NEW.username,
        'Vote for ' || NEW.name || ' - One Dream Initiative',
        'Help ' || NEW.name || ' reach their goal by voting through this link!'
    );
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_create_referral_link
    AFTER INSERT ON participants
    FOR EACH ROW
    EXECUTE FUNCTION create_referral_link();

-- Function to record link visits (analytics only - no vote creation)
CREATE OR REPLACE FUNCTION record_link_visit(
    p_username VARCHAR(50),
    p_visitor_ip INET,
    p_visitor_fingerprint VARCHAR(255),
    p_visitor_user_agent TEXT,
    p_visit_source VARCHAR(100) DEFAULT 'direct'
)
RETURNS JSON AS $$
DECLARE
    link_id UUID;
    participant_id UUID;
    participant_name VARCHAR(255);
    participant_username VARCHAR(50);
    participant_total_votes INTEGER;
    participant_total_amount DECIMAL(10,2);
    participant_current_stage VARCHAR(20);
    visit_id UUID;
BEGIN
    -- Get the referral link and participant data by username
    SELECT rl.id, p.id, p.name, p.username, p.total_votes, p.total_amount, p.current_stage
    INTO link_id, participant_id, participant_name, participant_username, participant_total_votes, participant_total_amount, participant_current_stage
    FROM referral_links rl
    JOIN participants p ON rl.participant_id = p.id
    WHERE rl.username = p_username 
    AND rl.is_active = TRUE;
    
    IF NOT FOUND THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Profile not found'
        );
    END IF;
    
    -- Record the visit for analytics (no vote creation)
    INSERT INTO link_visits (referral_link_id, visitor_ip, visitor_fingerprint, visitor_user_agent, visit_source)
    VALUES (link_id, p_visitor_ip, p_visitor_fingerprint, p_visitor_user_agent, p_visit_source)
    RETURNING id INTO visit_id;
    
    RETURN json_build_object(
        'success', true,
        'visit_id', visit_id,
        'participant_id', participant_id,
        'participant_name', participant_name,
        'participant_username', participant_username,
        'total_votes', participant_total_votes,
        'total_amount', participant_total_amount,
        'current_stage', participant_current_stage,
        'message', 'Profile loaded successfully'
    );
END;
$$ LANGUAGE plpgsql;

-- 🚨 CRITICAL: Function to process confirmed vote payments ONLY
CREATE OR REPLACE FUNCTION process_vote_purchase(
    p_username VARCHAR(50),
    p_transaction_id VARCHAR(255),
    p_payment_method VARCHAR(50),
    p_amount DECIMAL(10,2),
    p_payer_email VARCHAR(255) DEFAULT NULL,
    p_payer_name VARCHAR(255) DEFAULT NULL,
    p_payment_metadata JSONB DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
    participant_record participants%ROWTYPE;
    payment_id UUID;
    vote_price DECIMAL(10,2) := 2.00; -- $2 per vote
    vote_count INTEGER;
    i INTEGER;
BEGIN
    -- Calculate how many votes based on payment amount
    -- Allow any amount that's a multiple of $2 (bulk voting allowed)
    IF p_amount < vote_price OR MOD(p_amount, vote_price) <> 0 THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Payment amount must be a multiple of $2.00 (e.g., $2, $4, $6, $10, $100, etc.)'
        );
    END IF;
    
    vote_count := (p_amount / vote_price)::INTEGER;
    
    -- Get the participant by username
    SELECT * INTO participant_record
    FROM participants
    WHERE username = p_username;
    
    IF NOT FOUND THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Participant not found'
        );
    END IF;
    
    -- Check if transaction_id already exists (prevent duplicate processing only)
    IF EXISTS(SELECT 1 FROM payments WHERE transaction_id = p_transaction_id) THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Transaction already processed'
        );
    END IF;
    
    -- Create payment record with confirmed status
    INSERT INTO payments (
        participant_id, 
        transaction_id,
        payment_method, 
        amount, 
        payer_email,
        payer_name,
        status,
        payment_metadata,
        confirmed_at
    ) VALUES (
        participant_record.id,
        p_transaction_id,
        p_payment_method,
        p_amount,
        p_payer_email,
        p_payer_name,
        'completed',
        p_payment_metadata,
        NOW()
    ) RETURNING id INTO payment_id;
    
    -- Create multiple votes for bulk payments (one vote per $2)
    FOR i IN 1..vote_count LOOP
        INSERT INTO votes (participant_id, payment_id, payment_transaction_id, vote_sequence, amount_paid, vote_value, payment_method)
        VALUES (participant_record.id, payment_id, p_transaction_id, i, vote_price, 1, p_payment_method);
    END LOOP;
    
    RETURN json_build_object(
        'success', true,
        'payment_id', payment_id,
        'participant_name', participant_record.name,
        'votes_added', vote_count,
        'amount_paid', p_amount,
        'vote_price', vote_price,
        'message', 'Successfully added ' || vote_count || ' votes for ' || participant_record.name || '!'
    );
END;
$$ LANGUAGE plpgsql;

-- 🔥 BULK VOTING: Function to process multiple votes for a participant
CREATE OR REPLACE FUNCTION process_bulk_votes(
    p_username VARCHAR(50),
    p_vote_count INTEGER,
    p_transaction_id VARCHAR(255),
    p_payment_method VARCHAR(50),
    p_payer_email VARCHAR(255) DEFAULT NULL,
    p_payer_name VARCHAR(255) DEFAULT NULL,
    p_payment_metadata JSONB DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
    vote_price DECIMAL(10,2) := 2.00;
    total_amount DECIMAL(10,2);
BEGIN
    -- Validate vote count
    IF p_vote_count < 1 THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Vote count must be at least 1'
        );
    END IF;
    
    -- Calculate total amount for bulk votes
    total_amount := p_vote_count * vote_price;
    
    -- Call the main function with calculated amount
    RETURN process_vote_purchase(
        p_username,
        p_transaction_id,
        p_payment_method,
        total_amount,
        p_payer_email,
        p_payer_name,
        p_payment_metadata
    );
END;
$$ LANGUAGE plpgsql;

-- Row Level Security (RLS) policies
ALTER TABLE participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE link_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_links ENABLE ROW LEVEL SECURITY;

-- Allow public read access to global stats and milestones
ALTER TABLE global_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE milestones ENABLE ROW LEVEL SECURITY;

-- Policies for controlled access (more secure)
CREATE POLICY "Public can view global stats" ON global_stats FOR SELECT USING (true);
CREATE POLICY "Public can view milestones" ON milestones FOR SELECT USING (true);
CREATE POLICY "Public can view participants" ON participants FOR SELECT USING (true);
CREATE POLICY "Public can insert participants" ON participants FOR INSERT WITH CHECK (true);
CREATE POLICY "Public can view votes" ON votes FOR SELECT USING (true);
-- Votes can only be inserted by authenticated payment functions
CREATE POLICY "Functions can insert votes" ON votes FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Public can view payments" ON payments FOR SELECT USING (true);
-- Payments can only be inserted by authenticated payment functions  
CREATE POLICY "Functions can insert payments" ON payments FOR INSERT WITH CHECK (auth.role() = 'service_role');
-- Analytics tables restricted to function-only inserts for better security
CREATE POLICY "Functions can insert link visits" ON link_visits FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Functions can insert analytics" ON analytics_events FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Public can view referral links" ON referral_links FOR SELECT USING (true);
CREATE POLICY "Public can insert referral links" ON referral_links FOR INSERT WITH CHECK (true);

-- Grant necessary permissions (more restrictive for security)
GRANT USAGE ON SCHEMA public TO anon, authenticated;
-- Grant SELECT access to public tables
GRANT SELECT ON participants, votes, payments, global_stats, milestones, referral_links TO anon, authenticated;
-- Grant INSERT only on participant registration
GRANT INSERT ON participants, referral_links TO anon, authenticated;
-- Grant sequence usage for participant/referral creation
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
-- Grant function execution for public functions only
GRANT EXECUTE ON FUNCTION record_link_visit TO anon, authenticated;
GRANT EXECUTE ON FUNCTION generate_username TO anon, authenticated;
-- Service role gets full access for payment processing functions
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- 🔐 SECURITY: Restrict vote purchase function to prevent abuse
-- Only authenticated users (your server) can process payments
REVOKE ALL ON FUNCTION process_vote_purchase FROM anon;
REVOKE ALL ON FUNCTION process_bulk_votes FROM anon;
GRANT EXECUTE ON FUNCTION process_vote_purchase TO authenticated;
GRANT EXECUTE ON FUNCTION process_bulk_votes TO authenticated;

-- ✅ OPTIMIZATIONS APPLIED:
-- 1. Updated votes table to use payment_transaction_id + vote_sequence (no UNIQUE constraint conflicts)
-- 2. Optimized triggers to run only on INSERT for better performance
-- 3. Fixed PL/pgSQL syntax in record_link_visit function
-- 4. Enhanced RLS security to restrict analytics table access to functions only
-- 5. Improved indexing strategy for better query performance
-- 6. Restricted permissions for better security (service_role for payment functions)

-- ✅ CRITICAL FIXES APPLIED (based on code review):
-- 7. Fixed generate_username infinite loop - renamed variable to avoid column shadowing
-- 8. Fixed decimal modulo check using MOD() instead of unsafe % operator
-- 9. Enhanced global stats with SUM(vote_value) and COALESCE for robustness
-- 10. Added CHECK constraint for positive payment amounts
-- 11. Updated RLS policies to use reliable auth.role() instead of current_setting('role')

-- Sample participants and their automatically generated referral links (optional)
-- INSERT INTO participants (name, email) VALUES
-- ('John Doe', 'john@example.com'),
-- ('Jane Smith', 'jane@example.com'),
-- ('Bob Wilson', 'bob@example.com');

-- The referral links will be automatically created by the trigger
-- Example URLs will be: /vote/johndoe, /vote/janesmith, /vote/bobwilson

COMMIT;