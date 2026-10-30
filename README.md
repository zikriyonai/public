# Zikriyon AI — Next.js

Chat · wallet · 68 plans · UPI payments (`zikreameen@okhdfcbank`) · admin approval. UI = the original HTML app (same CSS, same markup/classes).

## Run
```bash
npm install
cp .env.example .env.local      # fill values (see below)
npm run dev                     # http://localhost:3000
npm test                        # engine + UPI unit tests
npm run build && npm start      # production
```

## Env (`.env.local`)
| Var | What |
|---|---|
| `NEXT_PUBLIC_ZIK_API` | model server (default `https://api.zikriyonai.linkpc.net`) |
| `NEXT_PUBLIC_ZIK_API_KEY` | same X-API-Key your HTML used |
| `NEXT_PUBLIC_CHAT_MODE` | `direct` (browser → model server) or `proxy` (via `/api/chat`, key hidden; set `ZIK_API_KEY`) |
| `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | service account (Firebase console → Project settings → Service accounts) — needed for payments/admin routes |
| `ADMIN_EMAILS` | comma-separated emails allowed on `/admin` (must be email-verified) |

Also: add your new site origin (e.g. `https://yourapp.vercel.app`) to the model server's `ALLOWED_ORIGINS`, and to Firebase Auth → Authorized domains.
Deploy Firestore rules: `firebase deploy --only firestore:rules` (file: `firestore.rules`).

## UPI payment flow
1. User picks a plan → **Pay via UPI** → server `/api/payments/create` creates an order (price from the *server* catalog) and returns a `upi://pay?pa=zikreameen@okhdfcbank&…` link + QR.
2. User pays in any UPI app, enters the 12-digit **UTR** → `/api/payments/submit` (UTR is unique, one use).
3. You open `/admin`, match the UTR in your bank/UPI statement, press **Approve** → server writes `users/{uid}/grants/{orderId}`.
4. The user's wallet listener applies the grant (idempotent by order id) → credits appear instantly.

Subscriptions/add-ons renew manually (no UPI Autopay).

## Automatic verification (bank SMS → webhook)
Every order gets a unique payable amount (price + 0–49 paise). When the bank credit SMS arrives, your phone forwards it to
`POST https://<your-site>/api/payments/webhook` with header `X-Webhook-Secret: <PAYMENT_WEBHOOK_SECRET>` (or `?secret=` in the URL) and a plain-text body = the SMS/notification text (JSON `{"text":"…"}` also works).
The server parses amount (+UTR), finds the matching open order and approves it. No match / ambiguous → shown in `/admin` → *Unmatched alerts*.
Android forwarder: MacroDroid / Tasker / Automate → trigger "SMS received" (sender contains your bank's sender id) → action "HTTP POST" with the JSON above.
Set `UPI_VPA` to the UPI ID that receives the money (the one behind your Google Pay / Bank of Baroda account). The phone must stay on with internet.
Tune `src/lib/bank-alert.ts` + `tests/bank-alert.test.ts` with a real (masked) SMS from your bank.

## Sign-in methods
Google, e-mail + password (with verification mail & reset), passwordless e-mail link, GitHub. Enable each in Firebase → Authentication → Sign-in method
(GitHub needs a GitHub OAuth App: callback URL = the one Firebase shows). Add your site domain in Authentication → Settings → Authorized domains.

## Phone-notification alternative
MacroDroid can also trigger on *Notification received* from Google Pay / PhonePe ("Received ₹49 …"). Those have no UTR, so they match by the unique amount only; SMS (with UTR) is more reliable. Using both is safe — the duplicate is detected.

## Security notes / known limits
- The payee UPI ID is hard-coded server-side; the browser can't change it or the price.
- Payments are **manually verified** (no bank API). For automatic verification use a gateway (Razorpay/Cashfree) later.
- The wallet itself is client-authoritative (like the original app): a technically skilled user could edit their local balance. Server-side metering is the next step if abuse appears.
- `NEXT_PUBLIC_ZIK_API_KEY` is public in `direct` mode (same as the HTML version). Use `proxy` mode to hide it (note: host timeouts on a slow CPU model).
- Not verifiable in the build sandbox: `next build` (npm registry was blocked). Logic tests pass; run `npm run build` locally.
