import Stripe        from 'stripe';
import { supabaseAdmin } from '../../lib/supabase.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Stripe Price ID → internal tier name
// Set these env vars in Vercel dashboard when you create the products
const PRICE_TO_TIER = {
  [process.env.STRIPE_PRICE_ACOLYTE]:      'acolyte',
  [process.env.STRIPE_PRICE_SEER]:         'seer',
  [process.env.STRIPE_PRICE_HIGH_PROPHET]: 'high_prophet',
};

// ─── Vercel serverless: disable body parsing so Stripe can verify the signature
export const config = {
  api: { bodyParser: false },
};

// ─── Read raw body for Stripe signature verification ─────────────────────────
async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end',  () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawBody  = await getRawBody(req);
  const signature = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Stripe signature failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  try {
    switch (event.type) {

      case 'checkout.session.completed':
        await handleNewSubscription(event.data.object);
        break;

      case 'invoice.paid':
        await handleInvoicePaid(event.data.object);
        break;

      case 'customer.subscription.updated':
        await handleSubscriptionUpdate(event.data.object);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object);
        break;

      default:
        break; // acknowledge and ignore unhandled events
    }

    return res.status(200).json({ received: true });

  } catch (err) {
    console.error(`Error handling ${event.type}:`, err);
    return res.status(500).json({ error: 'Handler failed' });
  }
}

// ─── Event handlers ───────────────────────────────────────────────────────────

async function handleNewSubscription(session) {
  const email      = session.customer_details?.email;
  const customerId = session.customer;
  const subId      = session.subscription;

  if (!email || !customerId || !subId) return;

  const subscription = await stripe.subscriptions.retrieve(subId);
  const priceId      = subscription.items.data[0]?.price.id;
  const tier         = PRICE_TO_TIER[priceId] ?? 'free';

  const { data: user, error } = await supabaseAdmin
    .from('user_profiles')
    .upsert({
      email,
      tier,
      stripe_customer_id:     customerId,
      stripe_subscription_id: subId,
      subscription_status:    'active',
      current_period_start:   new Date(subscription.current_period_start * 1000).toISOString(),
      current_period_end:     new Date(subscription.current_period_end   * 1000).toISOString(),
    }, { onConflict: 'email' })
    .select('id')
    .single();

  if (error || !user) throw new Error(`Failed to upsert user: ${error?.message}`);

  const { error: tokenError } = await supabaseAdmin
    .rpc('refresh_essence_allocation', { p_user_id: user.id });

  if (tokenError) throw new Error(`Failed to grant Essence: ${tokenError.message}`);
}

async function handleInvoicePaid(invoice) {
  // Only process renewal cycles — first payment handled by checkout.session
  if (invoice.billing_reason !== 'subscription_cycle') return;

  const { data: user } = await supabaseAdmin
    .from('user_profiles')
    .select('id')
    .eq('stripe_customer_id', invoice.customer)
    .single();

  if (!user) return;

  await supabaseAdmin.rpc('refresh_essence_allocation', { p_user_id: user.id });
}

async function handleSubscriptionUpdate(sub) {
  const priceId = sub.items.data[0]?.price.id;
  const newTier = PRICE_TO_TIER[priceId] ?? 'free';

  const { data: user } = await supabaseAdmin
    .from('user_profiles')
    .select('id, tier')
    .eq('stripe_customer_id', sub.customer)
    .single();

  if (!user) return;

  await supabaseAdmin
    .from('user_profiles')
    .update({
      tier:                   newTier,
      subscription_status:    sub.status,
      stripe_subscription_id: sub.id,
      current_period_start:   new Date(sub.current_period_start * 1000).toISOString(),
      current_period_end:     new Date(sub.current_period_end   * 1000).toISOString(),
    })
    .eq('id', user.id);

  // On upgrade, immediately grant the new tier's full allocation
  const tierRank = { free: 0, acolyte: 1, seer: 2, high_prophet: 3 };
  const isUpgrade = (tierRank[newTier] ?? 0) > (tierRank[user.tier] ?? 0);

  if (isUpgrade) {
    await supabaseAdmin.rpc('refresh_essence_allocation', { p_user_id: user.id });
  }
}

async function handleSubscriptionDeleted(sub) {
  const { data: user } = await supabaseAdmin
    .from('user_profiles')
    .select('id')
    .eq('stripe_customer_id', sub.customer)
    .single();

  if (!user) return;

  await supabaseAdmin
    .from('user_profiles')
    .update({ tier: 'free', subscription_status: 'cancelled' })
    .eq('id', user.id);

  // Zero out Essence balance on cancellation
  await supabaseAdmin
    .from('essence_ledgers')
    .update({ balance: 0 })
    .eq('user_id', user.id);
}
