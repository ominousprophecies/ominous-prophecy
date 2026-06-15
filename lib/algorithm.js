/**
 * ============================================================
 * OMINOUS PROPHECY — Prediction Algorithm
 * ominousprophecy.com
 * 
 * The complete scoring engine that turns raw news signals
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
 * ============================================================
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY  // service role — full write access
);

// ============================================================
// LAYER 1 — SIGNAL COLLECTION
// Gather raw inputs from web search via Claude's search tool
// Returns an array of signal objects for scoring
// ============================================================

/**
 * SYSTEM PROMPT for signal collection
 * Used by the routine to gather raw news signals
 */
export const SIGNAL_COLLECTION_PROMPT = `
You are the signal collection layer of the Ominous Prophecy prediction engine.

Your task: search for current news signals relevant to the given category and topic area.
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
  "source_independence": true if independent of other sources in the list
}

Collect minimum 5, maximum 12 signals per category query.
Prioritise: recent (last 30 days), independent sources, unexpected appearances.
Avoid: opinion pieces, editorials, single-source claims.
`;

// ============================================================
// LAYER 2 — SIGNAL SCORING
// Score each raw signal on 5 dimensions (0-100 each)
// ============================================================

/**
 * Score an individual signal across 5 dimensions
 */
function scoreSignal(signal) {
  const scores = {};

  // 1. RECENCY — how fresh is this signal?
  // Fresh signals carry more weight — older signals decay
  if      (signal.recency_days <= 3)  scores.recency = 100;
  else if (signal.recency_days <= 7)  scores.recency = 85;
  else if (signal.recency_days <= 14) scores.recency = 65;
  else if (signal.recency_days <= 30) scores.recency = 40;
  else                                scores.recency = 15;

  // 2. SOURCE INDEPENDENCE — are multiple independent sources seeing this?
  // Independently verified signals are exponentially more significant
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
  // Anomalies and accelerations are the most prophetically significant
  const typeScores = {
    escalation:   70,   // things getting worse / more intense
    convergence:  85,   // multiple trends pointing the same direction
    anomaly:      90,   // something unusual / out of pattern
    precedent:    60,   // historical parallel
    acceleration: 95    // rate of change increasing — strongest signal
  };
  scores.type = typeScores[signal.signal_type] || 50;

  // 5. SURPRISE FACTOR — appearing where it wasn't expected?
  // Signals that appear in unexpected contexts are leading indicators
  // This is assessed by the Claude analysis layer
  scores.surprise = signal.surprise_factor || 50;

  // Weighted composite signal score
  const weights = {
    recency:      0.25,
    independence: 0.20,
    scope:        0.15,
    type:         0.25,
    surprise:     0.15
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

  return {
    scored_signals: scored,
    metrics: {
      signal_score:       Math.round(signal_score * 100) / 100,
      source_convergence: Math.round(source_convergence * 100) / 100,
      acceleration_score: Math.round(acceleration_score * 100) / 100,
      surprise_factor:    Math.round(surprise_factor * 100) / 100
    }
  };
}

// ============================================================
// LAYER 3 — HISTORICAL BASE RATE
// What is the base probability of this type of event occurring?
// Anchors the score in reality before signal amplification
// ============================================================

/**
 * SYSTEM PROMPT for base rate assessment
 * Claude assesses historical frequency of event type
 */
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
`;

// ============================================================
// LAYER 4 — CATEGORY WEIGHTING
// Different domains have different signal reliability profiles
// Applies a multiplier per category
// ============================================================

const CATEGORY_WEIGHTS = {
  geopolitics: {
    weight:      1.2,
    description: 'Geopolitical signals are historically reliable — state behaviour follows patterns',
    signal_boost: 1.1,   // signals here tend to be leading
    base_dampener: 0.9   // but base rates are lower than perceived
  },
  climate: {
    weight:      1.1,
    description: 'Climate signals are backed by physical data — high reliability at systemic level',
    signal_boost: 1.2,
    base_dampener: 1.0
  },
  technology: {
    weight:      1.0,
    description: 'Tech signals are noisy — high false positive rate, requires convergence',
    signal_boost: 0.8,
    base_dampener: 1.1
  },
  economy: {
    weight:      1.0,
    description: 'Economic signals are lagging — adjust for delay between signal and event',
    signal_boost: 0.9,
    base_dampener: 1.0
  },
  society: {
    weight:      0.9,
    description: 'Social signals are diffuse — require high convergence for reliability',
    signal_boost: 0.8,
    base_dampener: 0.9
  },
  conflict: {
    weight:      1.3,
    description: 'Conflict signals are highly reliable when multiple sources converge',
    signal_boost: 1.3,
    base_dampener: 0.85
  },
  health: {
    weight:      1.1,
    description: 'Health signals benefit from epidemiological data — moderate reliability',
    signal_boost: 1.0,
    base_dampener: 1.0
  },
  energy: {
    weight:      1.0,
    description: 'Energy signals follow commodity and geopolitical patterns',
    signal_boost: 1.0,
    base_dampener: 1.0
  },
  governance: {
    weight:      1.1,
    description: 'Governance signals are reliable when institutional pressure is documented',
    signal_boost: 1.1,
    base_dampener: 0.9
  }
};

function applyCategoryWeight(rawScore, category_slug) {
  const cat = CATEGORY_WEIGHTS[category_slug] || { weight: 1.0, signal_boost: 1.0, base_dampener: 1.0 };
  return Math.min(99, rawScore * cat.weight);
}

/**
 * NARRATIVE RISK ADJUSTMENT (added June 2026)
 *
 * Prophecies issued near the 65% confidence floor that also coincide with
 * near-even betting market odds (e.g. -110/-110, or 45-55% on Polymarket)
 * tend to be "narrative continuation" bets — extending a streak or dynasty
 * narrative — rather than prophecies backed by a genuine signal edge.
 *
 * Case study: both "Ferrari wins Le Mans for the 4th consecutive year" (58%)
 * and "Pereira defeats Gane to become a three-division champion" (58%) were
 * dynasty/legacy narratives issued near-floor, and the betting markets for
 * both were essentially coinflips. Both failed.
 *
 * If the market sees a near-coinflip and the oracle's own raw confidence is
 * only marginally above the issuance floor, pull the confidence down further
 * — this should push genuinely weak narrative bets below the 65% floor so
 * the oracle stays silent on them instead.
 */
function applyNarrativeRiskAdjustment(final_confidence, market_odds_near_even = false) {
  const NARRATIVE_RISK_BAND = [65, 72]; // confidence range considered "marginal"
  const NARRATIVE_RISK_PENALTY = 8;     // points to subtract

  if (
    market_odds_near_even &&
    final_confidence >= NARRATIVE_RISK_BAND[0] &&
    final_confidence <= NARRATIVE_RISK_BAND[1]
  ) {
    return Math.max(5, Math.round((final_confidence - NARRATIVE_RISK_PENALTY) * 100) / 100);
  }
  return final_confidence;
}

/**
 * SERIES-STATE DAMPENER (added June 2026)
 *
 * For multi-game series (NHL/NBA/MLB playoffs, etc.), a team's recent
 * results may not predict the next game if the series outcome is already
 * effectively settled before that game — a "dead rubber". Competitive
 * intensity and roster usage often drop for the side that has already
 * clinched (or been eliminated from) the series.
 *
 * Case study: "Washington sweeps Arizona 3-0" (78% confidence) failed
 * because Washington had already clinched the series 2-1 before Game 3 —
 * Arizona had nothing to lose and won the dead-rubber game 5-1.
 *
 * series_state options:
 *   'normal'      — series outcome still meaningfully in play (no change)
 *   'dead_rubber' — series already decided before this game; pull
 *                   historical_base back toward 50 (more uncertainty)
 */
function applySeriesStateDampener(historical_base, series_state = 'normal') {
  const DEAD_RUBBER_PULL = 0.4; // fraction of the way to pull toward 50

  if (series_state === 'dead_rubber') {
    return Math.round((historical_base + (50 - historical_base) * DEAD_RUBBER_PULL) * 100) / 100;
  }
  return historical_base;
}

// ============================================================
// LAYER 5 — CONFIDENCE ASSEMBLY
// Combine all layers into a single probability score
// ============================================================

/**
 * Assemble the final confidence score from all inputs
 * 
 * Formula:
 *   raw = (signal_score * 0.30)
 *       + (source_convergence * 0.25)
 *       + (historical_base * 0.20)
 *       + (acceleration_score * 0.15)
 *       + (surprise_factor * 0.10)
 * 
 * Then: apply category weight, apply calibration adjustment,
 *       clamp to 5-95 (never absolute certainty or impossibility)
 */
function assembleConfidence(metrics, historical_base, category_slug, calibration_adjustment = 0, market_odds_near_even = false) {
  const {
    signal_score,
    source_convergence,
    acceleration_score,
    surprise_factor
  } = metrics;

  // Weighted combination
  const raw = (
    (signal_score       * 0.30) +
    (source_convergence * 0.25) +
    (historical_base    * 0.20) +
    (acceleration_score * 0.15) +
    (surprise_factor    * 0.10)
  );

  // Apply category weight
  const weighted = applyCategoryWeight(raw, category_slug);

  // Apply self-calibration adjustment (from track record)
  const calibrated = weighted + calibration_adjustment;

  // Apply narrative risk adjustment (see note above) — pulls down
  // near-floor confidence when betting markets see a coinflip
  const narrative_adjusted = applyNarrativeRiskAdjustment(calibrated, market_odds_near_even);

  // Clamp — the oracle never says 100% or 0%
  // Maximum confidence is 95, minimum is 5
  const final = Math.min(95, Math.max(5, Math.round(narrative_adjusted * 100) / 100));

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
// Called once per routine run, updates category adjustments
// ============================================================

async function getCalibrationAdjustment(category_id) {
  // Get the last 90 days of judged prophecies in this category
  // NOTE: category_id must be the UUID from categories.id, not the slug —
  // oracle_accuracy.category_id is a UUID foreign key. Previously this was
  // called with category_slug (e.g. 'geopolitics'), which can never match
  // a UUID column, so this always silently returned 0. Fixed June 2026.
  const { data: accuracy } = await supabase
    .from('oracle_accuracy')
    .select('confidence_adjustment, accuracy_rate, brier_score')
    .eq('category_id', category_id)
    .order('period_start', { ascending: false })
    .limit(1)
    .single();

  if (!accuracy) return 0;

  // If oracle has been overconfident (accuracy < confidence), adjust down
  // If oracle has been underconfident (accuracy > confidence), adjust up
  // Capped at ±15 points to prevent runaway drift
  return Math.min(15, Math.max(-15, accuracy.confidence_adjustment || 0));
}

/**
 * Calculate and store updated calibration scores after new judgments
 * Called by the weekly judgment routine
 */
async function updateCalibration(category_id) {
  // Get last 90 days of resolved prophecies
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const { data: prophecies } = await supabase
    .from('prophecies')
    .select('confidence, status')
    .eq('category_id', category_id)
    .in('status', ['fulfilled', 'failed'])
    .gte('resolved_at', ninetyDaysAgo);

  if (!prophecies || prophecies.length < 3) return; // need minimum sample

  const fulfilled = prophecies.filter(p => p.status === 'fulfilled').length;
  const total = prophecies.length;
  const accuracy_rate = (fulfilled / total) * 100;

  // Brier score: mean squared error between confidence and outcome
  // Perfect = 0, Worst = 1
  const brier_score = prophecies.reduce((sum, p) => {
    const predicted = p.confidence / 100;
    const actual = p.status === 'fulfilled' ? 1 : 0;
    return sum + Math.pow(predicted - actual, 2);
  }, 0) / total;

  // Average predicted confidence
  const avg_confidence = prophecies.reduce((sum, p) => sum + p.confidence, 0) / total;

  // Calibration adjustment: if we're 10% overconfident, adjust -5 (half correction)
  const overconfidence = avg_confidence - accuracy_rate;
  const confidence_adjustment = -(overconfidence * 0.5);

  // Store updated calibration
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

  return { accuracy_rate, brier_score, confidence_adjustment };
}

// ============================================================
// LAYER 7 — ORACULAR VOICE GENERATION
// Transform scored analysis into prophecy prose
// ============================================================

export const ORACULAR_VOICE_PROMPT = `
You are the voice of the Ominous Prophecy Oracle.

Given:
- A factual analysis of current signals
- A probability score
- A category

Generate a prophecy in THREE parts. Return JSON only:

{
  "title": "A clear, declarative prophecy statement in plain language. Present tense or near-future. Maximum 150 characters. No theatrical language here — save that for oracular_text.",
  
  "oracular_text": "2-3 sentences in the voice of an ancient oracle. Use metaphor, historical allusion, and dark imagery. Do not name specific countries, people, or organisations by name — speak in archetypes. This is the theatrical excerpt shown on the card.",
  
  "analysis": "3-4 sentences of clear analytical reasoning. Cite the signal types observed, the historical base rate, and why the confidence score is what it is. Written as authoritative but not sensationalist commentary. This is the full analysis shown in the modal."
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
// Called by the nightly routine for each category
// ============================================================

export async function generateProphecy(category_slug, topic_hint = null, options = {}) {
  console.log(`[Oracle] Generating prophecy for category: ${category_slug}`);

  // options.series_state: 'normal' | 'dead_rubber' — see SERIES-STATE DAMPENER
  // options.market_odds_near_even: boolean — set true if Polymarket/sportsbook
  //   odds for this prophecy are within ~45-55% (near coinflip).
  //   See NARRATIVE RISK ADJUSTMENT.
  const { series_state = 'normal', market_odds_near_even = false } = options;

  try {
    // Get category from DB
    const { data: category } = await supabase
      .from('categories')
      .select('*')
      .eq('slug', category_slug)
      .single();

    if (!category) throw new Error(`Unknown category: ${category_slug}`);

    // Layer 1: Collect signals (Claude with web search)
    // Note: in production this is called via Claude API with web_search tool
    // The routine passes search results here as parsed JSON
    // For now, this is the expected input shape:
    const signals = []; // populated by routine's Claude API call

    // Layer 2: Score signals
    const { scored_signals, metrics } = scoreSignalSet(signals);

    // Layer 3: Get historical base rate (Claude API call)
    let historical_base = 50; // populated by routine's base rate call

    // Apply series-state dampener for sports "dead rubber" games
    historical_base = applySeriesStateDampener(historical_base, series_state);

    // Layer 5 (before 4): Get calibration adjustment from track record
    const calibration_adjustment = await getCalibrationAdjustment(category.id);

    // Layer 4 + 5: Assemble confidence score
    const confidence = assembleConfidence(
      metrics,
      historical_base,
      category_slug,
      calibration_adjustment,
      market_odds_near_even
    );

    // Layer 6: Generate oracular prose (Claude API call)
    // The routine calls Claude with ORACULAR_VOICE_PROMPT and the analysis
    const prophecyContent = {
      title: '',        // populated by routine's Claude API call
      oracular_text: '', // populated by routine's Claude API call
      analysis: ''      // populated by routine's Claude API call
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
// Called by the weekly routine to assess pending prophecies
// ============================================================

export const JUDGMENT_PROMPT = `
You are the fulfillment judgment layer of the Ominous Prophecy Oracle.

Given a prophecy title and its resolution deadline, search current news to determine:

Has this prophecy occurred, clearly failed to occur, or is it still pending?

Return JSON only:
{
  "verdict": one of ["fulfilled", "failed", "pending"],
  "confidence_in_verdict": number 0-100,
  "reasoning": "2-3 sentences explaining the verdict with specific evidence",
  "source_urls": ["url1", "url2"],
  "resolution_date": "YYYY-MM-DD if resolved, null if pending"
}

Standards:
- "fulfilled": the event clearly occurred or is clearly underway
- "failed": the deadline passed without the event occurring, OR it is now impossible
- "pending": insufficient evidence either way — do not force a verdict
- When in doubt, return "pending" — false verdicts damage oracle credibility
`;

export async function judgePendingProphecies() {
  // Get prophecies past their deadline or flagged for judgment
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
      // Note: in production, this calls Claude API with JUDGMENT_PROMPT
      // and web_search tool to verify fulfillment
      // The verdict is returned here as parsed JSON

      const verdict = {
        verdict: 'pending',           // populated by Claude API call
        reasoning: '',                // populated by Claude API call
        resolution_date: null
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

  // After judgments, update calibration scores
  const categories = [...new Set(pending.map(p => p.category_id))];
  for (const cat_id of categories) {
    await updateCalibration(cat_id);
  }

  return results;
}

// ============================================================
// EXPORTS — what the routines import
// ============================================================
export {
  scoreSignal,
  scoreSignalSet,
  assembleConfidence,
  applyCategoryWeight,
  applyNarrativeRiskAdjustment,
  applySeriesStateDampener,
  updateCalibration,
  getCalibrationAdjustment,
  CATEGORY_WEIGHTS,
  SIGNAL_COLLECTION_PROMPT,
  BASE_RATE_PROMPT,
  ORACULAR_VOICE_PROMPT,
  JUDGMENT_PROMPT
};
