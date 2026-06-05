import { supabase } from '../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { category, limit = 10, offset = 0 } = req.query;

  let query = supabase
    .from('v_active_prophecies')
    .select('*')
    .order('issued_at', { ascending: false })
    .range(Number(offset), Number(offset) + Number(limit) - 1);

  if (category && category !== 'all') {
    query = query.eq('category_slug', category);
  }

  const { data, error } = await query;

  if (error) return res.status(500).json({ error: error.message });

  // Increment view counts in background (non-blocking)
  if (data?.length) {
    data.forEach(p => {
      supabase.rpc('increment_view', { prophecy_uuid: p.id }).then(() => {});
    });
  }

  return res.status(200).json({
    prophecies: data || [],
    hasMore: data?.length === Number(limit)
  });
}
