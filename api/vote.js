import { supabase } from '../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { prophecy_id, vote_type, session_id } = req.body;

  if (!prophecy_id || !vote_type || !session_id) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (!['fulfill', 'doubt'].includes(vote_type)) {
    return res.status(400).json({ error: 'Invalid vote type' });
  }

  // Hash the session_id for privacy before storing
  const ip_hash = Buffer.from(session_id).toString('base64').slice(0, 32);

  const { error } = await supabase
    .from('votes')
    .insert({ prophecy_id, vote_type, session_id, ip_hash });

  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Already voted on this prophecy' });
    }
    return res.status(500).json({ error: error.message });
  }

  // Return updated counts
  const { data: updated } = await supabase
    .from('prophecies')
    .select('vote_fulfill, vote_doubt')
    .eq('id', prophecy_id)
    .single();

  return res.status(200).json({
    success: true,
    vote_fulfill: updated?.vote_fulfill || 0,
    vote_doubt: updated?.vote_doubt || 0
  });
}
