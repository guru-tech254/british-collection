# BRITISH COLLECTION — website starter

This project keeps the uploaded prototype's existing storefront styling and layout, changes the store currency to Kenyan shillings, and adds a server-side Safaricom Daraja STK Push checkout foundation.

## What's included
- Original prototype storefront and visual design retained.
- Product seed prices converted from the prototype's USD values at a fixed initial planning rate of KES 130 per USD. These are starter prices and should be reviewed in the admin/product setup before launch.
- KES display and KES 350 delivery fee; free delivery on orders of KES 13,000 or more.
- M-Pesa phone-number checkout with a Daraja STK Push request.
- Server-side Daraja credentials (not exposed in browser JavaScript).
- Supabase orders table schema and callback update handler.
- Order tracking endpoint.

## Run locally
1. Install Node.js 20 or later.
2. In this folder run `npm install`.
3. Copy `.env.example` to `.env` and fill in your Supabase and Daraja sandbox credentials.
4. In Supabase SQL Editor, run `supabase-schema.sql`.
5. Set `MPESA_CALLBACK_URL` to a publicly reachable HTTPS URL ending in `/api/mpesa/callback`. For local testing, expose the local server through a secure tunnel such as ngrok.
6. Run `npm start` and open `http://localhost:3000`.

## Before taking real customer payments
- Register/configure a Daraja app and confirm the correct shortcode, passkey, transaction type and callback URL with Safaricom.
- Test STK Push and callback handling in sandbox, then switch to production credentials after Safaricom approval.
- Configure Supabase project URL and service-role key on the server only. Never put the service-role key in frontend code or commit `.env`.
- Add authenticated admin access, product/stock CRUD, order management, email/SMS notifications, and production-grade payment reconciliation before launch.

## Important prototype note
The storefront design is preserved, but the old Claude-specific account/admin database adapter in the uploaded prototype is not a deployable backend. This starter replaces checkout initiation and order tracking with the included Node/Supabase endpoints. The full admin dashboard and customer accounts still need to be connected to the new backend before production launch.
