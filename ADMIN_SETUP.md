## Admin System Setup Guide

### **Overview**

The new admin system allows admins to:

- 📬 View and respond to participant messages & complaints
- 💰 Manage withdrawal requests and payouts
- 🛍️ View catalogue orders and sales confirmations
- 👥 Access from website portal, mobile app, and web dashboard

---

### **1. Create First Admin Account**

#### **Option A: Direct Database Entry (Recommended)**

Use Supabase dashboard to create your first admin:

1. Go to **Supabase Console** → Your project
2. Navigate to **SQL Editor**
3. Run this query (replace with your details):

```sql
INSERT INTO admin_users (email, display_name, password_hash, is_active)
VALUES (
  'admin@flymaddcreative.com',
  'Administrator',
  '$2a$10$YOUR_BCRYPT_HASH_HERE',  -- Generate below
  true
);
```

**To generate the bcrypt hash:**

- Use an online tool: https://bcrypt.online (set rounds to 10)
- Or use Node.js:
  ```bash
  node -e "require('bcryptjs').hash('your-password', 10, (e, h) => console.log(h))"
  ```

#### **Option B: Using Registration API**

Set the `ADMIN_REGISTRATION_SECRET` environment variable, then POST to `/api/admin/register`:

```bash
curl -X POST https://flymaddcreative.vercel.app/api/admin/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@flymaddcreative.com",
    "password": "YourSecurePassword123",
    "display_name": "Administrator",
    "registration_key": "YOUR_ADMIN_REGISTRATION_SECRET"
  }'
```

---

### **2. Access Admin Interfaces**

#### **Website Admin Portal**

- **URL:** `https://flymaddcreative.online/admin-portal.html`
- **Access:** Email + Password
- **Features:**
  - View all support messages from participants
  - Manage withdrawal requests (pending/processing/claimed/rejected)
  - View catalogue orders and sales
  - Respond to participant messages

#### **Web Dashboard (admin.html)**

- **URL:** `https://flymaddcreative.online/admin.html`
- **Same features as admin-portal.html** (older interface)

#### **Mobile App (AAB/APK)**

- **Screen:** `🛡️ Administrator sign in` from the public landing page or Profile
- **Access:** Email + password for an active `admin_users` account. The app
  stores only the resulting administrator JWT in Android secure storage.
- **Note:** The native Admin Centre displays the same participant inbox,
  withdrawal requests, and catalogue orders as the website portal. An APK/AAB
  containing the screen is not a privilege escalation: every request is still
  checked server-side against the active administrator account.

---

### **3. Environment Variables Required**

Add to `.env.local` or Vercel environment:

```env
# JWT secret for admin tokens (generate a random string)
ADMIN_JWT_SECRET=your-random-secret-key-min-32-characters

# Optional: For admin registration API
ADMIN_REGISTRATION_SECRET=your-registration-secret-key
```

**To generate a random secret:**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

### **4. Database Schema**

The system uses two main tables:

#### `admin_users` (Admin accounts)

```sql
- id (uuid, primary key)
- email (text, unique)
- display_name (text)
- password_hash (text, bcrypt)
- is_active (boolean)
- created_at (timestamptz)
- updated_at (timestamptz)
```

#### `support_messages` (Messages/complaints)

```sql
- id (uuid)
- participant_id (uuid) - participant who sent the message
- admin_id (uuid) - admin who replied
- withdrawal_id (uuid) - linked withdrawal request
- sender_type ('participant' | 'admin' | 'system')
- message_type ('general' | 'enquiry' | 'payout_notification')
- body (text, max 2000 chars)
- read_at (timestamptz)

### **5. AI Help Knowledge Base**

Run [supabase/create_project_faqs.sql](supabase/create_project_faqs.sql) in
the Supabase SQL editor after the support-message migration. It creates and
seeds the `project_faqs` table used by both the native Help & FAQ screen and
Bascardo Token AI. FAQ rows can be updated in the Supabase Table Editor; set
`is_published` to false to remove a topic from the app and AI context.
- created_at (timestamptz)
```

#### `catalogue_orders` (Sales)

```sql
- id (uuid)
- seller_id (uuid)
- buyer_id (uuid)
- item_id (uuid)
- status ('pending' | 'paid' | 'confirmed' | 'disputed' | 'refunded')
- amount_usd (numeric)
- amount_ngn (numeric)
- exchange_rate (numeric)
- currency (text)
- payment_method (text)
- payment_reference (text)
- created_at (timestamptz)
- buyer_confirmed_at (timestamptz)
- seller_confirmed_at (timestamptz)
```

#### `participant_withdrawals` (Withdrawal requests)

```sql
- id (uuid)
- participant_id (uuid)
- amount_usd (numeric)
- currency (text)
- payment_method (text)
- payment_details (text)
- status ('pending' | 'processing' | 'paid' | 'claimed' | 'rejected')
- payout_type (text)
- payout_reference (text)
- payout_amount (numeric)
- claimed_by (uuid - admin_users.id)
- admin_note (text)
- created_at (timestamptz)
```

---

### **5. API Endpoints**

All require `Authorization: Bearer {admin_token}` header.

#### `POST /api/admin/login`

Login to get token

```json
{
  "email": "admin@flymaddcreative.com",
  "password": "password"
}
```

**Response:**

```json
{
  "success": true,
  "token": "eyJ...",
  "admin": { "id": "...", "email": "...", "display_name": "..." }
}
```

#### `POST /api/admin/register`

Create new admin (requires ADMIN_REGISTRATION_SECRET)

```json
{
  "email": "newadmin@flymaddcreative.com",
  "password": "password",
  "display_name": "Support Agent",
  "registration_key": "ADMIN_REGISTRATION_SECRET"
}
```

#### `GET /api/admin/messages?participant_id={id}`

Get all messages for a participant

```json
{
  "participant": { "id": "...", "name": "...", "email": "..." },
  "messages": [
    {
      "id": "...",
      "sender_type": "participant",
      "body": "...",
      "created_at": "...",
      "read_at": null
    }
  ]
}
```

#### `POST /api/admin/messages`

Send reply to participant

```json
{
  "participant_id": "...",
  "withdrawal_id": "...", // optional
  "body": "Your message here"
}
```

#### `GET /api/admin/withdrawals?status={status}`

Get withdrawal requests

```json
{
  "withdrawals": [
    {
      "id": "...",
      "participant": { "name": "...", "email": "...", "username": "..." },
      "amount_usd": 100.0,
      "status": "pending",
      "payment_method": "bank_transfer",
      "created_at": "..."
    }
  ]
}
```

#### `PATCH /api/admin/withdrawals/{id}`

Update withdrawal status and payout info

```json
{
  "status": "claimed",
  "payout_type": "fiat",
  "payout_currency": "NGN",
  "payout_amount": "55000",
  "payout_reference": "TRF123456",
  "admin_note": "Paid to participant's account"
}
```

#### `GET /api/admin/orders?status={status}`

Get catalogue orders

```json
{
  "orders": [
    {
      "id": "...",
      "seller_username": "seller123",
      "buyer_username": "buyer456",
      "status": "paid",
      "amount_usd": 50.0,
      "created_at": "..."
    }
  ]
}
```

---

### **6. Workflow**

#### **Participant sends message:**

1. Mobile app → `POST /api/onedream/messages` (participant token)
2. Message stored in `support_messages` with `sender_type: 'participant'`
3. Admin sees it in admin portal → Messages tab

#### **Admin replies:**

1. Admin portal → Clicks message → Types reply
2. `POST /api/admin/messages` (admin token)
3. Reply stored with `sender_type: 'admin'`
4. Participant sees reply in mobile app

#### **Admin processes withdrawal:**

1. Admin portal → Withdrawals tab
2. Selects withdrawal request
3. Verifies payment details, checks balance
4. Updates status to "processing" or "claimed"
5. Adds payout reference (bank transfer ID, crypto tx hash, etc.)
6. System notifies participant

#### **Admin views sales:**

1. Admin portal → Orders tab
2. See all catalogue purchases
3. Buyer/seller names, amounts, dates, status
4. Track pending vs. completed sales

---

### **7. Security Notes**

- All admin operations require valid JWT token
- Tokens expire after 24 hours (adjust in `lib/adminAuth.js`)
- Admin password hashes use bcrypt with 10 rounds
- Messages and withdrawals have RLS policies preventing participant/merchant access
- Never expose ADMIN_JWT_SECRET or ADMIN_REGISTRATION_SECRET in frontend code

---

### **8. Troubleshooting**

**"Admin login is not configured"**

- Ensure `ADMIN_JWT_SECRET` is set in environment variables

**"Invalid registration key"**

- `ADMIN_REGISTRATION_SECRET` doesn't match or not set

**"Participant not found"**

- Verify participant_id exists in `participants` table

**No messages showing**

- Participants must use mobile app to send messages
- Website users don't have messaging yet

---

### **Next Steps**

1. ✅ Set `ADMIN_JWT_SECRET` in Vercel environment
2. ✅ Create first admin account (via Supabase or API)
3. ✅ Visit `/admin-portal.html` and log in
4. ✅ Start receiving participant messages
5. ✅ Process withdrawal requests
6. ✅ Monitor catalogue sales
