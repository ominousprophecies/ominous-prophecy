/**
 * ============================================================
 * OMINOUS PROPHECY — Prediction Algorithm
 * ominousprophecy.com
 * 
 * The complete scoring engine that turns raw signals
 * into probability-scored prophecies.
 * 
 * Architecture:
 *   Layer 1 — Signal Collection    (gather inputs)
 *   Layer 2 — Signal Scoring       (score each input)
 *   Layer 3 — Category Weighting   (adjust by domain)
 *   Layer 4 — Confidence Assembly  (combine into final score)
 *   Layer 5 — Self-Calibration     (adjust from track record)
 *   Layer 6 — Oracular Voice       (generate the prose)
 *   Layer 7 — Database Write       (save to Supabase)
 *
 * Signal Sources (additive — none removed):
 *   - Web search (existing): verification, facts, historical base rates
 *   - X/Twitter via Grok API (new): velocity, acceleration, trending watch
 *   X signals are treated as velocity indicators only, never as sole
 *   verification. Media sources are not used for current event evaluation
 *   due to narrative lag and editorial filtering.
 * ============================================================
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY  // service role — full write access
);

// ============================================================
// LAYER 1 — SIGNAL COLLECTION
// Gather raw inputs from web search + X/Twitter via Grok API
// Returns an array of signal objects for scoring
// ============================================================

/**
 * SYSTEM PROMPT for signal collection (web search layer)
 * Used by the routine to gather raw news signals
 * X velocity data is collected separately and merged in
 */
export const SIGNAL_COLLECTION_PROMPT = `
You are the signal collection layer of the Ominous Prophecy prediction engine.

Your task: search for current signals relevant to the given category and topic area.
Return a JSON array of signals. No preamble, no markdown, pure JSON only.

For each signal found, return:
{
  "source_url": "full URL",
  "source_name": "publication name",
  "headline": "exact headline",
  "summary": "2-3 sentence factual summary",
  "signal_type": one of ["escalation", "convergence", "anomaly", "precedent", "acceleration"],
  "recency_days": number of days since published,
  "geographic_scope": one of ["local", "regional", "national", "international", "global"],
  "source_independence": true if independent of other sources in the list,
  "x_velocity": 0
}

Note: x_velocity will be populated separately by the Grok API layer and merged in before scoring.
Do not estimate or fabricate x_velocity — leave it as 0.

Collect minimum 5, maximum 12 signals per category query.
Prioritise: recent (last 30 days), independent sources, unexpected appearances.
Avoid: opinion pieces, editorials, single-source claims.
Do NOT use media sources for current event evaluation — use primary sources,
official statements, data feeds, and academic/institutional reports.
`;

/**
 * SYSTEM PROMPT for X/Twitter velocity collection via Grok API
 * Run once per category per nightly cycle
 * Returns velocity scores to be merged into signal objects
 */
export const X_VELOCITY_PROMPT = `
You are the X/Twitter signal velocity layer of the Ominous Prophecy prediction engine.

Your task: search X/Twitter for the given topic and assess real-time signal velocity.
Return pure JSON only. No preamble, no markdown.

Search the last 48 hours on X for the topic keywords provided.

Return:
{
  "topic": "the topic searched",
  "x_velocity": number 0-100 representing current post volume vs 7-day average
    (0 = no activity, 50 = average, 100 = 3x+ above average),
  "sentiment_shift": one of ["fear", "urgency", "anger", "neutral", "hope"],
  "unexpected_amplifiers": true if accounts outside usual political/media sphere are posting,
  "trending": true if currently in X trending topics,
  "velocity_reasoning": "one sentence explaining the velocity score",
  "sample_themes": ["theme1", "theme2", "theme3"] — recurring themes in posts, no usernames
}

Important:
- X signals are velocity indicators only — not verification of facts
- Do not treat X consensus as ground truth
- High velocity + unexpected amplifiers = strongest acceleration signal
- Report what is being said, not who is saying it — no usernames or account handles
`;

/**
 * SYSTEM PROMPT for X trending watch
 * Run as part of the nightly routine to surface new prophecy candidates
 */
export const X_TRENDING_WATCH_PROMPT = `
You are the trending watch layer of the Ominous Prophecy prediction engine.

Your task: scan current X/Twitter trending topics and identify any that intersect with
oracle prediction categories. Return pure JSON only.

Oracle categories: geopolitics, climate, technology, economy, society, conflict, health, energy, governance

For each trending topic that intersects with an oracle category:
{
  "topic": "topic name",
  "category": "oracle category it maps to",
  "x_velocity": 0-100,
  "trending_rank": position in trending list if known,
  "summary": "one sentence on what is happening",
  "meets_threshold": true if you estimate 65%+ confidence threshold could be reached,
  "flag_for_nightly": true if this should be queued for prophecy consideration tonight
}

Return:
{
  "scan_timestamp": "ISO timestamp",
  "trending_candidates": [ ...array of above objects... ],
  "high_priority_flags": number of items with flag_for_nightly = true
}

Do not surface entertainment, sports celebrity, or trivial trending topics.
Focus on systemic events, institutional shifts, and macro-level developments.
`;

// ============================================================
// LAYER 2 — SIGNAL SCORING
// Score each raw signal on 6 dimensions (0-100 each)
// X velocity is the 6th dimension — additive, not replacing existing
// ============================================================

/**
 * Score an individual signal across 6 dimensions
 */
function scoreSignal(signal) {
  const scores = {};

  // 1. RECENCY — how fresh is this signal?
  if      (signal.recency_days <= 3)  scores.recency = 100;
  else if (signal.recency_days <= 7)  scores.recency = 85;
  else if (signal.recency_days <= 14) scores.recency = 65;
  else if (signal.recency_days <= 30) scores.recency = 40;
  else                                scores.recency = 15;

  // 2. SOURCE INDEPENDENCE — multiple independent sources?
  scores.independence = signal.source_independence ? 80 : 20;

  // 3. GEOGRAPHIC SCOPE — how wide is the signal's reach?
  const scopeScores = {
    local:         20,
    regional:      40,
    national:      60,
    international: 80,
    global:        100
  };
  scores.scope = scopeScores[signal.geographic_scope] || 50;

  // 4. SIGNAL TYPE — what kind of signal is this?
  const typeScores = {
    escalation:   70,
    convergence:  85,
    anomaly:      90,
    precedent:    60,
    acceleration: 95
  };
  scores.type = typeScores[signal.signal_type] || 50;

  // 5. SURPRISE FACTOR — appearing where it wasn't expected?
  scores.surprise = signal.surprise_factor || 50;

  // 6. X VELOCITY — real-time acceleration on X/Twitter (Grok API)
  // 0 = no X data available, treated as neutral
  // This is a velocity indicator only — not a fact verification source
  scores.x_velocity = signal.x_velocity || 0;

  // Weighted composite — existing weights adjusted to accommodate X velocity
  // Total still sums to 1.0
  const weights = {
    recency:      0.22,  // was 0.25 — slight reduction to add X layer
    independence: 0.18,  // was 0.20
    scope:        0.13,  // was 0.15
    type:         0.22,  // was 0.25
    surprise:     0.13,  // was 0.15
    x_velocity:   0.12   // new — X real-time acceleration signal
  };

  const composite = Object.keys(weights).reduce((sum, key) => {
    return sum + (scores[key] * weights[key]);
  }, 0);

  return {
    ...scores,
    composite: Math.round(composite * 100) / 100
  };
}

/**
 * Score a full set of signals and derive aggregate metrics
 */
function scoreSignalSet(signals) {
  const scored = signals.map(s => ({ ...s, scores: scoreSignal(s) }));

  // Signal strength — average composite across all signals
  const signal_score = scored.reduce((sum, s) => sum + s.scores.composite, 0) / scored.length;

  // Source convergence — how many independent sources?
  const independent = signals.filter(s => s.source_independence).length;
  const source_convergence = Math.min(100, (independent / signals.length) * 100 * 1.5);

  // Acceleration score — proportion of acceleration/anomaly signals
  const highType = signals.filter(s => ['acceleration', 'anomaly', 'convergence'].includes(s.signal_type)).length;
  const acceleration_score = (highType / signals.length) * 100;

  // Surprise factor — signals appearing in unexpected geographic contexts
  const globalUnexpected = signals.filter(s => s.geographic_scope === 'global' && s.signal_type === 'anomaly').length;
  const surprise_factor = Math.min(100, globalUnexpected * 25);

  // X velocity aggregate — average across all signals with X data
  const xSignals = signals.filter(s => s.x_velocity > 0);
  const x_velocity_aggregate = xSignals.length > 0
    ? xSignals.reduce((sum, s) => sum + s.x_velocity, 0) / xSignals.length
    : 0;

  return {
    scored_signals: scored,
    metrics: {
      signal_score:         Math.round(signal_score * 100) / 100,
      source_convergence:   Math.round(source_convergence * 100) / 100,
      acceleration_score:   Math.round(acceleration_score * 100) / 100,
      surprise_factor:      Math.round(surprise_factor * 100) / 100,
      x_velocity_aggregate: Math.round(x_velocity_aggregate * 100) / 100
    }
  };
}

// ============================================================
// LAYER 3 — HISTORICAL BASE RATE
// What is the base probability of this type of event occurring?
// Anchors the score in reality before signal amplification
// ============================================================

export const BASE_RATE_PROMPT = `
You are assessing the historical base rate for a type of world event.

Given the prophecy topic, estimate:
- How often has this type of event occurred in the last 50 years?
- What is the base probability per year (0-100)?

Return JSON only:
{
  "base_rate": number between 0-100,
  "reasoning": "one sentence explanation",
  "historical_examples": ["example 1", "example 2"],
  "last_occurrence_years_ago": number or null
}

Be conservative. Most dramatic events have lower base rates than intuition suggests.
Use primary sources and institutional data for base rate reasoning.
Do not use media framing — base rates are statistical, not narrative.
`;

// ============================================================
// LAYER 4 — CATEGORY WEIGHTING
// Different domains have different signal reliability profiles
// ============================================================

const CATEGORY_WEIGHTS = {
  geopolitics: {
    weight:      1.2,
    description: 'Geopolitical signals are historically reliable — state behaviour follows patterns',
    signal_boost: 1.1,
    base_dampener: 0.9,
    x_weight_modifier: 1.0  // X velocity is normally reliable for geopolitics
  },
  climate: {
    weight:      1.1,
    description: 'Climate signals are backed by physical data — high reliability at systemic level',
    signal_boost: 1.2,
    base_dampener: 1.0,
    x_weight_modifier: 0.8  // X often amplifies weather events — slight dampener
  },
  technology: {
    weight:      1.0,
    description: 'Tech signals are noisy — high false positive rate, requires convergence',
    signal_boost: 0.8,
    base_dampener: 1.1,
    x_weight_modifier: 1.2  // X is an early signal layer for tech — slight boost
  },
  economy: {
    weight:      1.0,
    description: 'Economic signals are lagging — adjust for delay between signal and event',
    signal_boost: 0.9,
    base_dampener: 1.0,
    x_weight_modifier: 0.9  // Economic X signals are often reactive not predictive
  },
  society: {
    weight:      0.9,
    description: 'Social signals are diffuse — require high convergence for reliability',
    signal_boost: 0.8,
    base_dampener: 0.9,
    x_weight_modifier: 1.3  // X is a primary signal source for social movements
  },
  conflict: {
    weight:      1.3,
    description: 'Conflict signals are highly reliable when multiple sources converge',
    signal_boost: 1.3,
    base_dampener: 0.85,
    x_weight_modifier: 1.1  // X often has firsthand conflict signals before media
  },
  health: {
    weight:      1.1,
    description: 'Health signals benefit from epidemiological data — moderate reliability',
    signal_boost: 1.0,
    base_dampener: 1.0,
    x_weight_modifier: 0.7  // Health X signals are noisy and often misinformation-heavy
  },
  energy: {
    weight:      1.0,
    description: 'Energy signals follow commodity and geopolitical patterns',
    signal_boost: 1.0,
    base_dampener: 1.0,
    x_weight_modifier: 0.9
  },
  governance: {
    weight:      1.1,
    description: 'Governance signals are reliable when institutional pressure is documented',
    signal_boost: 1.1,
    base_dampener: 0.9,
    x_weight_modifier: 1.0
  }
};

function applyCategoryWeight(rawScore, category_slug) {
  const cat = CATEGORY_WEIGHTS[category_slug] || { weight: 1.0, signal_boost: 1.0, base_dampener: 1.0 };
  return Math.min(99, rawScore * cat.weight);
}

// ============================================================
// LAYER 5 — CONFIDENCE ASSEMBLY
// Combine all layers into a single probability score
// ============================================================

/**
 * Assemble the final confidence score from all inputs
 *
 * Formula:
 *   raw = (signal_score       * 0.28)
 *       + (source_convergence * 0.23)
 *       + (historical_base    * 0.20)
 *       + (acceleration_score * 0.15)
 *       + (surprise_factor    * 0.09)
 *       + (x_velocity         * 0.05)
 *
 * X velocity contributes 5% to confidence assembly — it informs
 * the score but cannot override the verification-based layers.
 *
 * Then: apply category weight, apply calibration adjustment,
 *       clamp to 5-95 (never absolute certainty or impossibility)
 */
function assembleConfidence(metrics, historical_base, category_slug, calibration_adjustment = 0) {
  const {
    signal_score,
    source_convergence,
    acceleration_score,
    surprise_factor,
    x_velocity_aggregate = 0
  } = metrics;

  const raw = (
    (signal_score         * 0.28) +
    (source_convergence   * 0.23) +
    (historical_base      * 0.20) +
    (acceleration_score   * 0.15) +
    (surprise_factor      * 0.09) +
    (x_velocity_aggregate * 0.05)
  );

  const weighted = applyCategoryWeight(raw, category_slug);
  const calibrated = weighted + calibration_adjustment;
  const final = Math.min(95, Math.max(5, Math.round(calibrated * 100) / 100));

  return {
    raw:         Math.round(raw * 100) / 100,
    weighted:    Math.round(weighted * 100) / 100,
    calibrated:  Math.round(calibrated * 100) / 100,
    final:       final
  };
}

// ============================================================
// LAYER 6 — SELF-CALIBRATION
// Read the oracle's track record and adjust future scores
// ============================================================

async function getCalibrationAdjustment(category_slug) {
  const { data: accuracy } = await supabase
    .from('oracle_accuracy')
    .select('confidence_adjustment, accuracy_rate, brier_score')
    .eq('category_id', category_slug)
    .order('period_start', { ascending: false })
    .limit(1)
    .single();

  if (!accuracy) return 0;
  return Math.min(15, Math.max(-15, accuracy.confidence_adjustment || 0));
}

async function updateCalibration(category_id) {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const { data: prophecies } = await supabase
    .from('prophecies')
    .select('confidence, status')
    .eq('category_id', category_id)
    .in('status', ['fulfilled', 'failed'])
    .gte('resolved_at', ninetyDaysAgo);

  if (!prophecies || prophecies.length < 3) return;

  const fulfilled = prophecies.filter(p => p.status === 'fulfilled').length;
  const total = prophecies.length;
  const accuracy_rate = (fulfilled / total) * 100;

  const brier_score = prophecies.reduce((sum, p) => {
    const predicted = p.confidence / 100;
    const actual = p.status === 'fulfilled' ? 1 : 0;
    return sum + Math.pow(predicted - actual, 2);
  }, 0) / total;

  const avg_confidence = prophecies.reduce((sum, p) => sum + p.confidence, 0) / total;
  const overconfidence = avg_confidence - accuracy_rate;
  const confidence_adjustment = -(overconfidence * 0.5);

  await supabase.from('oracle_accuracy').insert({
    category_id,
    period_start: ninetyDaysAgo,
    period_end: new Date().toISOString(),
    total_prophecies: total,
    fulfilled_count: fulfilled,
    failed_count: total - fulfilled,
    accuracy_rate: Math.round(accuracy_rate * 100) / 100,
    brier_score: Math.round(brier_score * 10000) / 10000,
    confidence_adjustment: Math.round(confidence_adjustment * 100) / 100
  });
}

function calculateAccuracyMetrics(prophecies) {
  const fulfilled = prophecies.filter(p => p.status === 'fulfilled').length;
  const total = prophecies.length;
  const accuracy_rate = total > 0 ? (fulfilled / total) * 100 : 0;

  const brier_score = total > 0 ? prophecies.reduce((sum, p) => {
    const predicted = p.confidence / 100;
    const actual = p.status === 'fulfilled' ? 1 : 0;
    return sum + Math.pow(predicted - actual, 2);
  }, 0) / total : 0;

  const avg_confidence = total > 0
    ? prophecies.reduce((sum, p) => sum + p.confidence, 0) / total
    : 0;

  const confidence_adjustment = -(((avg_confidence - accuracy_rate)) * 0.5);

  return { accuracy_rate, brier_score, confidence_adjustment };
}

// ============================================================
// LAYER 7 — ORACULAR VOICE GENERATION
// ============================================================

export const ORACULAR_VOICE_PROMPT = `
You are the voice of the Ominous Prophecy Oracle.

Given:
- A factual analysis of current signals (web + X velocity)
- A probability score
- A category

Generate a prophecy in THREE parts. Return JSON only:

{
  "title": "A clear, declarative prophecy statement in plain language. Present tense or near-future. Maximum 150 characters. No theatrical language here — save that for oracular_text.",
  
  "oracular_text": "2-3 sentences in the voice of an ancient oracle. Use metaphor, historical allusion, and dark imagery. Do not name specific countries, people, or organisations by name — speak in archetypes. This is the theatrical excerpt shown on the card.",
  
  "analysis": "3-4 sentences of clear analytical reasoning. Cite the signal types observed, the historical base rate, X velocity indicators if significant, and why the confidence score is what it is. Written as authoritative but not sensationalist commentary. This is the full analysis shown in the modal."
}

Tone guidelines:
- Title: journalistic, specific, measurable
- Oracular text: theatrical, metaphorical, timeless
- Analysis: authoritative, evidence-based, measured

Never predict specific deaths, natural disasters affecting named people, or personal harm.
Never name living individuals in prophecy titles.
Focus on systemic events, institutional shifts, and macro trends.
`;

// ============================================================
// MASTER FUNCTION — generateProphecy()
// Orchestrates all layers to produce one complete prophecy
// ============================================================

export async function generateProphecy(category_slug, topic_hint = null, x_velocity_data = null) {
  console.log(`[Oracle] Generating prophecy for category: ${category_slug}`);

  try {
    const { data: category } = await supabase
      .from('categories')
      .select('*')
      .eq('slug', category_slug)
      .single();

    if (!category) throw new Error(`Unknown category: ${category_slug}`);

    // Layer 1: Signals populated by routine's Claude API call (web search)
    // x_velocity_data populated by routine's Grok API call
    // Both are merged here before scoring
    let signals = []; // populated by routine

    // Merge X velocity data into signals if available
    if (x_velocity_data && x_velocity_data.x_velocity > 0) {
      signals = signals.map(s => ({
        ...s,
        x_velocity: x_velocity_data.x_velocity,
        x_unexpected_amplifiers: x_velocity_data.unexpected_amplifiers
      }));
    }

    // Layer 2: Score signals
    const { scored_signals, metrics } = scoreSignalSet(signals);

    // Layer 3: Base rate populated by routine
    const historical_base = 50;

    // Layer 5: Calibration
    const calibration_adjustment = await getCalibrationAdjustment(category_slug);

    // Layer 4+5: Confidence
    const confidence = assembleConfidence(
      metrics,
      historical_base,
      category_slug,
      calibration_adjustment
    );

    // Layer 6: Oracular prose populated by routine
    const prophecyContent = {
      title: '',
      oracular_text: '',
      analysis: ''
    };

    // Layer 7: Write to Supabase
    const { data: prophecy, error } = await supabase
      .from('prophecies')
      .insert({
        title:              prophecyContent.title,
        oracular_text:      prophecyContent.oracular_text,
        analysis:           prophecyContent.analysis,
        category_id:        category.id,
        confidence:         confidence.final,
        signal_score:       metrics.signal_score,
        source_convergence: metrics.source_convergence,
        acceleration_score: metrics.acceleration_score,
        surprise_factor:    metrics.surprise_factor,
        historical_base:    historical_base,
        search_signals:     scored_signals,
        resolution_deadline: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        generated_by:       'oracle_routine'
      })
      .select()
      .single();

    if (error) throw error;

    console.log(`[Oracle] Prophecy created: ${prophecy.id} | Confidence: ${confidence.final}%`);
    return prophecy;

  } catch (err) {
    console.error(`[Oracle] Error generating prophecy:`, err);
    throw err;
  }
}

// ============================================================
// FULFILLMENT JUDGMENT ENGINE
// ============================================================

export const JUDGMENT_PROMPT = `
You are the fulfillment judgment layer of the Ominous Prophecy Oracle.

Given a prophecy title and its resolution deadline, use BOTH web search and X/Twitter
to determine whether the prophecy has been fulfilled, failed, or remains pending.

Verification hierarchy:
1. Official sources / primary data (highest weight)
2. Multiple independent web sources
3. X/Twitter consensus (supporting evidence only — not sole basis for verdict)

X/Twitter usage: X is the fastest confirmation source for real-world events.
If X shows clear consensus that an event occurred (high volume, multiple independent
accounts, no significant counter-narrative), weight this as supporting evidence.
X alone is never sufficient for a verdict — must be corroborated by web sources.

Return JSON only:
{
  "verdict": one of ["fulfilled", "failed", "pending"],
  "confidence_in_verdict": number 0-100,
  "reasoning": "2-3 sentences explaining the verdict with specific evidence",
  "source_urls": ["url1", "url2"],
  "x_signal_used": true if X data informed the verdict,
  "x_signal_summary": "one sentence on what X showed, or null",
  "resolution_date": "YYYY-MM-DD if resolved, null if pending"
}

Standards:
- "fulfilled": the event clearly occurred or is clearly and measurably underway
- "failed": the deadline passed without the event occurring, OR it is now impossible
- "pending": insufficient evidence either way — do not force a verdict
- When in doubt, return "pending" — false verdicts damage oracle credibility
`;

export async function judgePendingProphecies() {
  const { data: pending } = await supabase
    .from('prophecies')
    .select('*, categories(slug)')
    .in('status', ['active', 'pending_judgment'])
    .lt('resolution_deadline', new Date().toISOString())
    .limit(20);

  if (!pending || pending.length === 0) {
    console.log('[Oracle] No prophecies pending judgment');
    return [];
  }

  const results = [];

  for (const prophecy of pending) {
    try {
      const verdict = {
        verdict: 'pending',
        reasoning: '',
        resolution_date: null,
        x_signal_used: false,
        x_signal_summary: null
      };

      if (verdict.verdict !== 'pending') {
        await supabase
          .from('prophecies')
          .update({
            status:           verdict.verdict,
            resolved_at:      verdict.resolution_date || new Date().toISOString(),
            resolution_notes: verdict.reasoning
          })
          .eq('id', prophecy.id);

        results.push({ id: prophecy.id, verdict: verdict.verdict });
        console.log(`[Oracle] Judged ${prophecy.id}: ${verdict.verdict}`);
      }
    } catch (err) {
      console.error(`[Oracle] Judgment error for ${prophecy.id}:`, err);
    }
  }

  const categories = [...new Set(pending.map(p => p.category_id))];
  for (const cat_id of categories) {
    await updateCalibration(cat_id);
  }

  return results;
}

// ============================================================
// EXPORTS
// ============================================================
export {
  scoreSignal,
  scoreSignalSet,
  assembleConfidence,
  applyCategoryWeight,
  updateCalibration,
  getCalibrationAdjustment,
  calculateAccuracyMetrics,
  CATEGORY_WEIGHTS,
  SIGNAL_COLLECTION_PROMPT,
  X_VELOCITY_PROMPT,
  X_TRENDING_WATCH_PROMPT,
  BASE_RATE_PROMPT,
  ORACULAR_VOICE_PROMPT,
  JUDGMENT_PROMPT
};
