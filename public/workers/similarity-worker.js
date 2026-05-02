function cosineSimilarity(a, b) {
  var dot = 0, magA = 0, magB = 0;
  for (var i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  var denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

self.onmessage = function(event) {
  if (event.data.type === 'search') {
    var vectors = event.data.vectors;
    var queryVector = event.data.queryVector;
    var topK = event.data.topK;
    var threshold = event.data.threshold;

    var scored = vectors.map(function(v) {
      return {
        id: v.id,
        text: v.text,
        score: cosineSimilarity(queryVector, v.vector),
      };
    });

    scored.sort(function(a, b) { return b.score - a.score; });
    var results = scored.slice(0, topK).filter(function(v) { return v.score > threshold; });

    self.postMessage({ type: 'result', results: results });
  }
};