// pages/api/merchantRoutes.js
import { createRouter } from 'next-connect';
import bcrypt from 'bcryptjs';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

// Initialize Supabase admin client (server-side only)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Helper: ensure the referral_merchants table has a password_hash column.
// Some deployments may have an older schema that lacks this column.
let _passwordHashColumnEnsured = false;
async function ensurePasswordHashColumn() {
  if (_passwordHashColumnEnsured) return;

  const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    throw new Error('Missing DATABASE_URL / SUPABASE_DB_URL for schema migration.');
  }

  const client = new pg.Client({ connectionString });
  await client.connect();

  try {
    const { rows } = await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'referral_merchants' AND column_name = 'password_hash'`
    );

    if (rows.length === 0) {
      await client.query(`ALTER TABLE public.referral_merchants ADD COLUMN IF NOT EXISTS password_hash text;`);
    }

    _passwordHashColumnEnsured = true;
  } finally {
    await client.end();
  }
}

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

const router = createRouter();

// Helper to generate JWT (if using JWT)
// import jwt from 'jsonwebtoken'; // Uncomment if using JWT

// ==================== MERCHANT REGISTRATION ====================
router.post('/api/merchants/register', async (req, res) => {
    try {
        const { merchant_name, email, company_name, wallet_address, password } = req.body;
        
        // Validation
        if (!merchant_name || !email || !password) {
            return res.status(400).json({ 
                success: false, 
                message: 'Missing required fields' 
            });
        }

        // Email format validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid email format' 
            });
        }

        // Password strength validation
        if (password.length < 8) {
            return res.status(400).json({ 
                success: false, 
                message: 'Password must be at least 8 characters' 
            });
        }

        // Check if email already exists
        const { data: existingMerchant, error: checkError } = await supabase
            .from('referral_merchants')
            .select('id')
            .eq('email', email.toLowerCase().trim())
            .single();

        if (existingMerchant) {
            return res.status(409).json({ 
                success: false, 
                message: 'Email already registered' 
            });
        }

        // Ensure the schema has a password_hash column (fixes misconfigured deployments)
        try {
            await ensurePasswordHashColumn();
        } catch (err) {
            console.error('Failed to ensure password_hash column exists:', err);
            return res.status(500).json({ 
                success: false, 
                message: 'Server misconfiguration: unable to ensure merchant password storage is configured.' 
            });
        }

        // Hash password
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);
        
        // Insert merchant
        const { data: merchant, error: insertError } = await supabase
            .from('referral_merchants')
            .insert({
                merchant_name: merchant_name.trim(),
                email: email.toLowerCase().trim(),
                company_name: company_name?.trim() || null,
                wallet_address: wallet_address?.trim() || null,
                password_hash: passwordHash
            })
            .select('id, merchant_name, email, company_name, wallet_address, total_tokens_earned, available_tokens, status, created_at')
            .single();

        if (insertError) {
            console.error('Supabase insert error:', insertError);

            // If the database schema does not include a password_hash, supply a clear error
            if (insertError.message && insertError.message.includes('password_hash')) {
                return res.status(500).json({ 
                    success: false, 
                    message: 'Server misconfiguration: merchant password storage is not set up. Please add a password_hash column to referral_merchants.' 
                });
            }

            // Check for duplicate email error
            if (insertError.code === '23505' && insertError.message.includes('email')) {
                return res.status(409).json({ 
                    success: false, 
                    message: 'Email already registered' 
                });
            }

            throw insertError;
        }

        // Get the auto-generated referral link (created by trigger)
        const { data: referralLink, error: linkError } = await supabase
            .from('merchant_referral_links')
            .select('id, link_code, full_link, is_active')
            .eq('merchant_id', merchant.id)
            .single();

        if (linkError) {
            console.error('Error fetching referral link:', linkError);
        }

        // Generate token for authentication (optional)
        // const token = jwt.sign(
        //     { id: merchant.id, email: merchant.email, type: 'merchant' },
        //     process.env.JWT_SECRET,
        //     { expiresIn: '7d' }
        // );

        res.status(201).json({
            success: true,
            message: 'Merchant registered successfully',
            merchant: {
                id: merchant.id,
                merchant_name: merchant.merchant_name,
                email: merchant.email,
                company_name: merchant.company_name,
                wallet_address: merchant.wallet_address,
                total_tokens_earned: merchant.total_tokens_earned,
                available_tokens: merchant.available_tokens,
                status: merchant.status,
                created_at: merchant.created_at
            },
            referral_link: referralLink || null
            // token: token // Uncomment if using JWT
        });
        
    } catch (error) {
        console.error('Merchant registration error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Internal server error' 
        });
    }
});

// ==================== MERCHANT LOGIN ====================
router.post('/api/merchants/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email and password required' 
            });
        }

        // Ensure the schema has a password_hash column (fixes misconfigured deployments)
        try {
            await ensurePasswordHashColumn();
        } catch (err) {
            console.error('Failed to ensure password_hash column exists:', err);
            return res.status(500).json({ 
                success: false, 
                message: 'Server misconfiguration: unable to ensure merchant password storage is configured.' 
            });
        }
        
        // Get merchant with password hash
        const { data: merchant, error } = await supabase
            .from('referral_merchants')
            .select('*')
            .eq('email', email.toLowerCase().trim())
            .single();

        if (error || !merchant) {
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid credentials' 
            });
        }
        
        // Check if account is active
        if (merchant.status !== 'active') {
            return res.status(403).json({ 
                success: false, 
                message: 'Account is not active. Please contact support.' 
            });
        }
        
        // Ensure password hash exists
        if (!merchant.password_hash) {
            console.error('Merchant login failed: missing password_hash for merchant', merchant.id);
            return res.status(500).json({ 
                success: false, 
                message: 'Merchant account not fully configured. Please contact support.' 
            });
        }

        // Verify password
        const validPassword = await bcrypt.compare(password, merchant.password_hash);
        
        if (!validPassword) {
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid credentials' 
            });
        }
        
        // Get merchant's referral links
        const { data: referralLinks, error: linksError } = await supabase
            .from('merchant_referral_links')
            .select('id, link_code, full_link, description, is_active, clicks_count, registrations_count, created_at')
            .eq('merchant_id', merchant.id)
            .order('created_at', { ascending: false });

        // Remove password hash from response
        const { password_hash, ...safeMerchant } = merchant;
        
        // Generate token (optional)
        // const token = jwt.sign(
        //     { id: merchant.id, email: merchant.email, type: 'merchant' },
        //     process.env.JWT_SECRET,
        //     { expiresIn: '7d' }
        // );
        
        res.json({
            success: true,
            message: 'Login successful',
            merchant: safeMerchant,
            referral_links: referralLinks || []
            // token: token // Uncomment if using JWT
        });
        
    } catch (error) {
        console.error('Merchant login error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Internal server error' 
        });
    }
});

// ==================== GET MERCHANT DASHBOARD ====================
router.get('/api/merchants/:id/dashboard', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Get merchant basic info
        const { data: merchant, error: merchantError } = await supabase
            .from('referral_merchants')
            .select('id, merchant_name, email, company_name, wallet_address, total_tokens_earned, available_tokens, status, created_at')
            .eq('id', id)
            .single();

        if (merchantError || !merchant) {
            return res.status(404).json({ 
                success: false, 
                message: 'Merchant not found' 
            });
        }
        
        // Get all referral links with stats
        const { data: referralLinks, error: linksError } = await supabase
            .from('merchant_referral_links')
            .select(`
                id, 
                link_code, 
                full_link, 
                description, 
                is_active, 
                clicks_count, 
                registrations_count,
                created_at,
                expires_at
            `)
            .eq('merchant_id', id)
            .order('created_at', { ascending: false });

        // Get recent referrals with vote status
        const { data: referrals, error: referralsError } = await supabase
            .from('participants')
            .select(`
                id,
                name,
                email,
                created_at,
                referred_by_merchant_link_id,
                merchant_referral_links!inner (
                    id,
                    link_code,
                    merchant_id
                ),
                merchant_referral_rewards (
                    id,
                    tokens_awarded,
                    status,
                    created_at,
                    paid_at,
                    vote_id,
                    crypto_votes!inner (
                        id,
                        status,
                        created_at as vote_date,
                        confirmed_at
                    )
                )
            `)
            .eq('merchant_referral_links.merchant_id', id)
            .order('created_at', { ascending: false })
            .limit(50);

        // Calculate stats
        const totalReferrals = referrals?.length || 0;
        const totalVotes = referrals?.filter(r => 
            r.merchant_referral_rewards && 
            r.merchant_referral_rewards.length > 0
        ).length || 0;
        
        const pendingVotes = referrals?.filter(r => {
            const reward = r.merchant_referral_rewards?.[0];
            return reward && reward.status === 'pending';
        }).length || 0;
        
        const completedVotes = referrals?.filter(r => {
            const reward = r.merchant_referral_rewards?.[0];
            return reward && reward.status === 'paid';
        }).length || 0;

        const totalClicks = referralLinks?.reduce((sum, link) => sum + (link.clicks_count || 0), 0) || 0;
        const conversionRate = totalClicks > 0 
            ? Math.round((totalReferrals / totalClicks) * 100) 
            : 0;

        // Calculate pending tokens
        const pendingTokens = referrals?.reduce((sum, r) => {
            const reward = r.merchant_referral_rewards?.[0];
            if (reward && reward.status === 'pending') {
                return sum + (reward.tokens_awarded || 0);
            }
            return sum;
        }, 0) || 0;

        // Format recent activity
        const recentActivity = referrals?.slice(0, 20).map(ref => ({
            participant: {
                id: ref.id,
                name: ref.name,
                email: ref.email
            },
            registered_date: ref.created_at,
            link_used: ref.merchant_referral_links?.link_code,
            vote: ref.merchant_referral_rewards?.[0]?.crypto_votes ? {
                status: ref.merchant_referral_rewards[0].crypto_votes.status,
                date: ref.merchant_referral_rewards[0].crypto_votes.vote_date,
                confirmed_at: ref.merchant_referral_rewards[0].crypto_votes.confirmed_at
            } : null,
            reward: ref.merchant_referral_rewards?.[0] ? {
                id: ref.merchant_referral_rewards[0].id,
                tokens: ref.merchant_referral_rewards[0].tokens_awarded,
                status: ref.merchant_referral_rewards[0].status,
                created_at: ref.merchant_referral_rewards[0].created_at,
                paid_at: ref.merchant_referral_rewards[0].paid_at
            } : null
        })) || [];

        res.json({
            success: true,
            merchant,
            stats: {
                total_referrals: totalReferrals,
                total_votes: totalVotes,
                pending_votes: pendingVotes,
                completed_votes: completedVotes,
                total_clicks: totalClicks,
                conversion_rate: conversionRate,
                total_tokens_earned: merchant.total_tokens_earned || 0,
                available_tokens: merchant.available_tokens || 0,
                pending_tokens: pendingTokens
            },
            referral_links: referralLinks || [],
            recent_activity: recentActivity
        });
        
    } catch (error) {
        console.error('Dashboard fetch error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Internal server error' 
        });
    }
});

// ==================== CREATE NEW REFERRAL LINK ====================
router.post('/api/merchants/:id/links', async (req, res) => {
    try {
        const { id } = req.params;
        const { description } = req.body;
        
        // Verify merchant exists and is active
        const { data: merchant, error: merchantError } = await supabase
            .from('referral_merchants')
            .select('id, merchant_name, status')
            .eq('id', id)
            .eq('status', 'active')
            .single();

        if (merchantError || !merchant) {
            return res.status(404).json({ 
                success: false, 
                message: 'Merchant not found or inactive' 
            });
        }
        
        // Generate unique link code
        const baseUrl = process.env.BASE_URL || 'https://yourwebsite.com';
        const uniqueCode = 'MERCH-' + 
            Math.random().toString(36).substring(2, 10).toUpperCase() + 
            Math.random().toString(36).substring(2, 4).toUpperCase();
        
        const fullLink = `${baseUrl}/register?ref=${uniqueCode}`;
        
        // Insert new link
        const { data: link, error: insertError } = await supabase
            .from('merchant_referral_links')
            .insert({
                merchant_id: id,
                link_code: uniqueCode,
                full_link: fullLink,
                description: description?.trim() || `Referral link for ${merchant.merchant_name}`,
                is_active: true
            })
            .select('id, link_code, full_link, description, is_active, created_at')
            .single();

        if (insertError) {
            throw insertError;
        }
        
        res.status(201).json({
            success: true,
            message: 'Referral link created successfully',
            link
        });
        
    } catch (error) {
        console.error('Create link error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Internal server error' 
        });
    }
});

// ==================== UPDATE LINK STATUS ====================
router.patch('/api/merchants/links/:linkId', async (req, res) => {
    try {
        const { linkId } = req.params;
        const { is_active } = req.body;
        
        if (typeof is_active !== 'boolean') {
            return res.status(400).json({ 
                success: false, 
                message: 'is_active must be a boolean' 
            });
        }
        
        const { data: link, error } = await supabase
            .from('merchant_referral_links')
            .update({ is_active })
            .eq('id', linkId)
            .select('id, link_code, is_active')
            .single();

        if (error || !link) {
            return res.status(404).json({ 
                success: false, 
                message: 'Link not found' 
            });
        }
        
        res.json({
            success: true,
            message: `Link ${is_active ? 'activated' : 'deactivated'} successfully`,
            link
        });
        
    } catch (error) {
        console.error('Update link error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Internal server error' 
        });
    }
});

// ==================== GET LINK STATS ====================
router.get('/api/merchants/links/:linkId/stats', async (req, res) => {
    try {
        const { linkId } = req.params;
        
        // Get link info
        const { data: link, error: linkError } = await supabase
            .from('merchant_referral_links')
            .select('*')
            .eq('id', linkId)
            .single();

        if (linkError || !link) {
            return res.status(404).json({ 
                success: false, 
                message: 'Link not found' 
            });
        }
        
        // Get participants from this link
        const { data: participants, error: participantsError } = await supabase
            .from('participants')
            .select(`
                id,
                created_at,
                merchant_referral_rewards (
                    id,
                    tokens_awarded,
                    status,
                    crypto_votes (
                        id,
                        status,
                        created_at
                    )
                )
            `)
            .eq('referred_by_merchant_link_id', linkId);

        const registrations = participants?.length || 0;
        const confirmedVotes = participants?.filter(p => 
            p.merchant_referral_rewards && 
            p.merchant_referral_rewards[0]?.crypto_votes?.status === 'confirmed'
        ).length || 0;
        
        const totalTokens = participants?.reduce((sum, p) => {
            if (p.merchant_referral_rewards && p.merchant_referral_rewards[0]) {
                return sum + (p.merchant_referral_rewards[0].tokens_awarded || 0);
            }
            return sum;
        }, 0) || 0;
        
        res.json({
            success: true,
            stats: {
                ...link,
                actual_registrations: registrations,
                confirmed_votes: confirmedVotes,
                total_tokens_earned: totalTokens,
                click_to_registration_rate: link.clicks_count > 0 
                    ? Number(((registrations / link.clicks_count) * 100).toFixed(2))
                    : 0,
                registration_to_vote_rate: registrations > 0
                    ? Number(((confirmedVotes / registrations) * 100).toFixed(2))
                    : 0
            }
        });
        
    } catch (error) {
        console.error('Link stats error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Internal server error' 
        });
    }
});

// ==================== REQUEST WITHDRAWAL ====================
router.post('/api/merchants/:id/withdraw', async (req, res) => {
    try {
        const { id } = req.params;
        const { amount, wallet_address } = req.body;
        
        // Validation
        if (!amount || amount < 50) {
            return res.status(400).json({ 
                success: false, 
                message: 'Minimum withdrawal is 50 tokens' 
            });
        }
        
        // Get merchant's current balance
        const { data: merchant, error: fetchError } = await supabase
            .from('referral_merchants')
            .select('available_tokens, wallet_address')
            .eq('id', id)
            .single();

        if (fetchError || !merchant) {
            return res.status(404).json({ 
                success: false, 
                message: 'Merchant not found' 
            });
        }
        
        if (merchant.available_tokens < amount) {
            return res.status(400).json({ 
                success: false, 
                message: 'Insufficient balance' 
            });
        }
        
        // Update merchant's balance
        const { error: updateError } = await supabase
            .from('referral_merchants')
            .update({ 
                available_tokens: merchant.available_tokens - amount,
                updated_at: new Date().toISOString()
            })
            .eq('id', id);

        if (updateError) {
            throw updateError;
        }
        
        // Mark some pending rewards as processing
        const { error: rewardsError } = await supabase
            .from('merchant_referral_rewards')
            .update({ status: 'processing' })
            .eq('merchant_id', id)
            .eq('status', 'pending')
            .limit(Math.ceil(amount / 50)); // Assuming 50 tokens per reward

        if (rewardsError) {
            console.error('Error updating rewards:', rewardsError);
        }
        
        res.json({
            success: true,
            message: 'Withdrawal request submitted successfully',
            withdrawal: {
                amount,
                wallet: wallet_address || merchant.wallet_address,
                status: 'processing',
                estimated_completion: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
            }
        });
        
    } catch (error) {
        console.error('Withdrawal error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Internal server error' 
        });
    }
});

// ==================== UPDATE MERCHANT PROFILE ====================
router.patch('/api/merchants/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { merchant_name, company_name, wallet_address } = req.body;
        
        const updates = {};
        if (merchant_name) updates.merchant_name = merchant_name.trim();
        if (company_name !== undefined) updates.company_name = company_name?.trim() || null;
        if (wallet_address !== undefined) updates.wallet_address = wallet_address?.trim() || null;
        updates.updated_at = new Date().toISOString();
        
        if (Object.keys(updates).length === 1) { // Only updated_at
            return res.status(400).json({ 
                success: false, 
                message: 'No fields to update' 
            });
        }
        
        const { data: merchant, error } = await supabase
            .from('referral_merchants')
            .update(updates)
            .eq('id', id)
            .select('id, merchant_name, email, company_name, wallet_address, updated_at')
            .single();

        if (error || !merchant) {
            return res.status(404).json({ 
                success: false, 
                message: 'Merchant not found' 
            });
        }
        
        res.json({
            success: true,
            message: 'Profile updated successfully',
            merchant
        });
        
    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Internal server error' 
        });
    }
});

// ==================== TRACK LINK CLICK ====================
router.post('/api/track/click', async (req, res) => {
    try {
        const { link_code } = req.body;
        
        if (!link_code) {
            return res.status(400).json({ 
                success: false, 
                message: 'Link code required' 
            });
        }
        
        // Increment click count
        const { error } = await supabase.rpc('increment_link_clicks', {
            link_code_param: link_code
        });

        if (error) {
            // Fallback direct update
            await supabase
                .from('merchant_referral_links')
                .update({ clicks_count: supabase.raw('clicks_count + 1') })
                .eq('link_code', link_code);
        }
        
        res.json({ success: true });
        
    } catch (error) {
        console.error('Track click error:', error);
        res.status(500).json({ success: false });
    }
});

// ==================== GET MERCHANT BY TOKEN ====================
router.get('/api/merchants/me', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return res.status(401).json({ 
                success: false, 
                message: 'No token provided' 
            });
        }

        const token = authHeader.split(' ')[1];
        
        // Verify token (if using JWT)
        // const decoded = jwt.verify(token, process.env.JWT_SECRET);
        // const { data: merchant, error } = await supabase
        //     .from('referral_merchants')
        //     .select('id, merchant_name, email, company_name, wallet_address, total_tokens_earned, available_tokens, status')
        //     .eq('id', decoded.id)
        //     .single();

        // For now, return unauthorized
        res.status(401).json({ 
            success: false, 
            message: 'Authentication required' 
        });
        
    } catch (error) {
        console.error('Get merchant error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Internal server error' 
        });
    }
});

export default router.handler({
    onError: (err, req, res) => {
        console.error('API Error:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Internal server error' 
        });
    },
    onNoMatch: (req, res) => {
        res.status(404).json({ 
            success: false, 
            message: 'Route not found' 
        });
    }
});