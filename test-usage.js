// Quick test: make a minimal Claude API call and display rate limit headers
// Usage: ANTHROPIC_API_KEY=sk-ant-... node test-usage.js
// Or:    node test-usage.js sk-ant-...

const https = require('https');

const apiKey = process.env.ANTHROPIC_API_KEY || process.argv[2];

if (!apiKey) {
  console.error('Usage: ANTHROPIC_API_KEY=sk-ant-... node test-usage.js');
  console.error('   or: node test-usage.js sk-ant-...');
  process.exit(1);
}

const body = JSON.stringify({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 1,
  messages: [{ role: 'user', content: 'hi' }]
});

const options = {
  hostname: 'api.anthropic.com',
  path: '/v1/messages',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01'
  }
};

console.log('Making minimal API call to check rate limit headers...\n');

const req = https.request(options, (res) => {
  console.log(`Status: ${res.statusCode}\n`);

  // Show ALL rate limit headers
  const ratelimitHeaders = {};
  for (const [key, value] of Object.entries(res.headers)) {
    if (key.includes('ratelimit') || key.includes('retry')) {
      ratelimitHeaders[key] = value;
    }
  }

  if (Object.keys(ratelimitHeaders).length === 0) {
    console.log('No rate limit headers found in response.\n');
    console.log('All headers:');
    for (const [key, value] of Object.entries(res.headers)) {
      console.log(`  ${key}: ${value}`);
    }
  } else {
    // Separate unified (Max subscription) from standard headers
    const unified = {};
    const standard = {};
    for (const [key, value] of Object.entries(ratelimitHeaders)) {
      if (key.includes('unified')) {
        unified[key] = value;
      } else {
        standard[key] = value;
      }
    }

    if (Object.keys(unified).length > 0) {
      console.log('=== UNIFIED (Max Subscription) Rate Limits ===');
      for (const [key, value] of Object.entries(unified)) {
        const shortKey = key.replace('anthropic-ratelimit-unified-', '');
        if (shortKey.includes('utilization')) {
          const pct = (parseFloat(value) * 100).toFixed(1);
          console.log(`  ${shortKey}: ${value} (${pct}% used)`);
        } else if (shortKey.includes('reset')) {
          const resetDate = new Date(parseInt(value) * 1000);
          console.log(`  ${shortKey}: ${value} (${resetDate.toLocaleString()})`);
        } else {
          console.log(`  ${shortKey}: ${value}`);
        }
      }
      console.log('');
    }

    if (Object.keys(standard).length > 0) {
      console.log('=== STANDARD Rate Limits ===');
      for (const [key, value] of Object.entries(standard)) {
        const shortKey = key.replace('anthropic-ratelimit-', '');
        if (shortKey.includes('reset')) {
          console.log(`  ${shortKey}: ${value} (${new Date(value).toLocaleString()})`);
        } else {
          console.log(`  ${shortKey}: ${value}`);
        }
      }
      console.log('');
    }
  }

  // Consume response body
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      console.log('API Response (truncated):');
      console.log(`  Model: ${json.model}`);
      console.log(`  Usage: ${JSON.stringify(json.usage)}`);
      if (json.error) {
        console.log(`  Error: ${json.error.message}`);
      }
    } catch {
      console.log('Response body:', data.substring(0, 200));
    }
  });
});

req.on('error', (e) => {
  console.error('Request failed:', e.message);
});

req.write(body);
req.end();
