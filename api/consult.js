import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

function getGeo(req) {
  const country = (req.headers['x-vercel-ip-country'] ?? 'XX').toUpperCase();
  const region  = (req.headers['x-vercel-ip-country-region'] ?? '').toUpperCase();
  return { country, region };
}

function buildUrl(partner, prophecyId) {
  const ref = prophecyId.slice(0, 8);
  const map = {
    draftkings: `${partner.base_url}${partner.partner_id}&source=ominous&ref=${ref}`,
    fanduel:    `${partner.base_url}${partner.partner_id}&utm_source=ominous&utm_content=${ref}`,
    betmgm:     `${partner.base_url}${partner.partner_id}_ominous_${ref}`,
    bet365:     `${partner.base_url}${partner.partner_id}&source=ominous`,
    betway:     `${partner.base_url}${partner.partner_id}_ominous`,
    betano:     `${partner.base_url}${partner.partner_id}&ref=ominous`,
    polymarket: `${partner.base_url}${partner.partner_id}&utm_source=ominous&utm_campaign=${ref}`,
  };
  return map[partner.name] ?? `${partner.base_url}${partner.partner_id}`;
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

  // Step 1: find best geo rule for this country
  const { data: rules, error: e1 } = await supabase
    .from('affiliate_geo_rules')
    .select('partner_id, region_code, priority')
    .eq('country_code', geo.country)
    .eq('active', true)
    .order('priority', { ascending: false });

  let partnerId = null;

  if (rules?.length) {
    const matched =
      rules.find(r => r.region_code && r.region_code === geo.region) ?? rules[0];
    partnerId = matched?.partner_id ?? null;
  }

  // Step 2: if no geo match, get polymarket id
  if (!partnerId) {
    const { data: pm, error: e2 } = await supabase
      .from('affiliate_partners')
      .select('id')
      .eq('name', 'polymarket')
      .eq('active', true)
      .single();

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
    .single();

  if (!partner) {
    return res.status(200).json({
      debug: true, geo, partnerId,
      e3: e3?.message,
      msg: 'Partner lookup failed'
    });
  }

  // Log click fire-and-forget
  supabase.from('affiliate_clicks').insert({
    prophecy_id:  prophecyId,
    partner_id:   partner.id,
    session_id:   req.cookies?.op_session ?? null,
    country_code: geo.country,
    region_code:  geo.region || null,
  }).then(() => {});

  return res.status(200).json({
    url:       buildUrl(partner, prophecyId),
    partner:   partner.display_name,
    cta_label: `Consult the Consensus on ${partner.display_name}`,
    country:   geo.country,
    region:    geo.region,
  });
}
