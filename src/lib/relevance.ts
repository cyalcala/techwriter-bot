const GREETING_PATTERNS = [
  /^(hi|hey|hello|yo|sup|heya|howdy|hola|aloha|bonjour|ciao|oi|salut)$/i,
  /^(good\s)?(morning|afternoon|evening|night|day)$/i,
  /^(hi|hey|hello)\s+(there|bot|everyone|all|guys|friends)/i,
  /^(how\s+(are|r)\s+(you|u))[?!.]*$/i,
  /^(what('s|s| is) up)[?!.]*$/i,
  /^(how('s|s| is) it going)[?!.]*$/i,
  /^(howdy|how do you do)[?!.]*$/i,
  /^((thanks|thx|thank you|ty|tyvm|thnx|tyty|ok|okay|cool|nice|great|awesome|wow|got it|understood|noted))[.!]*$/i,
  /^(lol|lmao|haha|hehe|rofl)[.!]*$/i,
  /^(bye|goodbye|see ya|cya|later|ttyl|gtg)[.!]*$/i,
  /^(yes|no|maybe|idk|i don'?t know|nope|yep|yeah|nah|yup)[.!]*$/i,
  /^(who are you|what are you|what do you do|tell me about yourself)[?!.]*$/i,
  /^(what can you do|what are you capable of|help|what can i ask)[?!.]*$/i,
];

const QUESTION_SIGNAL_WORDS = [
  'what', 'why', 'how', 'when', 'where', 'who', 'which', 'explain',
  'define', 'describe', 'compare', 'difference', 'between', 'versus', 'vs',
  'tutorial', 'guide', 'example', 'examples', 'code', 'function', 'api',
  'error', 'bug', 'issue', 'problem', 'fix', 'solve', 'implement',
  'best practice', 'pattern', 'architecture', 'design', 'performance',
  'optimize', 'debug', 'test', 'deploy', 'configure', 'setup', 'install',
  'upgrade', 'migrate', 'refactor', 'review', 'audit', 'analyze',
];

function isGreeting(text: string): boolean {
  const trimmed = text.trim();
  for (const pattern of GREETING_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }
  return false;
}

function isConversational(text: string): boolean {
  const trimmed = text.trim().toLowerCase();

  if (isGreeting(text)) return true;

  if (trimmed.length < 15) {
    const questionCount = (trimmed.match(/[?？]/g) || []).length;
    if (questionCount === 0) {
      const hasQuestionWord = /\b(what|why|how|when|where|who|which|can|could|would|will|is|are|do|does|did|should|shall|may)\b/i.test(trimmed);
      if (!hasQuestionWord) return true;
    }
  }

  const conversationalFraming = [
    /^(can|could|would|will|do|does|did|should|is|are|was|were)\s+(you|i|we|u)\b/i,
    /^(i|we)\s+(just|was|am|have|need|want|think|feel|like|love|hate)\s+/i,
    /^(just|btw|fyi|also|anyway|so|well|um|uh|hmm)\s+/i,
    /^(tell me|i want to know|i'm curious|i wonder|can you tell)/i,
  ];
  const isConversationalFraming = conversationalFraming.some(p => p.test(trimmed));
  if (!isConversationalFraming) return false;

  const hasInquirySignal = QUESTION_SIGNAL_WORDS.some(w => trimmed.includes(w));
  if (hasInquirySignal) return false;

  return trimmed.length < 40;
}

export function classifyQuery(query: string): 'greeting' | 'conversational' | 'inquiry' | 'ambiguous' {
  const trimmed = query.trim();

  if (isGreeting(trimmed)) return 'greeting';
  if (isConversational(trimmed)) return 'conversational';

  const hasQuestionWord = /\b(what|why|how|when|where|who|which|explain|define|describe|compare|difference)\b/i.test(trimmed);
  const hasQuestionMark = /[?？]/.test(trimmed);
  const hasInquirySignal = QUESTION_SIGNAL_WORDS.some(w => trimmed.toLowerCase().includes(w));
  const isLong = trimmed.length > 60;
  const isTechnical = /\b(code|function|api|error|bug|issue|fix|implement|configure|setup|install|deploy|test|database|server|client|http|api|json|html|css|js|ts|python|rust|go|java|docker|kubernetes|aws|cloud|linux|windows|macos|npm|pip|git|github)\b/i.test(trimmed);

  if (hasQuestionWord || hasQuestionMark || (hasInquirySignal && isLong) || isTechnical) {
    return 'inquiry';
  }

  if (isLong || hasInquirySignal) return 'inquiry';

  return 'ambiguous';
}

export function shouldSkipSearch(query: string): boolean {
  const classification = classifyQuery(query);
  return classification === 'greeting' || classification === 'conversational';
}

export function shouldOfferSearch(query: string): boolean {
  const classification = classifyQuery(query);
  return classification === 'ambiguous';
}

export function needsContextEnrichment(query: string): boolean {
  const classification = classifyQuery(query);
  return classification === 'inquiry' || classification === 'ambiguous';
}

export function getRelevanceScore(resultContent: string, query: string): number {
  const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
  const contentLower = resultContent.toLowerCase();

  let score = 0;
  let matchedTerms = 0;

  for (const term of queryTerms) {
    if (contentLower.includes(term)) {
      matchedTerms++;
      const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      const occurrences = (contentLower.match(regex) || []).length;
      score += Math.min(occurrences, 3);
    }
  }

  const coverage = queryTerms.length > 0 ? matchedTerms / queryTerms.length : 0;
  score *= 1 + coverage;

  score *= (1 + Math.log(contentLower.length + 1) * 0.1);

  return score;
}

export function filterRelevantResults<T extends { content: string }>(
  results: T[],
  query: string,
  minScore: number = 0.5,
): T[] {
  return results
    .map(r => ({ result: r, score: getRelevanceScore(r.content, query) }))
    .filter(({ score }) => score >= minScore)
    .sort((a, b) => b.score - a.score)
    .map(({ result }) => result);
}

export function formatConversationalResponse(classification: 'greeting' | 'conversational' | 'ambiguous'): string | null {
  if (classification === 'greeting') {
    return "You are a friendly, conversational technical writing assistant. The user is greeting you — respond warmly, briefly, and naturally. Don't list features or capabilities unless asked. Keep it under 2 sentences.";
  }
  if (classification === 'conversational') {
    return "You are a helpful technical writing assistant. The user is being conversational. Respond naturally and briefly. If they seem to have an unstated technical question, you may gently offer to help with writing, coding, or research.";
  }
  if (classification === 'ambiguous') {
    return "You are a helpful technical writing assistant. The user's message is brief. Respond naturally, and if you suspect they need technical help (writing, coding, research), offer to assist. Be warm but concise.";
  }
  return null;
}