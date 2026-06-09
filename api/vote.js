import { supabase } from '../lib/supabase.js';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { prophecy_id, vote_type, session_id, email, prophecy_title, prophecy_confidence } = req.body;

  if (!prophecy_id || !vote_type || !session_id) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (!['fulfill', 'doubt'].includes(vote_type)) {
    return res.status(400).json({ error: 'Invalid vote type' });
  }

  const ip_hash = Buffer.from(session_id).toString('base64').slice(0, 32);

  // Save vote to Supabase
  const { error } = await supabase
    .from('votes')
    .insert({ prophecy_id, vote_type, session_id, ip_hash });

  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Already voted on this prophecy' });
    }
    return res.status(500).json({ error: error.message });
  }

  // Get updated counts
  const { data: updated } = await supabase
    .from('prophecies')
    .select('vote_fulfill, vote_doubt')
    .eq('id', prophecy_id)
    .single();

  // Send ballot confirmation email if email provided
  if (email && email.includes('@')) {
    const voteLabel = vote_type === 'fulfill' ? 'THE ORACLE SPEAKS TRUTH' : 'I CAST DOUBT';
    const voteColor = vote_type === 'fulfill' ? '#c9a84c' : '#8b3a3a';
    const voteIcon = vote_type === 'fulfill' ? '◈' : '✦';
    const title = prophecy_title || 'This Prophecy';
    const confidence = prophecy_confidence || '—';

    try {
      await resend.emails.send({
        from: 'The Oracle <onboarding@resend.dev>',
        to: email,
        subject: `Your Ballot Has Been Sealed — Ominous Prophecy`,
        html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#080608;font-family:Georgia,serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#080608;padding:48px 24px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

          <!-- Header -->
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <div style="width:48px;height:48px;margin:0 auto 16px;">
                <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" width="48" height="48">
                  <path d="M2 24 Q12 12 24 11 Q36 12 46 24 Q36 36 24 37 Q12 36 2 24Z" stroke="rgba(201,168,76,0.5)" stroke-width="1" fill="none"/>
                  <circle cx="24" cy="24" r="8" fill="rgba(139,26,26,0.5)" stroke="rgba(201,168,76,0.5)" stroke-width="1"/>
                  <circle cx="24" cy="24" r="3" fill="rgba(201,168,76,0.7)"/>
                </svg>
              </div>
              <div style="font-family:Georgia,serif;font-size:11px;letter-spacing:0.3em;color:#c9a84c;text-transform:uppercase;">Ominous Prophecy</div>
            </td>
          </tr>

          <!-- Title -->
          <tr>
            <td align="center" style="padding-bottom:8px;">
              <div style="font-family:Georgia,serif;font-size:22px;color:#e8e0d0;letter-spacing:0.05em;">Your Ballot Has Been Sealed</div>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <div style="font-family:Georgia,serif;font-size:14px;color:#666;font-style:italic;">"The ledger of voices does not forget."</div>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding-bottom:32px;">
              <div style="height:1px;background:linear-gradient(90deg,transparent,rgba(201,168,76,0.3),transparent);"></div>
            </td>
          </tr>

          <!-- Your Vote -->
          <tr>
            <td style="background:rgba(13,10,16,0.8);border:1px solid rgba(201,168,76,0.15);padding:28px 32px;margin-bottom:24px;">
              <div style="font-family:Courier New,monospace;font-size:9px;letter-spacing:0.2em;color:#555;text-transform:uppercase;margin-bottom:12px;">Your Ballot</div>
              <div style="font-size:28px;color:${voteColor};margin-bottom:8px;">${voteIcon}</div>
              <div style="font-family:Georgia,serif;font-size:16px;letter-spacing:0.15em;color:${voteColor};text-transform:uppercase;margin-bottom:20px;">${voteLabel}</div>
              <div style="font-family:Georgia,serif;font-size:15px;color:#e8e0d0;line-height:1.6;margin-bottom:20px;">${title}</div>
              <div style="display:inline-block;background:rgba(201,168,76,0.08);border:1px solid rgba(201,168,76,0.2);padding:6px 14px;">
                <span style="font-family:Courier New,monospace;font-size:10px;color:#c9a84c;letter-spacing:0.1em;">ORACLE CONFIDENCE: ${confidence}</span>
              </div>
            </td>
          </tr>

          <tr><td style="height:24px;"></td></tr>

          <!-- What happens next -->
          <tr>
            <td style="padding:24px 32px;border:1px solid rgba(255,255,255,0.05);">
              <div style="font-family:Courier New,monospace;font-size:9px;letter-spacing:0.2em;color:#555;text-transform:uppercase;margin-bottom:12px;">What Happens Next</div>
              <div style="font-family:Georgia,serif;font-size:14px;color:#888;line-height:1.8;">
                The Oracle watches. When this prophecy resolves — fulfilled or failed — the verdict will be recorded in the public ledger at ominousprophecy.com. The congregation's accuracy against the Oracle will be calculated.
              </div>
            </td>
          </tr>

          <tr><td style="height:32px;"></td></tr>

          <!-- CTA -->
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <a href="https://ominousprophecy.com/#prophecy-feed" style="display:inline-block;background:transparent;border:1px solid rgba(201,168,76,0.4);color:#c9a84c;font-family:Courier New,monospace;font-size:10px;letter-spacing:0.2em;text-transform:uppercase;padding:14px 28px;text-decoration:none;">
                &#9670; View All Prophecies &#9670;
              </a>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding-bottom:24px;">
              <div style="height:1px;background:linear-gradient(90deg,transparent,rgba(201,168,76,0.15),transparent);"></div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center">
              <div style="font-family:Courier New,monospace;font-size:9px;color:#333;letter-spacing:0.1em;line-height:1.8;">
                OMINOUS PROPHECY &mdash; ominousprophecy.com<br>
                "The future is not hidden. It is merely unread."<br>
                <span style="color:#222;">You received this because you cast a ballot on a prophecy.</span>
              </div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
        `
      });
    } catch (emailErr) {
      // Email failure doesn't fail the vote
      console.error('[Vote] Email send failed:', emailErr);
    }
  }

  return res.status(200).json({
    success: true,
    vote_fulfill: updated?.vote_fulfill || 0,
    vote_doubt: updated?.vote_doubt || 0
  });
}
