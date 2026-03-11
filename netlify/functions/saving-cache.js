import { getStore } from "@netlify/blobs";

export default async (req, context) => {
  // CORS headers
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  const store = getStore("saving-cache");

  try {
    if (req.method === "GET") {
      const data = await store.get("saving-data", { type: "json" });
      if (!data) {
        return new Response(JSON.stringify({ ok: false, reason: "no_cache" }), { headers });
      }
      return new Response(JSON.stringify({ ok: true, ...data }), { headers });
    }

    if (req.method === "POST") {
      const body = await req.json();
      // Validate payload
      if (!body.data || typeof body.data !== "object") {
        return new Response(JSON.stringify({ ok: false, reason: "invalid_payload" }), { status: 400, headers });
      }
      const payload = {
        data: body.data,
        timestamp: Date.now(),
        version: body.version || 6,
        obrasCount: Object.keys(body.data).length
      };
      await store.setJSON("saving-data", payload);
      return new Response(JSON.stringify({ ok: true, saved: payload.obrasCount, timestamp: payload.timestamp }), { headers });
    }

    return new Response(JSON.stringify({ ok: false, reason: "method_not_allowed" }), { status: 405, headers });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers });
  }
};
