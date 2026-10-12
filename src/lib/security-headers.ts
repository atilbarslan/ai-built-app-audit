// SEC-05: security response headers added to every server response.
//
// CSP notes (kept functional, documented trade-offs):
//  - script-src / style-src allow 'unsafe-inline' because TanStack Start injects
//    inline hydration/router scripts and the app uses inline styles; a stricter
//    nonce-based policy is a recommended follow-up.
//  - style/font allow Google Fonts (used by the app).
//  - connect-src allows https:/wss: so the browser can reach the project's
//    Supabase REST/Auth/Realtime endpoint and the AI gateway (host is env-specific).
//  - frame-ancestors 'none' + X-Frame-Options: DENY stop clickjacking.
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self' https://fonts.gstatic.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "script-src 'self' 'unsafe-inline'",
  // some libraries spin up a Web Worker from a blob: URL; allow that so the app
  // is not broken (worker-src falls back to script-src otherwise).
  "worker-src 'self' blob:",
  "connect-src 'self' https: wss:",
].join("; ");

export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": CSP,
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
};

/** Return a copy of `response` with security headers added (existing ones kept). */
export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(k)) headers.set(k, v);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
