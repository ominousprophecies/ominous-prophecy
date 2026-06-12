import { supabaseAdmin } from '../lib/supabase.js';

// ─── Geo detection ────────────────────────────────────────────────────────────
// Vercel sets these headers automatically on every request — zero extra API calls
function getGeo(req) {
  const country = (
    req.headers['x-vercel-ip-country'] ?? 'XX'
  ).toUpperCase();

  const region = (
    req.headers['x-vercel-ip-country-region'] ?? ''
  ).toUpperCase();

  return { country, region };
}

// ─── Build affiliate tracking URL ────────────────────────────────────────────
function buildTrackingUrl(partner, prophecyId) {
  const ref = prophecyId.slice(0, 8);

  const templates = {
    draftkings:  `${partner.base_url}${partner.partner_id}&source=ominous&ref=${ref}`,
    fanduel:     `${partner.base_url}${partner.partner_id}&utm_source=ominous&utm_content=${ref}`,
    betmgm:      `${partner.base_url}${partner.partner_id}_ominous_${ref}`,
    bet365:      `${partner.base_url}${partner.partner_id}&source=ominous`,
    betway:      `${partner.base_url}${partner.partner_id}_ominous`,
    betano:      `${partner.base_url}${partner.partner_id}&ref=ominous`,
    polymarket:  `${partner.base_url}${partner.partner_id}&utm_source=ominous&utm_campaign=${ref}`,
  };

  return templates[partner.name] ?? `${partner.base_url}${partner.partner_id}`;
}

// ─── Polymarket global fallback ───────────────────────────────────────────────
async function getPolymarketFallback(prophecyId) {
  const { data } = await supabaseAdmin
    .from('affiliate_partners')
    .select('id, name, display_name, base_url, partner_id')
    .eq('name', 'polymarket')
    .eq('active', true)
    .single();

  if (!data) return null;

  return {
    partner_id:   data.id,
    partner:      data.name,
    display_name: data.display_name,
    url:          buildTrackingUrl(data, prophecyId),
  };
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const prophecyId = req.query.id;

  // Basic UUID validation
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!prophecyId || !uuidRegex.test(prophecyId)) {
    return res.status(400).json({ error: 'Invalid prophecy ID' });
  }

  const geo       = getGeo(req);
  const sessionId = req.cookies?.op_session ?? null;

  // ── 1. Find best geo rule — region beats country ────────────────────────────
  const { data: rules } = await supabaseAdmin
    .from('affiliate_geo_rules')
    .select(`
      priority,
      region_code,
      affiliate_partners (
        id, name, display_name, base_url, partner_id, active
      )
    `)
    .eq('country_code', geo.country)
    .eq('active', true)
    .order('priority', { ascending: false });

  let partner = null;

  if (rules?.length) {
    // Prefer region-specific match first, fall back to country-level
    const matched =
      rules.find(r => r.region_code && r.region_code === geo.region) ??
      rules[0];

    if (matched?.affiliate_partners?.active) {
      partner = matched.affiliate_partners;
    }
  }

  // ── 2. Fall back to Polymarket if no geo rule matched ───────────────────────
  let result;
  if (partner) {
    result = {
      partner_id:   partner.id,
      partner:      partner.name,
      display_name: partner.display_name,
      url:          buildTrackingUrl(partner, prophecyId),
    };
  } else {
    result = await getPolymarketFallback(prophecyId);
  }

  if (!result) {
    return res.status(404).json({ error: 'No partner available for your region' });
  }

  // ── 3. Log click (fire-and-forget — never block the response) ───────────────
  supabaseAdmin.from('affiliate_clicks').insert({
    prophecy_id:  prophecyId,
    partner_id:   result.partner_id,
    session_id:   sessionId,
    country_code: geo.country,
    region_code:  geo.region || null,
  }).then(() => {});

  // ── 4. Return link data — client does the redirect ──────────────────────────
  return res.status(200).json({
    url:        result.url,
    partner:    result.display_name,
    // Oracle framing — never "exploit" or "+EV"
    cta_label: `Consult the Consensus on ${result.display_name}`,
    country:    geo.country,
  });
}
