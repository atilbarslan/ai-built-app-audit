// SEC-05: every server response carries security headers, and the CSP is sane.
import { describe, it, expect } from "vitest";
import { withSecurityHeaders, SECURITY_HEADERS } from "../../src/lib/security-headers";

describe("SEC-05 - security headers", () => {
  it("adds CSP, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy, HSTS", () => {
    const res = withSecurityHeaders(new Response("<html></html>", { headers: { "content-type": "text/html" } }));
    expect(res.headers.get("content-security-policy")).toBeTruthy();
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("permissions-policy")).toMatch(/camera=\(\)/);
    expect(res.headers.get("strict-transport-security")).toMatch(/max-age=\d+/);
    // body/status preserved
    expect(res.status).toBe(200);
  });

  it("CSP blocks framing and allows the app's real resources (fonts, self, supabase)", () => {
    const csp = SECURITY_HEADERS["Content-Security-Policy"];
    expect(csp).toMatch(/frame-ancestors 'none'/);
    expect(csp).toMatch(/font-src[^;]*fonts\.gstatic\.com/);
    expect(csp).toMatch(/style-src[^;]*fonts\.googleapis\.com/);
    expect(csp).toMatch(/connect-src[^;]*https:/); // supabase/AI gateway (env-specific host)
    expect(csp).toMatch(/object-src 'none'/);
  });

  it("does not overwrite a header that is already set", () => {
    const res = withSecurityHeaders(new Response("x", { headers: { "x-frame-options": "SAMEORIGIN" } }));
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  });
});
