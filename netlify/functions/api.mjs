// Interview Field Guide · team archive API for Netlify
// GET              -> list all interviews (add ?kind=guide for interview guides)
// POST (json)      -> create or update one interview
// DELETE ?id=...   -> delete one interview (kept under deleted/ so it can be restored)
// Every call except ?ping=1 needs the header X-Team-Code.
import { getStore } from "@netlify/blobs";

// Team code: set it in Netlify > Site configuration > Environment variables > TEAM_CODE
// (kept out of the code so it never appears in the repository).
const MAX_BYTES = 600000;
const MAX_RECORDS = 500;

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
const idOk = (id) => typeof id === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(id) && !id.includes("..");

function store() {
  if (globalThis.__blobsTestOptions) return getStore({ name: "interviews", ...globalThis.__blobsTestOptions });
  return getStore({ name: "interviews", consistency: "strong" });
}

export default async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.has("ping")) return json(200, { ok: true });

  const expected = (globalThis.Netlify?.env?.get?.("TEAM_CODE")) || process.env.TEAM_CODE || "";
  const given = req.headers.get("x-team-code") || "";
  if (!expected || given !== expected) {
    await new Promise((r) => setTimeout(r, 400));
    return json(401, { error: "bad_code" });
  }

  const s = store();
  // kind=guide -> interview guides, otherwise interviews
  const isGuide = url.searchParams.get("kind") === "guide";
  const PFX = isGuide ? "guide/" : "iv/";
  const DEL = isGuide ? "deleted-guide/" : "deleted/";
  const LIMIT = isGuide ? 100 : MAX_RECORDS;
  const listIv = async () => (await s.list()).blobs.filter((b) => b.key.startsWith(PFX));

  if (req.method === "GET") {
    const blobs = await listIv();
    const items = (await Promise.all(blobs.map((b) => s.get(b.key, { type: "json" })))).filter(Boolean);
    items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return json(200, { items });
  }

  if (req.method === "POST") {
    const raw = await req.text();
    if (raw.length > MAX_BYTES) return json(413, { error: "too_large" });
    let d;
    try { d = JSON.parse(raw); } catch { return json(400, { error: "invalid" }); }
    if (!d || typeof d !== "object" || !idOk(d.id)) return json(400, { error: "invalid" });
    const key = PFX + d.id;
    const existing = await s.get(key);
    if (existing === null) {
      if ((await listIv()).length >= LIMIT) return json(507, { error: "full" });
    }
    await s.setJSON(key, d);
    return json(200, { ok: true });
  }

  if (req.method === "DELETE") {
    const id = url.searchParams.get("id");
    if (!idOk(id)) return json(400, { error: "invalid" });
    const key = PFX + id;
    const d = await s.get(key, { type: "json" });
    if (d) await s.setJSON(DEL + id + "-" + Date.now(), d);
    await s.delete(key);
    return json(200, { ok: true });
  }

  return json(405, { error: "method" });
};

export const config = { path: "/api" };
