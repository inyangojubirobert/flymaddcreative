# One Dream Initiative

A social influence-based voting initiative integrated into the FlyMadd Creative website.

## Overview

**Vision:** Harnessing support through social influence.

The One Dream Initiative allows participants to gain votes through referrals and monetary contributions. Each vote is valued at $2, and rounds conclude when collective votes reach 1,000,000.

## Environment Variables

Create a `.env.local` file with the following variables:

```env
SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_supabase_anon_key
VOTE_VALUE=2
GOAL_VOTES=1000000
ALLOW_FREE_VISITS_AS_VOTE=false
ADMIN_SECRET=your_admin_secret
PAYMENT_SECRET=your_payment_webhook_secret
```

## Local Development

1. Install dependencies:

```bash
npm install
```

2. Set up Supabase:

   - Create a new Supabase project
   - Run the SQL schema from `/onedream/schema.sql`
   - Update environment variables

3. Run development server:

```bash
npm run dev
```

4. Seed sample data (optional):

```bash
node onedream/scripts/seed.js
```

## Features

- **Referral System**: Each user gets a unique shareable link
- **Vote Tracking**: $2 per vote, goal of 1,000,000 votes
- **Weekly Feedback**: Top 10 winners from last 7 days
- **Payment Integration**: Mock payment system ready for Stripe/Coinbase
- **Admin Dashboard**: View winners, payments, and statistics

## Production Setup

See checklist at the bottom of this README for production deployment steps.

## File Structure

- `/pages/onedream/` - Main application pages
- `/pages/api/onedream/` - API endpoints
- `/components/onedream/` - React components
- `/lib/onedreamHelpers.js` - Utility functions
- `/onedream/schema.sql` - Database schema
