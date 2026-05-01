// ═══════════════════════════════════════════════════════════
// PROXY.JS — AI API proxy configuration
//
// SECURITY: Never put your Anthropic API key directly in
// browser JavaScript — it will be visible to anyone using
// DevTools. Use one of these approaches instead:
//
// OPTION A (Recommended — Cloudflare Worker, free):
//   1. Create a free Cloudflare account at cloudflare.com
//   2. Go to Workers & Pages → Create Worker
//   3. Paste the worker code below into the editor
//   4. Add your ANTHROPIC_API_KEY as a secret env var
//   5. Set PROXY_URL below to your worker URL
//
// OPTION B (Vercel Edge Function):
//   Deploy a Next.js or plain Vercel project with an
//   /api/ai-proxy edge function. See vercel.com/docs.
//
// OPTION C (Local dev only):
//   Set PROXY_URL to "" to call Anthropic directly.
//   This only works in local dev with CORS disabled or a
//   browser extension. NEVER do this in production.
//
// ── Cloudflare Worker code (paste into CF editor) ──────────
//
// export default {
//   async fetch(req, env) {
//     if (req.method === "OPTIONS") {
//       return new Response(null, { headers: corsHeaders(req) });
//     }
//     const body = await req.text();
//     const res  = await fetch("https://api.anthropic.com/v1/messages", {
//       method:  "POST",
//       headers: {
//         "Content-Type":      "application/json",
//         "x-api-key":         env.ANTHROPIC_API_KEY,
//         "anthropic-version": "2023-06-01",
//       },
//       body,
//     });
//     const data = await res.text();
//     return new Response(data, {
//       status:  res.status,
//       headers: { "Content-Type": "application/json", ...corsHeaders(req) },
//     });
//   },
// };
//
// function corsHeaders(req) {
//   const origin = req.headers.get("Origin") || "*";
//   return {
//     "Access-Control-Allow-Origin":  origin,
//     "Access-Control-Allow-Methods": "POST, OPTIONS",
//     "Access-Control-Allow-Headers": "Content-Type",
//   };
// }
// ═══════════════════════════════════════════════════════════

// Set this to your Cloudflare Worker / Vercel proxy URL.
// Leave as "" to attempt direct calls (local dev only).
export const PROXY_URL = "";

// The model to use for AI coach responses
export const AI_MODEL = "claude-sonnet-4-20250514";
