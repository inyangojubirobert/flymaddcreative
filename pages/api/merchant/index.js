// pages/api/merchants/index.js
import { createRouter } from 'next-connect';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase admin client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const jwtSecret = process.env.JWT_SECRET || 'onedream_secret_2024';

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

const router = createRouter();

// ==================== MIDDLEWARE ====================
router.use((req, res, next) => {
  console.log(`[API] ${req.method} ${req.url}`);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

// ==================== HEALTH CHECK ====================
router.get('/health', (req, res) => {
  res.status(200).json({ 
    success: true, 
    message: 'Merchant API is running',
    timestamp: new Date().toISOString()
  });
});

// ==================== MERCHANT REGISTRATION ====================
router.post('/register', async (req, res) => {
  try {
    const { merchant_name, email, company_name, wallet_address, password } = req.body;
    
    // Validation
    if (!merchant_name?.trim() || !email?.trim() || !password) {
      return res.status(400).json({ 
        success: false, 
        error: 'Merchant name, email and password are required' 
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid email format' 
      });
    }

    if (password.length < 8) {
      return res.status(400).json({ 
        success: false, 
        error: 'Password must be at least 8 characters' 
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check if email already exists
    const { data: existingMerchant } = await supabase
      .from('referral_merchants')
      .select('id')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (existingMerchant) {
      return res.status(409).json({ 
        success: false, 
        error: 'Email already registered' 
      });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);
    
    // Insert merchant
    const { data: merchant, error: insertError } = await supabase
      .from('referral_merchants')
      .insert({
        merchant_name: merchant_name.trim(),
        email: normalizedEmail,
        company_name: company_name?.trim() || null,
        wallet_address: wallet_address?.trim() || null,
        password_hash: passwordHash,
        total_tokens_earned: 0,
        available_tokens: 0,
        status: 'active'
      })
      .select('id, merchant_name, email, company_name, wallet_address, total_tokens_earned, available_tokens, status, created_at')
      .single();

    if (insertError) {
      console.error('Insert error:', insertError);
      
      if (insertError.code === '23505') {
        return res.status(409).json({ 
          success: false, 
          error: 'Email already registered' 
        });
      }
      
      if (insertError.message?.includes('password_hash')) {
        return res.status(500).json({ 
          success: false, 
          error: 'Server configuration error. Please contact support.' 
        });
      }
      
      throw insertError;
    }

    // Wait for trigger to create referral link
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Get referral link
    const { data: referralLink } = await supabase
      .from('merchant_referral_links')
      .select('link_code, full_link, is_active')
      .eq('merchant_id', merchant.id)
      .maybeSingle();

    // Generate JWT token
    const token = jwt.sign(
      { 
        id: merchant.id, 
        email: merchant.email,
        type: 'merchant' 
      },
      jwtSecret,
      { expiresIn: '7d' }
    );

    // Return success response
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
        created_at: merchant.created_at,
        token,
        referral_link: referralLink?.full_link || null,
        link_code: referralLink?.link_code || null
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Registration failed. Please try again.' 
    });
  }
});

// ==================== MERCHANT LOGIN ====================
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email?.trim() || !password) {
      return res.status(400).json({ 
        success: false, 
        error: 'Email and password are required' 
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Get merchant with password hash
    const { data: merchant, error } = await supabase
      .from('referral_merchants')
      .select('*')
      .eq('email', normalizedEmail)
      .single();

    if (error || !merchant) {
      return res.status(401).json({ 
        success: false, 
        error: 'Invalid email or password' 
      });
    }

    // Check if account is active
    if (merchant.status !== 'active') {
      return res.status(403).json({ 
        success: false, 
        error: 'Account is not active. Please contact support.' 
      });
    }
    
    // Verify password
    const validPassword = await bcrypt.compare(password, merchant.password_hash);
    
    if (!validPassword) {
      return res.status(401).json({ 
        success: false, 
        error: 'Invalid email or password' 
      });
    }
    
    // Get merchant's referral links
    const { data: referralLinks } = await supabase
      .from('merchant_referral_links')
      .select('id, link_code, full_link, description, is_active, clicks_count, registrations_count, created_at')
      .eq('merchant_id', merchant.id)
      .order('created_at', { ascending: false });

    // Generate JWT token
    const token = jwt.sign(
      { 
        id: merchant.id, 
        email: merchant.email,
        type: 'merchant' 
      },
      jwtSecret,
      { expiresIn: '7d' }
    );

    // Remove password hash from response
    const { password_hash, ...safeMerchant } = merchant;
    
    res.json({
      success: true,
      message: 'Login successful',
      merchant: {
        ...safeMerchant,
        token
      },
      referral_links: referralLinks || []
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Login failed. Please try again.' 
    });
  }
});

// ==================== GET MERCHANT DASHBOARD ====================
router.get('/:id/dashboard', async (req, res) => {
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
        error: 'Merchant not found' 
      });
    }
    
    // Get all referral links with stats
    const { data: referralLinks } = await supabase
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
    const { data: referrals } = await supabase
      .from('participants')
      .select(`
        id,
        name,
        email,
        created_at,
        referred_by_merchant_link_id,
        merchant_referral_links!inner (
          link_code,
          merchant_id
        ),
        merchant_referral_rewards (
          tokens_awarded,
          status,
          created_at,
          paid_at,
          vote_id,
          crypto_votes (
            status,
            created_at,
            confirmed_at
          )
        )
      `)
      .eq('merchant_referral_links.merchant_id', id)
      .order('created_at', { ascending: false })
      .limit(50);

    // Calculate stats
    const totalReferrals = referrals?.length || 0;
    const totalVotes = referrals?.filter(r => r.merchant_referral_rewards?.length > 0).length || 0;
    const pendingVotes = referrals?.filter(r => r.merchant_referral_rewards?.[0]?.status === 'pending').length || 0;
    const completedVotes = referrals?.filter(r => r.merchant_referral_rewards?.[0]?.status === 'paid').length || 0;
    const totalClicks = referralLinks?.reduce((sum, link) => sum + (link.clicks_count || 0), 0) || 0;
    const conversionRate = totalClicks > 0 ? Math.round((totalReferrals / totalClicks) * 100) : 0;
    
    const pendingTokens = referrals?.reduce((sum, r) => {
      if (r.merchant_referral_rewards?.[0]?.status === 'pending') {
        return sum + (r.merchant_referral_rewards[0].tokens_awarded || 0);
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
        date: ref.merchant_referral_rewards[0].crypto_votes.created_at,
        confirmed_at: ref.merchant_referral_rewards[0].crypto_votes.confirmed_at
      } : null,
      reward: ref.merchant_referral_rewards?.[0] ? {
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
    console.error('Dashboard error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to load dashboard' 
    });
  }
});

// ==================== CREATE REFERRAL LINK ====================
router.post('/:id/links', async (req, res) => {
  try {
    const { id } = req.params;
    const { description } = req.body;
    
    // Verify merchant exists
    const { data: merchant } = await supabase
      .from('referral_merchants')
      .select('merchant_name')
      .eq('id', id)
      .single();

    if (!merchant) {
      return res.status(404).json({ 
        success: false, 
        error: 'Merchant not found' 
      });
    }
    
    // Generate unique link code
    const baseUrl = process.env.BASE_URL || 'https://flymaddcreative.online';
    const uniqueCode = 'MERCH-' + Math.random().toString(36).substring(2, 10).toUpperCase();
    const fullLink = `${baseUrl}/register?ref=${uniqueCode}`;
    
    // Insert new link
    const { data: link, error } = await supabase
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

    if (error) throw error;
    
    res.status(201).json({
      success: true,
      message: 'Referral link created',
      link
    });
    
  } catch (error) {
    console.error('Create link error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to create link' 
    });
  }
});

// ==================== UPDATE LINK STATUS ====================
router.patch('/links/:linkId', async (req, res) => {
  try {
    const { linkId } = req.params;
    const { is_active } = req.body;
    
    if (typeof is_active !== 'boolean') {
      return res.status(400).json({ 
        success: false, 
        error: 'is_active must be a boolean' 
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
        error: 'Link not found' 
      });
    }
    
    res.json({
      success: true,
      message: `Link ${is_active ? 'activated' : 'deactivated'}`,
      link
    });
    
  } catch (error) {
    console.error('Update link error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to update link' 
    });
  }
});

// ==================== REQUEST WITHDRAWAL ====================
router.post('/:id/withdraw', async (req, res) => {
  try {
    const { id } = req.params;
    const { amount } = req.body;
    
    if (!amount || amount < 50) {
      return res.status(400).json({ 
        success: false, 
        error: 'Minimum withdrawal is 50 tokens' 
      });
    }
    
    // Get merchant's current balance
    const { data: merchant } = await supabase
      .from('referral_merchants')
      .select('available_tokens, wallet_address')
      .eq('id', id)
      .single();

    if (!merchant) {
      return res.status(404).json({ 
        success: false, 
        error: 'Merchant not found' 
      });
    }
    
    if (merchant.available_tokens < amount) {
      return res.status(400).json({ 
        success: false, 
        error: 'Insufficient balance' 
      });
    }
    
    // Update merchant's balance
    await supabase
      .from('referral_merchants')
      .update({ 
        available_tokens: merchant.available_tokens - amount,
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    // Mark pending rewards as processing
    await supabase
      .from('merchant_referral_rewards')
      .update({ status: 'processing' })
      .eq('merchant_id', id)
      .eq('status', 'pending')
      .limit(Math.ceil(amount / 50));

    res.json({
      success: true,
      message: 'Withdrawal request submitted',
      withdrawal: {
        amount,
        wallet: merchant.wallet_address,
        status: 'processing'
      }
    });
    
  } catch (error) {
    console.error('Withdrawal error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Withdrawal failed' 
    });
  }
});

// ==================== UPDATE MERCHANT PROFILE ====================
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { merchant_name, company_name, wallet_address } = req.body;
    
    const updates = {};
    if (merchant_name) updates.merchant_name = merchant_name.trim();
    if (company_name !== undefined) updates.company_name = company_name?.trim() || null;
    if (wallet_address !== undefined) updates.wallet_address = wallet_address?.trim() || null;
    updates.updated_at = new Date().toISOString();
    
    const { data: merchant, error } = await supabase
      .from('referral_merchants')
      .update(updates)
      .eq('id', id)
      .select('id, merchant_name, email, company_name, wallet_address, updated_at')
      .single();

    if (error || !merchant) {
      return res.status(404).json({ 
        success: false, 
        error: 'Merchant not found' 
      });
    }
    
    res.json({
      success: true,
      message: 'Profile updated',
      merchant
    });
    
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to update profile' 
    });
  }
});

// ==================== GET MERCHANT BY TOKEN ====================
router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ 
        success: false, 
        error: 'No token provided' 
      });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, jwtSecret);
    
    const { data: merchant } = await supabase
      .from('referral_merchants')
      .select('id, merchant_name, email, company_name, wallet_address, total_tokens_earned, available_tokens, status')
      .eq('id', decoded.id)
      .single();

    if (!merchant) {
      return res.status(404).json({ 
        success: false, 
        error: 'Merchant not found' 
      });
    }

    res.json({
      success: true,
      merchant
    });
    
  } catch (error) {
    console.error('Get merchant error:', error);
    res.status(401).json({ 
      success: false, 
      error: 'Invalid or expired token' 
    });
  }
});

// ==================== HANDLE 404 ====================
router.all('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found',
    method: req.method,
    path: req.url
  });
});

export default router.handler({
  onError: (err, req, res) => {
    console.error('API Error:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
});