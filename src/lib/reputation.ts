export interface ReputationState {
  score: number;
  tier: 'premium' | 'standard' | 'curious' | 'throttled' | 'restricted';
  lastSeen: number;
  history: Array<{ action: string; delta: number; ts: number }>;
  burstWindow: number[];
  queries: Array<{ query: string; ts: number }>;
  sessionIds: string[];
  turnstilePassed: boolean;
}

const BURST_WINDOW_MS = 10_000;
const BURST_THRESHOLD = 5;

const DECAY_INTERVAL_MS = 30 * 60_000;
const DECAY_AMOUNT = 1;
const RESET_IDLE_MS = 2 * 60 * 60_000;

function computeTier(score: number): ReputationState['tier'] {
  if (score <= 3) return 'premium';
  if (score <= 8) return 'standard';
  if (score <= 12) return 'curious';
  if (score <= 18) return 'throttled';
  return 'restricted';
}

export function getDefaultState(): ReputationState {
  const score = 5;
  return {
    score,
    tier: computeTier(score),
    lastSeen: Date.now(),
    history: [],
    burstWindow: [],
    queries: [],
    sessionIds: [],
    turnstilePassed: false,
  };
}

function pushHistory(state: ReputationState, action: string, delta: number) {
  state.history.push({ action, delta, ts: Date.now() });
  if (state.history.length > 50) state.history = state.history.slice(-50);
}

export function applyDecay(state: ReputationState): ReputationState {
  const now = Date.now();
  const idle = now - state.lastSeen;

  if (idle >= RESET_IDLE_MS) {
    return getDefaultState();
  }

  if (idle >= DECAY_INTERVAL_MS) {
    const intervals = Math.floor(idle / DECAY_INTERVAL_MS);
    const reduction = intervals * DECAY_AMOUNT;
    state.score = Math.max(0, state.score - reduction);
  }

  state.tier = computeTier(state.score);
  return state;
}

export function updateReputation(
  state: ReputationState,
  event: 'request' | 'burst' | 'turnstile_pass' | 'turnstile_fail' | 'session_long' |
         'natural_message' | 'bot_ua' | 'dup_query' | 'session_hijack' | 'disconnect' |
         'datacenter_ip',
  details?: { message?: string; sessionId?: string; userAgent?: string; ip?: string; asn?: string },
): ReputationState {
  applyDecay(state);
  state.lastSeen = Date.now();

  switch (event) {
    case 'request': {
      state.burstWindow.push(Date.now());
      state.burstWindow = state.burstWindow.filter(t => Date.now() - t < BURST_WINDOW_MS);

      if (state.burstWindow.length >= BURST_THRESHOLD) {
        state.score += 3;
        pushHistory(state, 'burst_detected', 3);
      }
      break;
    }

    case 'burst':
      state.score += 3;
      pushHistory(state, 'burst', 3);
      break;

    case 'turnstile_pass':
      state.turnstilePassed = true;
      state.score = Math.max(0, state.score - 1);
      pushHistory(state, 'turnstile_pass', -1);
      break;

    case 'turnstile_fail':
      state.score += 5;
      pushHistory(state, 'turnstile_fail', 5);
      break;

    case 'session_long': {
      state.score = Math.max(0, state.score - 1);
      pushHistory(state, 'session_long', -1);
      break;
    }

    case 'natural_message': {
      const msg = details?.message || '';
      const wordCount = msg.split(/\s+/).filter(w => w.length > 0).length;
      const hasPunctuation = /[.,;:!?]/.test(msg);
      const isNatural = wordCount > 3 && hasPunctuation;

      if (isNatural) {
        state.score = Math.max(0, state.score - 0.5);
        pushHistory(state, 'natural_message', -0.5);
      }
      break;
    }

    case 'bot_ua': {
      state.score += 5;
      pushHistory(state, 'bot_ua', 5);
      break;
    }

    case 'datacenter_ip': {
      state.score += 3;
      pushHistory(state, 'datacenter_ip', 3);
      break;
    }

    case 'dup_query': {
      const q = details?.message || '';
      const now = Date.now();
      const recent = state.queries.filter(r => now - r.ts < 60_000);

      if (recent.some(r => r.query === q)) {
        state.score += 2;
        pushHistory(state, 'dup_query', 2);
      }

      state.queries.push({ query: q, ts: now });
      if (state.queries.length > 100) state.queries = state.queries.slice(-100);
      break;
    }

    case 'session_hijack': {
      state.score += 4;
      pushHistory(state, 'session_hijack', 4);
      break;
    }

    case 'disconnect': {
      state.score += 1;
      pushHistory(state, 'disconnect', 1);
      break;
    }
  }

  state.score = Math.max(0, Math.min(state.score, 30));
  state.tier = computeTier(state.score);
  return state;
}

export function serializeReputation(state: ReputationState): string {
  return JSON.stringify(state);
}

export function deserializeReputation(raw: string): ReputationState {
  try {
    const parsed = JSON.parse(raw);
    const score = parsed.score ?? 5;
    return {
      score,
      tier: computeTier(score),
      lastSeen: parsed.lastSeen ?? Date.now(),
      history: parsed.history ?? [],
      burstWindow: parsed.burstWindow ?? [],
      queries: parsed.queries ?? [],
      sessionIds: parsed.sessionIds ?? [],
      turnstilePassed: parsed.turnstilePassed ?? false,
    };
  } catch {
    return getDefaultState();
  }
}

export function getTierProviderPool(tier: ReputationState['tier']): { pool: string[]; maxTokens?: number } {
  switch (tier) {
    case 'premium':
      return { pool: ['groq-fast', 'gemini-flash'] };
    case 'standard':
      return { pool: ['groq-fast', 'cerebras-llama'] };
    case 'curious':
      return { pool: ['cerebras-llama', 'nvidia-fast'] };
    case 'throttled':
      return { pool: ['cloudflare-llama'], maxTokens: 1024 };
    case 'restricted':
      return { pool: ['cloudflare-llama'], maxTokens: 1024 };
  }
}

export function getDailyLimits(tier: ReputationState['tier']): { chatPerDay: number; enhancedPerDay: number } {
  switch (tier) {
    case 'premium': return { chatPerDay: 500, enhancedPerDay: 3 };
    case 'standard': return { chatPerDay: 200, enhancedPerDay: 3 };
    case 'curious': return { chatPerDay: 100, enhancedPerDay: 3 };
    case 'throttled': return { chatPerDay: 50, enhancedPerDay: 0 };
    case 'restricted': return { chatPerDay: 10, enhancedPerDay: 0 };
  }
}