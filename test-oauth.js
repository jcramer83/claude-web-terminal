const fs = require('fs');
const os = require('os');
const https = require('https');

// Read OAuth token
const creds = JSON.parse(fs.readFileSync(os.homedir() + '/.claude/.credentials.json', 'utf8'));
const oauth = creds.claudeAiOauth;

const options = {
  hostname: 'api.anthropic.com',
  path: '/api/oauth/usage',
  method: 'GET',
  headers: {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'claude-code/2.0.32',
    'Authorization': 'Bearer ' + oauth.accessToken,
    'anthropic-beta': 'oauth-2025-04-20'
  }
};

console.log('Fetching Claude Max usage limits...\n');

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    if (res.statusCode !== 200) {
      console.error(`Error: HTTP ${res.statusCode}`);
      console.error(data);
      return;
    }

    try {
      const usage = JSON.parse(data);

      console.log('=== 5-Hour Window (Session/Burst) ===');
      console.log(`  Utilization: ${usage.five_hour.utilization}%`);
      console.log(`  Resets at:   ${new Date(usage.five_hour.resets_at).toLocaleString()}`);

      console.log('\n=== 7-Day Window (Weekly) ===');
      console.log(`  Utilization: ${usage.seven_day.utilization}%`);
      console.log(`  Resets at:   ${new Date(usage.seven_day.resets_at).toLocaleString()}`);

      console.log('\nRaw response:', JSON.stringify(usage, null, 2));
    } catch {
      console.log('Response:', data);
    }
  });
});

req.on('error', (e) => console.error('Request failed:', e.message));
req.end();
