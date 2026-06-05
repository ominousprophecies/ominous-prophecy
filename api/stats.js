import { supabase } from '../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Fetch scoreboard by category
  const { data: scoreboard } = await supabase
    .from('v_oracle_scoreboard')
    .select('*');

  // Fetch overall counts
  const { data: counts } = await supabase
    .from('prophecies')
    .select('status');

  const fulfilled = counts?.filter(p => p.status === 'fulfilled').length || 0;
  const failed    = counts?.filter(p => p.status === 'failed').length || 0;
  const pending   = counts?.filter(p => p.status === 'active').length || 0;
  const total     = counts?.length || 0;
  const judged    = fulfilled + failed;
  const accuracy  = judged > 0 ? Math.round((fulfilled / judged) * 100) : 0;

  // Fetch recent judgments for sidebar
  const { data: recent } = await supabase
    .from('v_recent_judgments')
    .select('*')
    .limit(6);

  // Fetch latest routine run
  const { data: lastRun } = await supabase
    .from('routine_runs')
    .select('routine_type, status, completed_at, prophecies_created')
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(1)
    .single();

  return res.status(200).json({
    overall_accuracy: accuracy,
    total_prophecies: total,
    fulfilled,
    failed,
    pending,
    judged,
    by_category: scoreboard || [],
    recent_judgments: recent || [],
    last_routine_run: lastRun || null
  });
}
