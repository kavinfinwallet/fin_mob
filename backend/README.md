# OTP Push Notification Backend

Phone number authentication via **push notifications only** — no SMS, no Twilio.  
Supports **Firebase Cloud Messaging (FCM)** for mobile apps and **Web Push (VAPID)** for browsers.

---

## Tech Stack

- **Node.js + Express**
- **PostgreSQL** (via `pg`)
- **Firebase Admin SDK** — FCM push notifications
- **web-push** — Web Push / VAPID for browsers
- **bcryptjs** — OTP hashing
- **jsonwebtoken** — Access + Refresh tokens

---

## Project Structure

```
src/
├── config/
│   ├── db.js             # PostgreSQL pool
│   ├── firebase.js       # Firebase Admin SDK init
│   └── webpush.js        # VAPID / web-push init
├── controllers/
│   ├── auth.controller.js       # send-otp, verify-otp, refresh, logout
│   └── customer.controller.js  # profile, fcm-token, notification logs
├── middleware/
│   ├── auth.middleware.js       # JWT bearer verification
│   └── rateLimit.middleware.js  # per-route rate limiting
├── models/
│   ├── newCustomer.model.js
│   ├── customer.model.js
│   ├── otpVerification.model.js
│   └── notificationLog.model.js
├── routes/
│   └── index.js
├── services/
│   └── notification.service.js  # FCM + Web Push delivery logic
├── utils/
│   ├── otp.js        # generate / hash / verify OTP
│   ├── jwt.js        # token generation + verification
│   └── response.js   # standard JSON helpers
├── app.js
└── server.js
migrations/
├── 001_init.sql
└── run.js
```

---

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Fill in all values in .env
```

### 3. Generate VAPID keys (for Web Push)
```bash
npx web-push generate-vapid-keys
# Paste results into .env
```

### 4. Run database migrations
```bash
npm run migrate
```

### 5. Start server
```bash
npm run dev     # development (nodemon)
npm start       # production
```

---

## API Reference

All endpoints are prefixed with `/api`.

### Auth

#### `POST /api/send-otp`
Sends OTP via FCM or Web Push. Auto-detects new vs existing customer.

**Body:**
```json
{
  "phoneNumber": "+919876543210",
  "fcmToken": "device_fcm_token_here",
  "webPushSubscription": {
    "endpoint": "https://fcm.googleapis.com/...",
    "keys": { "p256dh": "...", "auth": "..." }
  }
}
```
`fcmToken` and `webPushSubscription` are optional but at least one is required for delivery.  
If `fcmToken` is present, FCM is used. Otherwise Web Push is attempted.

**Response:**
```json
{
  "success": true,
  "message": "OTP sent successfully via push notification",
  "data": {
    "purpose": "login",
    "customerType": "existing",
    "expiresIn": 300,
    "channel": "FCM"
  }
}
```

---

#### `POST /api/verify-otp`
Verifies OTP. Creates customer on first signup or updates `last_login_at` for existing.

**Body:**
```json
{
  "phoneNumber": "+919876543210",
  "otp": "482910"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "isNewCustomer": false,
    "customer": { "id": "...", "phoneNumber": "...", "isVerified": true },
    "accessToken": "eyJ...",
    "refreshToken": "eyJ..."
  }
}
```

---

#### `POST /api/refresh-token`
**Body:** `{ "refreshToken": "eyJ..." }`

---

#### `POST /api/logout`
**Headers:** `Authorization: Bearer <accessToken>`  
Clears the customer's FCM token.

---

### Customer (Protected — requires Bearer token)

#### `GET /api/customer/profile`
Returns authenticated customer's profile.

#### `PUT /api/customer/fcm-token`
**Body:** `{ "fcmToken": "new_token_here" }`

---

### Notification Logs (Protected)

#### `GET /api/notification/logs?page=1&limit=20`
Returns paginated notification logs for the authenticated customer.

#### `GET /api/notification/logs/:id`
Returns a single notification log by ID (must belong to authenticated customer).

---

## OTP Flow

```
Client                         Server                         FCM / Web Push
  │                               │                                │
  │── POST /send-otp ────────────>│                                │
  │   { phone, fcmToken }         │── generate OTP ─────────────> │
  │                               │── hash OTP (bcrypt)            │
  │                               │── save to otp_verifications    │
  │                               │── send notification ──────────>│
  │                               │                                │── push to device
  │<─────────────────────────────│                                │
  │   { expiresIn: 300 }          │                                │
  │                               │                                │
  │   [user sees OTP on device]   │                                │
  │                               │                                │
  │── POST /verify-otp ──────────>│                                │
  │   { phone, otp }              │── find valid OTP record        │
  │                               │── bcrypt.compare()             │
  │                               │── mark OTP used                │
  │                               │── upsert customer              │
  │<─────────────────────────────│                                │
  │   { accessToken, refreshToken}│                                │
```

---

## Security Notes

- OTPs are **bcrypt-hashed** before storage — never stored in plain text
- Previous OTPs are **invalidated** when a new one is requested
- **Max attempt** enforcement prevents brute force (default: 3 tries)
- **Rate limiting** on `/send-otp` (5 per 10 min) and `/verify-otp` (10 per 15 min)
- Access tokens are **short-lived** (15m default); refresh tokens are 7d
- FCM token is **cleared on logout** to stop notifications

---

## Environment Variables

| Variable | Description |
|---|---|
| `DB_*` | PostgreSQL connection |
| `JWT_SECRET` | Access token signing key |
| `JWT_REFRESH_SECRET` | Refresh token signing key |
| `JWT_EXPIRES_IN` | Access token TTL (e.g. `15m`) |
| `JWT_REFRESH_EXPIRES_IN` | Refresh token TTL (e.g. `7d`) |
| `OTP_LENGTH` | OTP digit count (default: 6) |
| `OTP_EXPIRES_IN_MINUTES` | OTP validity (default: 5) |
| `OTP_MAX_ATTEMPTS` | Max wrong attempts (default: 3) |
| `FIREBASE_*` | Firebase service account credentials |
| `VAPID_PUBLIC_KEY` | Web Push public key |
| `VAPID_PRIVATE_KEY` | Web Push private key |
| `VAPID_SUBJECT` | Web Push contact email |
