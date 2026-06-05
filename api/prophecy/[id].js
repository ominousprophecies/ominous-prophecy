import { supabase } from '../../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;

  if (!id) return res.status(400).json({ error: 'Missing id' });

  const { data, error } = await supabase
    .from('v_active_prophecies')
    .select('*')
    .eq('id', id)
    .single();

  if (error) return res.status(404).json({ error: 'Prophecy not found' });

  // Increment view count
  supabase.rpc('increment_view', { prophecy_uuid: id }).then(() => {});

  return res.status(200).json({ prophecy: data });
}
