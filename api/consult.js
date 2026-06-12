import { supabase as supabaseAdmin } from '../lib/supabase.js';

function getGeo(req) {
  const country = (req.headers['x-vercel-ip-country'] ?? 'XX').toUpperCase();
  const region  = (req.headers['x-vercel-ip-country-region'] ?? '').toUpperCase();
  return { country, region };
}

function buildTrackingUrl(partner, prophecyId) {
  const ref = prophecyId.slice(0, 8);
  const templates = {
    draftkings: `${partner.base_url}${partner.partner_id}&source=ominous&ref=${ref}`,
    fanduel:    `${partner.base_url}${partner.partner_id}&utm_source=ominous&utm_content=${ref}`,
    betmgm:     `${partner.base_url}${partner.partner_id}_ominous_${ref}`,
    bet365:     `${partner.base_url}${partner.partner_id}&source=ominous`,
    betway:     `${partner.base_url}${partner.partner_id}_ominous`,
    betano:     `${partner.base_url}${partner.partner_id}&ref=ominous`,
    polymarket: `${partner.base_url}${partner.partner_id}&utm_source=ominous&utm_campaign=${ref}`,
  };
  return templates[partner.name] ?? `${partner.base_url}${partner.partner_id}`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const prophecyId = req.query.id;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!prophecyId || !uuidRegex.test(prophecyId)) {
    return res.status(400).json({ error: 'Invalid prophecy ID' });
  }

  const geo = getGeo(req);

  // ── Try geo rules first ──────────────────────────────────────────────────────
  const { data: rules, error: rulesError } = await supabaseAdmin
    .from('affiliate_geo_rules')
    .select(`
      priority, region_code,
      affiliate_partners ( id, name, display_name, base_url, partner_id, active )
    `)
    .eq('country_code', geo.country)
    .eq('active', true)
    .order('priority', { ascending: false });

  let partner = null;
  if (rules?.length) {
    const matched =
      rules.find(r => r.region_code && r.region_code === geo.region) ?? rules[0];
    if (matched?.affiliate_partners?.active) {
      partner = matched.affiliate_partners;
    }
  }

  // ── Always fall back to Polymarket (XX rule covers this) ────────────────────
  if (!partner) {
    const { data: pm, error: pmError } = await supabaseAdmin
      .from('affiliate_partners')
      .select('id, name, display_name, base_url, partner_id')
      .eq('name', 'polymarket')
      .eq('active', true)
      .single();

    if (!pm) {
      // Return debug info so we can see exactly what failed
      return res.status(200).json({
        debug: true,
        geo,
        rules_found: rules?.length ?? 0,
        rules_error: rulesError?.message ?? null,
        pm_error: pmError?.message ?? null,
        message: 'No partner resolved — see debug info above'
      });
    }

    partner = pm;
  }

  const url = buildTrackingUrl(partner, prophecyId);
  const sessionId = req.cookies?.op_session ?? null;

  // Log click fire-and-forget
  supabaseAdmin.from('affiliate_clicks').insert({
    prophecy_id:  prophecyId,
    partner_id:   partner.id,
    session_id:   sessionId,
    country_code: geo.country,
    region_code:  geo.region || null,
  }).then(() => {});

  return res.status(200).json({
    url,
    partner:   partner.display_name,
    cta_label: `Consult the Consensus on ${partner.display_name}`,
    country:   geo.country,
    region:    geo.region,
  });
}
