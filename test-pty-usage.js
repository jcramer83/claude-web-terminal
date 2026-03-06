const pty = require('node-pty');

const env = { ...process.env };
delete env.CLAUDECODE;
delete env.CLAUDE_CODE_ENTRYPOINT;

const claudePath = (process.env.USERPROFILE || process.env.HOME) + '/.local/bin/claude.exe';

const proc = pty.spawn(claudePath, [], {
  name: 'xterm-256color',
  cols: 120,
  rows: 40,
  cwd: process.cwd(),
  env
});

let output = '';
let phase = 'waiting';

proc.onData((data) => {
  output += data;

  if (phase === 'waiting' && output.includes('Try "')) {
    phase = 'sending';
    setTimeout(() => {
      // Use bracketed paste mode to bypass autocomplete
      // \x1b[200~ starts paste, \x1b[201~ ends paste
      proc.write('\x1b[200~/usage\x1b[201~\r');
      phase = 'waiting_result';
    }, 2000);
  }
});

proc.onExit(() => {
  const clean = output
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\r/g, '');
  const lines = clean.split('\n');
  lines.forEach((l) => {
    if (l.trim()) console.log(l.trim());
  });
});

setTimeout(() => {
  proc.write('\x1b[200~/exit\x1b[201~\r');
  setTimeout(() => proc.kill(), 2000);
}, 12000);
