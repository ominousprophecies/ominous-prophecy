import { supabase } from '../lib/supabase.js';

function getGeo(req) {
  const headers = req.headers || {};
  // Normalize casing — Vercel edge nodes can vary
  const countryHeader = headers['x-vercel-ip-country'] || headers['X-Vercel-IP-Country'];
  const regionHeader  = headers['x-vercel-ip-country-region'] || headers['X-Vercel-IP-Country-Region'];
  const country = (typeof countryHeader === 'string' ? countryHeader : 'XX').toUpperCase();
  const region  = (typeof regionHeader  === 'string' ? regionHeader  : '').toUpperCase();
  return { country, region };
}

function buildUrl(partner, prophecyId) {
  const ref = prophecyId.slice(0, 8);
  const cleanName = partner.name?.toLowerCase().trim();
  const map = {
    draftkings: `${partner.base_url}${partner.partner_id}&source=ominous&ref=${ref}`,
    fanduel:    `${partner.base_url}${partner.partner_id}&utm_source=ominous&utm_content=${ref}`,
    betmgm:     `${partner.base_url}${partner.partner_id}_ominous_${ref}`,
    bet365:     `${partner.base_url}${partner.partner_id}&source=ominous`,
    betway:     `${partner.base_url}${partner.partner_id}_ominous`,
    betano:     `${partner.base_url}${partner.partner_id}&ref=ominous`,
    polymarket: `${partner.base_url}${partner.partner_id}&utm_source=ominous&utm_campaign=${ref}`,
  };
  return map[cleanName] ?? `${partner.base_url}${partner.partner_id}`;
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

  // Step 1: geo rules — no ORDER BY so we sort in JS (Gemini's priority fix)
  const { data: rules, error: e1 } = await supabase
    .from('affiliate_geo_rules')
    .select('partner_id, region_code, priority')
    .eq('country_code', geo.country)
    .eq('active', true);

  let partnerId = null;

  if (rules?.length) {
    // Region-specific match first
    const regionalMatch = rules.find(r => r.region_code && r.region_code === geo.region);
    if (regionalMatch) {
      partnerId = regionalMatch.partner_id;
    } else {
      // Country-level fallback: prefer null region_code, else highest priority
      const countryFallback =
        rules.find(r => !r.region_code) ??
        rules.sort((a, b) => b.priority - a.priority)[0];
      partnerId = countryFallback?.partner_id ?? null;
    }
  }

  // Step 2: global Polymarket fallback
  if (!partnerId) {
    const { data: pm, error: e2 } = await supabase
      .from('affiliate_partners')
      .select('id')
      .eq('name', 'polymarket')
      .eq('active', true)
      .maybeSingle();

    if (!pm) {
      return res.status(200).json({
        debug: true, geo,
        e1: e1?.message, e2: e2?.message,
        msg: 'No partner resolved'
      });
    }
    partnerId = pm.id;
  }

  // Step 3: fetch partner details
  const { data: partner, error: e3 } = await supabase
    .from('affiliate_partners')
    .select('id, name, display_name, base_url, partner_id')
    .eq('id', partnerId)
    .maybeSingle();

  if (!partner) {
    return res.status(200).json({
      debug: true, geo, partnerId,
      e3: e3?.message,
      msg: 'Partner lookup failed'
    });
  }

  // Step 4: await click log — prevents serverless context shutdown before write
  try {
    await supabase.from('affiliate_clicks').insert({
      prophecy_id:  prophecyId,
      partner_id:   partner.id,
      session_id:   req.cookies?.op_session ?? null,
      country_code: geo.country,
      region_code:  geo.region || null,
    });
  } catch (trackError) {
    console.error('Affiliate click log failed:', trackError);
  }

  return res.status(200).json({
    url:       buildUrl(partner, prophecyId),
    partner:   partner.display_name,
    cta_label: `Consult the Consensus on ${partner.display_name}`,
    country:   geo.country,
    region:    geo.region,
  });
}
