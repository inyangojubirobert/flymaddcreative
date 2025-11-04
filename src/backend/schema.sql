-- One Dream Initiative - Supabase Database Schema
-- This file contains the complete database structure for the voting and referral system

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ===================================
-- PARTICIPANTS TABLE
-- ===================================
CREATE TABLE participants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE,
    country VARCHAR(100),
    country_flag VARCHAR(10), -- Emoji or country code
    avatar TEXT, -- URL to avatar image
    referral_code VARCHAR(50) UNIQUE NOT NULL,
    total_votes INTEGER DEFAULT 0,
    round_votes INTEGER DEFAULT 0, -- Votes in current round
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for fast referral code lookups
CREATE INDEX idx_participants_referral_code ON participants(referral_code);
CREATE INDEX idx_participants_total_votes ON participants(total_votes DESC);
CREATE INDEX idx_participants_country ON participants(country);

-- ===================================
-- VOTES TABLE
-- ===================================
CREATE TABLE votes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    referral_code VARCHAR(50) NOT NULL,
    ip_address INET,
    user_agent TEXT,
    vote_value DECIMAL(10,2) DEFAULT 2.00, -- $2 per vote
    session_id VARCHAR(100), -- For session tracking
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_votes_participant_id ON votes(participant_id);
CREATE INDEX idx_votes_referral_code ON votes(referral_code);
CREATE INDEX idx_votes_ip_address ON votes(ip_address);
CREATE INDEX idx_votes_created_at ON votes(created_at DESC);

-- Prevent duplicate votes from same IP within 24 hours
CREATE UNIQUE INDEX idx_votes_ip_referral_daily ON votes(
    ip_address, 
    referral_code, 
    DATE(created_at)
);

-- ===================================
-- GLOBAL STATS TABLE
-- ===================================
CREATE TABLE global_stats (
    id INTEGER PRIMARY KEY DEFAULT 1,
    total_votes INTEGER DEFAULT 0,
    total_participants INTEGER DEFAULT 0,
    total_value DECIMAL(15,2) DEFAULT 0.00,
    goal_votes INTEGER DEFAULT 1000000,
    current_stage VARCHAR(20) DEFAULT 'bronze', -- bronze, silver, gold, diamond
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure only one row exists
    CONSTRAINT single_row CHECK (id = 1)
);

-- Insert initial row
INSERT INTO global_stats (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ===================================
-- ANALYTICS EVENTS TABLE
-- ===================================
CREATE TABLE analytics_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_name VARCHAR(100) NOT NULL,
    event_data JSONB,
    participant_id UUID REFERENCES participants(id),
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for analytics queries
CREATE INDEX idx_analytics_event_name ON analytics_events(event_name);
CREATE INDEX idx_analytics_created_at ON analytics_events(created_at DESC);
CREATE INDEX idx_analytics_participant_id ON analytics_events(participant_id);

-- ===================================
-- MILESTONES TABLE
-- ===================================
CREATE TABLE milestones (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    vote_threshold INTEGER NOT NULL,
    reward_amount DECIMAL(10,2) NOT NULL,
    badge_emoji VARCHAR(10),
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default milestones
INSERT INTO milestones (name, vote_threshold, reward_amount, badge_emoji, description) VALUES
('Seedling', 100, 200.00, '🌱', 'First milestone - growing your dream'),
('Sprout', 500, 1000.00, '🌿', 'Building momentum and support'),
('Growing Tree', 1000, 2000.00, '🌳', 'Establishing strong roots'),
('Champion', 5000, 10000.00, '🏆', 'Leading the community'),
('Dream King/Queen', 10000, 20000.00, '👑', 'Ultimate achievement');

-- ===================================
-- USER ACHIEVEMENTS TABLE
-- ===================================
CREATE TABLE user_achievements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    milestone_id INTEGER NOT NULL REFERENCES milestones(id),
    achieved_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Prevent duplicate achievements
    UNIQUE(participant_id, milestone_id)
);

-- ===================================
-- FUNCTIONS AND TRIGGERS
-- ===================================

-- Function to update participant vote count
CREATE OR REPLACE FUNCTION increment_participant_votes(
    participant_id UUID,
    increment_amount INTEGER DEFAULT 1
)
RETURNS VOID AS $$
BEGIN
    UPDATE participants 
    SET 
        total_votes = total_votes + increment_amount,
        round_votes = round_votes + increment_amount,
        updated_at = NOW()
    WHERE id = participant_id;
END;
$$ LANGUAGE plpgsql;

-- Function to update global statistics
CREATE OR REPLACE FUNCTION update_global_stats()
RETURNS VOID AS $$
DECLARE
    total_vote_count INTEGER;
    total_participant_count INTEGER;
    total_vote_value DECIMAL(15,2);
    progress_percentage DECIMAL(5,2);
    new_stage VARCHAR(20);
BEGIN
    -- Calculate totals
    SELECT 
        COALESCE(SUM(total_votes), 0),
        COUNT(*),
        COALESCE(SUM(total_votes * 2.00), 0)
    INTO total_vote_count, total_participant_count, total_vote_value
    FROM participants 
    WHERE is_active = true;
    
    -- Calculate progress percentage
    progress_percentage := (total_vote_count::DECIMAL / 1000000) * 100;
    
    -- Determine stage
    CASE 
        WHEN progress_percentage >= 76 THEN new_stage := 'diamond';
        WHEN progress_percentage >= 51 THEN new_stage := 'gold';
        WHEN progress_percentage >= 26 THEN new_stage := 'silver';
        ELSE new_stage := 'bronze';
    END CASE;
    
    -- Update global stats
    UPDATE global_stats SET
        total_votes = total_vote_count,
        total_participants = total_participant_count,
        total_value = total_vote_value,
        current_stage = new_stage,
        last_updated = NOW()
    WHERE id = 1;
END;
$$ LANGUAGE plpgsql;

-- Function to check and award milestones
CREATE OR REPLACE FUNCTION check_milestones(participant_id UUID)
RETURNS VOID AS $$
DECLARE
    participant_votes INTEGER;
    milestone_record RECORD;
BEGIN
    -- Get participant's current vote count
    SELECT total_votes INTO participant_votes
    FROM participants
    WHERE id = participant_id;
    
    -- Check for new milestones
    FOR milestone_record IN 
        SELECT m.id, m.vote_threshold
        FROM milestones m
        WHERE m.vote_threshold <= participant_votes
        AND m.is_active = true
        AND NOT EXISTS (
            SELECT 1 FROM user_achievements ua
            WHERE ua.participant_id = check_milestones.participant_id
            AND ua.milestone_id = m.id
        )
    LOOP
        -- Award the milestone
        INSERT INTO user_achievements (participant_id, milestone_id)
        VALUES (participant_id, milestone_record.id);
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update global stats when votes change
CREATE OR REPLACE FUNCTION trigger_update_global_stats()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM update_global_stats();
    
    -- Check milestones for the participant
    IF TG_OP = 'INSERT' THEN
        PERFORM check_milestones(NEW.participant_id);
    END IF;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER votes_update_stats
    AFTER INSERT OR UPDATE OR DELETE ON votes
    FOR EACH ROW EXECUTE FUNCTION trigger_update_global_stats();

-- Trigger to update participant updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER participants_updated_at
    BEFORE UPDATE ON participants
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ===================================
-- VIEWS FOR COMMON QUERIES
-- ===================================

-- Leaderboard view
CREATE VIEW leaderboard AS
SELECT 
    p.id,
    p.name,
    p.country,
    p.country_flag,
    p.avatar,
    p.total_votes,
    p.round_votes,
    RANK() OVER (ORDER BY p.total_votes DESC) as rank,
    ROUND((p.total_votes::DECIMAL / NULLIF(MAX(p.total_votes) OVER (), 0)) * 100, 2) as progress_percentage
FROM participants p
WHERE p.is_active = true
ORDER BY p.total_votes DESC;

-- User stats view with achievements
CREATE VIEW user_stats AS
SELECT 
    p.id,
    p.name,
    p.total_votes,
    p.round_votes,
    p.total_votes * 2.00 as total_earnings,
    COUNT(v.id) FILTER (WHERE v.created_at >= CURRENT_DATE) as today_votes,
    COUNT(v.id) FILTER (WHERE v.created_at >= CURRENT_DATE - INTERVAL '7 days') as weekly_votes,
    COUNT(ua.id) as achievements_count,
    ARRAY_AGG(
        CASE WHEN ua.id IS NOT NULL THEN
            JSON_BUILD_OBJECT(
                'name', m.name,
                'badge', m.badge_emoji,
                'achieved_at', ua.achieved_at
            )
        END
    ) FILTER (WHERE ua.id IS NOT NULL) as achievements
FROM participants p
LEFT JOIN votes v ON p.id = v.participant_id
LEFT JOIN user_achievements ua ON p.id = ua.participant_id
LEFT JOIN milestones m ON ua.milestone_id = m.id
WHERE p.is_active = true
GROUP BY p.id, p.name, p.total_votes, p.round_votes;

-- ===================================
-- ROW LEVEL SECURITY (RLS)
-- ===================================

-- Enable RLS on sensitive tables
ALTER TABLE participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;

-- Policy for public read access to participants (for leaderboard)
CREATE POLICY "Public read access to participants" ON participants
    FOR SELECT USING (true);

-- Policy for public read access to global stats
CREATE POLICY "Public read access to global stats" ON global_stats
    FOR SELECT USING (true);

-- Policy for authenticated users to read their own data
CREATE POLICY "Users can read own data" ON participants
    FOR ALL USING (auth.uid()::text = id::text);

-- ===================================
-- INITIAL DATA
-- ===================================

-- Insert some sample participants for testing
INSERT INTO participants (name, email, country, country_flag, referral_code) VALUES
('Alice Johnson', 'alice@example.com', 'United States', '🇺🇸', 'alice123'),
('Bob Smith', 'bob@example.com', 'Canada', '🇨🇦', 'bob456'),
('Chen Wei', 'chen@example.com', 'China', '🇨🇳', 'chen789'),
('Diana Prince', 'diana@example.com', 'United Kingdom', '🇬🇧', 'diana012'),
('Eduardo Silva', 'eduardo@example.com', 'Brazil', '🇧🇷', 'eduardo345');