# Follow-ups from the implementation review

Found by `/10x-impl-review` on 2026-10-05 (`reviews/impl-review.md`). The review-fix commit fixed F1, F3, F4 and F5, and took Fix A for F2. What's below is left for later.

## App-wide hardening (F6, older than S-07)

Recorded on the roadmap's S-07 block, for a change of its own with its own smoke and e2e checks:

- **No response forbids framing.** No page sends `X-Frame-Options: DENY` or `Content-Security-Policy: frame-ancestors 'none'`, so another site can frame the sign-in, confirm and set-password forms (clickjacking). SameSite=Lax cookies and no XSS keep this low today.
- **The session cookies aren't `httpOnly`.** They keep @supabase/ssr's default, `httpOnly: false` (`src/lib/supabase.ts`), though no browser code reads them: the app has no browser client. Passing `cookieOptions: { httpOnly: true }` would keep a future XSS from reading the session.

## Accepted, to revisit

- **Workers Logs keep an opened link's token (F2, Fix A).** `observability` in `wrangler.jsonc` stores each request's URL, so `/auth/confirm?token_hash=…` from a link that was opened but not yet used is in the account's logs until it's used or expires (24 hours). Only Cloudflare account members can read them. The deploy plan's "Accounts and links (S-07)" names this. Turning stored invocation logs off (`observability.logs.invocation_logs: false`) would remove it, at the cost of the per-request records.
- **Anyone can spend the confirm route's Auth budget.** An anonymous `POST /api/auth/confirm` with a 56-hex token costs one `/verify` call, which Auth counts by the Worker's address, shared by every user, so a stranger could keep link holders on "Zbyt wiele prób." for a while. The plan's Performance Considerations already accepts the shared per-IP buckets. If it happens, put a deployment-wide counter, Cloudflare rate limiting or Turnstile in front of the two anonymous auth routes.
- **"The link keeps working after its key is deleted"** (deploy plan, step 4) follows from the design and wasn't run: the app verifies the link with its publishable key, and the token lives in Auth. The owner's first real link checks it whenever the person presses the button after step 4 deleted the key.
