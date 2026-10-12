# Checklist for auditing an app generated from a single prompt

A reusable checklist, with the lessons from this audit (see [`audit/AUDIT.md`](audit/AUDIT.md)). Today's AI app generators usually get the basics right (RLS, tenant isolation); **the real risk is business rules enforced only in the UI, not in the database/server**, and direct API calls that bypass the UI.

For every item, ask: **"Could someone calling the API directly, bypassing the UI, do this?"**

## 1. Access control (most critical)
- [ ] Is RLS enabled on every table? Build a **role matrix** for each table x operation (select/insert/update/delete) and each persona (anon, registered-but-not-a-member, owner, staff, another tenant's owner).
- [ ] Tenant isolation: from tenant A's session, try to read/modify/delete tenant B's data via the API directly. It must fail.
- [ ] Does `UPDATE`/`DELETE` under RLS affect 0 rows or error? (0 rows = silent deny; acceptable but know it.)
- [ ] Do role boundaries match the prompt? (If "staff see their own calendar", can staff read/modify the **whole** salon's data?)
- [ ] Security-definer RPCs: does each one verify the caller's identity/limits itself? (RLS is bypassed inside definer functions.)
- [ ] Are helper/internal functions revoked from `anon`/`public`?
- [ ] Default table grants: the platform may grant `anon` table privileges; don't let RLS be the only defense - revoke what isn't needed.

## 2. Where are the business rules? (UI vs server)
- [ ] Opening hours, open days, booking window (e.g. 21 days), slot alignment - enforced on the **server** or only in the UI?
- [ ] Public write endpoints (booking, etc.): bounded against past dates, far-future dates, closed days, invalid times?
- [ ] Overwriting existing records: can a public "upsert" change someone else's record (name/email) via a phone/email collision?
- [ ] Do values like price/duration come from the request or from the stored record? (Can a visitor forge a price/owner?)
- [ ] Integrity constraints: negative price, zero/negative duration, end<start all blocked? (CHECK constraints.)

## 3. Input validation and output escaping
- [ ] Server-side length and format limits (name, phone, email, slug, notes). Is there a maximum? (very long text)
- [ ] Are fields like slug/path sanitized in the RPC (not just the UI slugify)?
- [ ] XSS: does the framework auto-escape? Is `dangerouslySetInnerHTML`/`v-html` fed user data?
- [ ] Outgoing links (`wa.me`, `sms:`, `mailto:`) and message bodies escaped/encoded?

## 4. Identity, session, invitations
- [ ] Is the password policy enforced **server-side** (not just a client `minLength`)?
- [ ] Email enumeration: do sign-in and sign-up return the same response for an existing vs non-existing email?
- [ ] Is email confirmation on? Anonymous sign-in off? Brute-force/rate limiting present?
- [ ] Invitations/membership: explicit acceptance instead of **automatic** email matching (an owner typing an email must not silently make that person a member)?
- [ ] Where is the session token (localStorage vs HttpOnly cookie)? Account-takeover risk if combined with XSS.
- [ ] OAuth/`emailRedirectTo` redirects allow-listed (no open redirect)?

## 5. AI features (if any)
- [ ] Does untrusted data (customer name/notes) go straight into the model prompt? Is it isolated as "data only" (prompt injection)?
- [ ] If model output goes outbound (WhatsApp/SMS), are URLs/commands stripped?
- [ ] Is the AI key server-side (not leaked to the browser)? Is there a per-user/tenant quota (credit exhaustion)?
- [ ] Which personal data goes to which third-party model (find the model name in the code)?

## 6. Security configuration and deployment
- [ ] Security headers: CSP, `X-Frame-Options`/`frame-ancestors`, HSTS, `Referrer-Policy`, `Permissions-Policy`, `X-Content-Type-Options`.
- [ ] **Test the CSP live** (run the production build): do pages and sign-in load? Does a hidden `blob:` worker, an inline script, or an external font/CDN break it? Write down the sources you must allow.
- [ ] No source maps in production; error pages don't leak stack traces; CORS scoped down.

## 7. Scale, data model, maintenance
- [ ] Is there pagination? Does a **default row cap** (~1000 in PostgREST and similar) silently under-report lists/dashboards? (test with many rows)
- [ ] Is revenue/stats computed client-side (wrong/partial)? Move it server-side.
- [ ] Are natural keys normalized (phone: `+90`/`0`/spaces into one form)? Is uniqueness on the normalized value?
- [ ] Do cascade deletes cause data loss? Is there soft-delete / `updated_at` / an audit trail?
- [ ] `npm/bun audit`; pinned versions; a single package manager; is `.env` committed (and why the publishable key is not critical, yet still a bad habit)?

## 8. Personal data (technical side, not legal advice)
- [ ] Which personal data is stored where; is there a retention period / auto-deletion?
- [ ] Erasure and export flows; a short privacy notice on the public form page.
- [ ] Data sent to third parties (AI, telemetry) and its contents.

---

### Method note (how to audit)
- Apply the same schema to **your own** test project / local Postgres; never use real personal data.
- Access control can be tested directly in Postgres by reproducing what the API layer does per request: `set local role anon|authenticated` + `request.jwt.claims` (inside a rolled-back transaction). This is authoritative and fast for RLS; also exercise the real HTTP path.
- For each finding: **failing test first, then the smallest fix, then a passing test.** Put schema changes in a new migration file; don't modify the generator's original migration (the "before" state).
