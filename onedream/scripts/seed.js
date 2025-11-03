// Seed script to populate One Dream Initiative with sample data
// Run with: node onedream/scripts/seed.js

const { createClient } = require('@supabase/supabase-js');
const { generateReferralToken } = require('../../lib/onedreamHelpers');

// Initialize Supabase client (use service role key for admin operations)
const supabaseUrl = process.env.SUPABASE_URL || 'http://localhost:54321';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseKey) {
  console.log('⚠️  No Supabase credentials found. Using mock data generation.');
}

const supabase = supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

// Sample user data
const sampleUsers = [
  { name: 'Alex Chen', email: 'alex@example.com', bio: 'Building the next generation of sustainable technology' },
  { name: 'Maria Rodriguez', email: 'maria@example.com', bio: 'Creating educational opportunities in underserved communities' },
  { name: 'James Wilson', email: 'james@example.com', bio: 'Developing clean water solutions for rural areas' },
  { name: 'Sarah Johnson', email: 'sarah@example.com', bio: 'Fighting climate change through renewable energy initiatives' },
  { name: 'David Kim', email: 'david@example.com', bio: 'Revolutionizing healthcare access with telemedicine' },
  { name: 'Emma Thompson', email: 'emma@example.com', bio: 'Empowering women entrepreneurs in developing countries' },
  { name: 'Michael Brown', email: 'michael@example.com', bio: 'Creating job opportunities through vocational training programs' },
  { name: 'Lisa Davis', email: 'lisa@example.com', bio: 'Preserving endangered languages through digital archives' },
  { name: 'Carlos Martinez', email: 'carlos@example.com', bio: 'Improving mental health support for veterans' },
  { name: 'Jennifer Wu', email: 'jennifer@example.com', bio: 'Advancing AI ethics and responsible technology development' },
  { name: 'Robert Taylor', email: 'robert@example.com', bio: 'Building affordable housing solutions' },
  { name: 'Amanda Lee', email: 'amanda@example.com', bio: 'Promoting sustainable agriculture and food security' },
  { name: 'Kevin O\'Brien', email: 'kevin@example.com', bio: 'Developing accessible technology for people with disabilities' },
  { name: 'Nina Patel', email: 'nina@example.com', bio: 'Creating scholarships for first-generation college students' },
  { name: 'Tyler Anderson', email: 'tyler@example.com', bio: 'Connecting seniors with technology through education programs' },
  { name: 'Sophie Garcia', email: 'sophie@example.com', bio: 'Reducing plastic waste through innovative recycling solutions' },
  { name: 'Brandon Clark', email: 'brandon@example.com', bio: 'Supporting small businesses with micro-financing platforms' },
  { name: 'Rachel Green', email: 'rachel@example.com', bio: 'Improving literacy rates in developing nations' },
  { name: 'Jason Miller', email: 'jason@example.com', bio: 'Creating inclusive spaces for LGBTQ+ youth' },
  { name: 'Samantha White', email: 'samantha@example.com', bio: 'Advancing cancer research through crowdfunded initiatives' },
  { name: 'Daniel Lewis', email: 'daniel@example.com', bio: 'Building bridges between cultures through art and music' },
  { name: 'Ashley Hall', email: 'ashley@example.com', bio: 'Protecting wildlife through conservation education' },
  { name: 'Christopher Young', email: 'chris@example.com', bio: 'Democratizing access to quality education worldwide' },
  { name: 'Megan King', email: 'megan@example.com', bio: 'Empowering communities through renewable energy cooperatives' },
  { name: 'Andrew Scott', email: 'andrew@example.com', bio: 'Creating mental health resources for college students' },
  { name: 'Lauren Adams', email: 'lauren@example.com', bio: 'Fighting food insecurity through urban farming initiatives' },
  { name: 'Matthew Turner', email: 'matthew@example.com', bio: 'Developing disaster relief technology and emergency response systems' },
  { name: 'Jessica Harris', email: 'jessica@example.com', bio: 'Promoting financial literacy in underserved communities' },
  { name: 'Ryan Phillips', email: 'ryan@example.com', bio: 'Supporting refugee integration through skills training programs' },
  { name: 'Kelly Rodriguez', email: 'kelly@example.com', bio: 'Advancing space exploration for the benefit of humanity' }
];

// Generate realistic vote distributions (Pareto distribution - 80/20 rule)
function generateVoteDistribution(totalUsers, totalVotes) {
  const votes = [];
  let remainingVotes = totalVotes;
  
  for (let i = 0; i < totalUsers; i++) {
    let userVotes;
    
    if (i < totalUsers * 0.1) {
      // Top 10% get 60% of votes
      userVotes = Math.floor((remainingVotes * 0.6 * Math.random()) / (totalUsers * 0.1));
    } else if (i < totalUsers * 0.3) {
      // Next 20% get 25% of votes
      userVotes = Math.floor((remainingVotes * 0.25 * Math.random()) / (totalUsers * 0.2));
    } else {
      // Bottom 70% get 15% of votes
      userVotes = Math.floor((remainingVotes * 0.15 * Math.random()) / (totalUsers * 0.7));
    }
    
    userVotes = Math.max(1, Math.min(userVotes, remainingVotes));
    votes.push(userVotes);
    remainingVotes -= userVotes;
  }
  
  // Distribute any remaining votes
  for (let i = 0; remainingVotes > 0 && i < votes.length; i++) {
    const additionalVotes = Math.min(remainingVotes, Math.floor(Math.random() * 100));
    votes[i] += additionalVotes;
    remainingVotes -= additionalVotes;
  }
  
  return votes.sort((a, b) => b - a);
}

// Generate votes over time for realistic growth
function generateVotesOverTime(totalVotes, daysBack = 30) {
  const votes = [];
  const now = new Date();
  
  for (let i = 0; i < totalVotes; i++) {
    const daysAgo = Math.floor(Math.random() * daysBack);
    const hoursAgo = Math.floor(Math.random() * 24);
    const minutesAgo = Math.floor(Math.random() * 60);
    
    const createdAt = new Date(now);
    createdAt.setDate(createdAt.getDate() - daysAgo);
    createdAt.setHours(createdAt.getHours() - hoursAgo);
    createdAt.setMinutes(createdAt.getMinutes() - minutesAgo);
    
    votes.push(createdAt.toISOString());
  }
  
  return votes.sort();
}

async function seedDatabase() {
  console.log('🌱 Starting One Dream Initiative database seeding...');
  
  if (!supabase) {
    console.log('📝 Generating mock data (no database connection)');
    generateMockData();
    return;
  }

  try {
    // Clear existing data (be careful in production!)
    console.log('🗑️  Clearing existing data...');
    await supabase.from('onedream_votes').delete().gte('id', 0);
    await supabase.from('onedream_payments').delete().gte('id', 0);
    await supabase.from('onedream_users').delete().gte('created_at', '1900-01-01');

    // Create users
    console.log('👥 Creating sample users...');
    const users = [];
    
    for (let i = 0; i < sampleUsers.length; i++) {
      const userData = sampleUsers[i];
      const userId = `user-${i + 1}-${Date.now()}`;
      const referralToken = generateReferralToken(userId);
      
      const user = {
        id: userId,
        name: userData.name,
        email: userData.email,
        bio: userData.bio,
        referral_token: referralToken,
        created_at: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString()
      };
      
      users.push(user);
    }

    const { error: usersError } = await supabase
      .from('onedream_users')
      .insert(users);

    if (usersError) {
      console.error('Error creating users:', usersError);
      return;
    }

    console.log(`✅ Created ${users.length} users`);

    // Generate vote distribution
    const totalVotes = 247853; // Current mock total
    const voteDistribution = generateVoteDistribution(users.length, totalVotes);
    
    // Create votes for each user
    console.log('🗳️  Creating votes...');
    const allVotes = [];
    const allPayments = [];
    
    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      const userTotalVotes = voteDistribution[i];
      const voteTimes = generateVotesOverTime(userTotalVotes, 30);
      
      for (let j = 0; j < userTotalVotes; j++) {
        const isPaymentVote = Math.random() < 0.3; // 30% are payment votes
        const voteAmount = isPaymentVote ? Math.random() < 0.5 ? 10 : Math.random() < 0.7 ? 20 : 50 : 0;
        const votes = voteAmount > 0 ? Math.floor(voteAmount / 2) : 1;
        
        const vote = {
          user_id: user.id,
          votes: votes,
          amount_usd: voteAmount,
          source: isPaymentVote ? 'payment' : 'visit',
          created_at: voteTimes[j] || new Date().toISOString()
        };
        
        allVotes.push(vote);
        
        // Create corresponding payment record
        if (isPaymentVote) {
          const payment = {
            user_id: user.id,
            provider: Math.random() < 0.7 ? 'stripe' : 'coinbase',
            amount_usd: voteAmount,
            provider_payment_id: `pay_${Math.random().toString(36).substr(2, 9)}`,
            status: 'completed',
            created_at: voteTimes[j] || new Date().toISOString()
          };
          
          allPayments.push(payment);
        }
      }
    }

    // Insert votes in batches
    const batchSize = 1000;
    for (let i = 0; i < allVotes.length; i += batchSize) {
      const batch = allVotes.slice(i, i + batchSize);
      const { error: votesError } = await supabase
        .from('onedream_votes')
        .insert(batch);
      
      if (votesError) {
        console.error('Error creating votes batch:', votesError);
        continue;
      }
      
      console.log(`📊 Created votes batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(allVotes.length / batchSize)}`);
    }

    // Insert payments in batches
    for (let i = 0; i < allPayments.length; i += batchSize) {
      const batch = allPayments.slice(i, i + batchSize);
      const { error: paymentsError } = await supabase
        .from('onedream_payments')
        .insert(batch);
      
      if (paymentsError) {
        console.error('Error creating payments batch:', paymentsError);
        continue;
      }
    }

    console.log(`✅ Created ${allVotes.length} votes and ${allPayments.length} payments`);

    // Display summary
    console.log('\n📈 Seeding Summary:');
    console.log(`👥 Users: ${users.length}`);
    console.log(`🗳️  Total Votes: ${allVotes.reduce((sum, v) => sum + v.votes, 0)}`);
    console.log(`💰 Total Value: $${allVotes.reduce((sum, v) => sum + v.amount_usd, 0).toFixed(2)}`);
    console.log(`💳 Payments: ${allPayments.length}`);
    console.log('\n🎉 Database seeding completed successfully!');
    
  } catch (error) {
    console.error('❌ Seeding failed:', error);
  }
}

function generateMockData() {
  console.log('\n📊 Mock Data Generation (for development without database):');
  
  const totalVotes = 247853;
  const voteDistribution = generateVoteDistribution(sampleUsers.length, totalVotes);
  
  console.log(`👥 Users: ${sampleUsers.length}`);
  console.log(`🗳️  Total Votes: ${totalVotes}`);
  console.log(`💰 Total Value: $${(totalVotes * 2).toLocaleString()}`);
  
  console.log('\n🏆 Top 10 Mock Leaders:');
  sampleUsers.slice(0, 10).forEach((user, index) => {
    console.log(`${index + 1}. ${user.name}: ${voteDistribution[index].toLocaleString()} votes ($${(voteDistribution[index] * 2).toLocaleString()})`);
  });
  
  console.log('\n💡 To connect to a real database:');
  console.log('1. Set up Supabase project');
  console.log('2. Run the SQL schema from onedream/schema.sql');
  console.log('3. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables');
  console.log('4. Run this script again');
}

// Command line options
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
One Dream Initiative Database Seeder

Usage: node onedream/scripts/seed.js [options]

Options:
  --help, -h     Show this help message
  --mock         Generate mock data only (no database connection)
  --users N      Number of users to create (default: 30)
  --votes N      Total votes to distribute (default: 247853)

Environment Variables:
  SUPABASE_URL              Your Supabase project URL
  SUPABASE_SERVICE_ROLE_KEY Your Supabase service role key (for admin operations)

Examples:
  node onedream/scripts/seed.js
  node onedream/scripts/seed.js --mock
  node onedream/scripts/seed.js --users 50 --votes 500000
  `);
  process.exit(0);
}

// Run the seeder
if (require.main === module) {
  seedDatabase().catch(console.error);
}

module.exports = { seedDatabase, generateMockData, sampleUsers };