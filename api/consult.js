import https from 'https';

const SUPABASE_URL = 'https://wpcfeshynosbwmnnbipk.supabase.co';
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Pure Node.js HTTPS fetch — no Supabase client, no fetch API
function query(table, filters) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({ select: '*' });
    for (const [k, v] of Object.entries(filters)) {
      params.append(k, `eq.${v}`);
    }
    const url = new URL(`${SUPABASE_URL}/rest/v1/${table}?${params}`);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function insert(table, row) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(row);
    const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
        'Content-Length': Buffer.byteLength(body),
      }
    };
    const req = https.request(options, (res) => {
      res.on('data', () => {});
      res.on('end', resolve);
    });
    req.on('error', () => {}); // fire and forget
    req.write(body);
    req.end();
  });
}

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
  return map[partner.name?.toLowerCase()] ?? `${partner.base_url}${partner.partner_id}`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Accept either a UUID id or a prophecy title
  const prophecyId = req.query.id || req.query.title || 'unknown';
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  // Use first 8 chars of title as ref if not a UUID
  const refId = uuidRegex.test(prophecyId) ? prophecyId : prophecyId.slice(0, 8);

  const geo = getGeo(req);

  try {
    // Step 1: get geo rules for this country
    const rules = await query('affiliate_geo_rules', { country_code: geo.country, active: 'true' });

    let partnerId = null;
    if (Array.isArray(rules) && rules.length) {
      const regional = rules.find(r => r.region_code && r.region_code === geo.region);
      const fallback = rules.find(r => !r.region_code) ?? rules.sort((a,b) => b.priority - a.priority)[0];
      partnerId = (regional ?? fallback)?.partner_id ?? null;
    }

    // Step 2: polymarket fallback
    if (!partnerId) {
      const pm = await query('affiliate_partners', { name: 'polymarket', active: 'true' });
      if (Array.isArray(pm) && pm.length) partnerId = pm[0].id;
    }

    if (!partnerId) {
      return res.status(200).json({ debug: true, geo, msg: 'No partner found' });
    }

    // Step 3: get partner details
    const partners = await query('affiliate_partners', { id: partnerId });
    if (!Array.isArray(partners) || !partners.length) {
      return res.status(200).json({ debug: true, geo, partnerId, msg: 'Partner lookup failed' });
    }
    const partner = partners[0];

    // Step 4: log click (fire and forget)
    insert('affiliate_clicks', {
      prophecy_id:  uuidRegex.test(prophecyId) ? prophecyId : null,
      partner_id:   partner.id,
      session_id:   req.cookies?.op_session ?? null,
      country_code: geo.country,
      region_code:  geo.region || null,
    }).catch(() => {});

    return res.status(200).json({
      url:       buildUrl(partner, refId),
      partner:   partner.display_name,
      cta_label: `Consult the Consensus on ${partner.display_name}`,
      country:   geo.country,
      region:    geo.region,
    });

  } catch (err) {
    return res.status(500).json({ error: err.message, geo });
  }
}
