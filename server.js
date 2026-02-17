const express = require('express');
const session = require('express-session');
const { WebSocketServer } = require('ws');
const pty = require('node-pty');
const { v4: uuidv4 } = require('uuid');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

// Config
const PORT = process.env.PORT || 3000;
const AUTH_USER = process.env.AUTH_USER || '';
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const WORKSPACE = process.env.WORKSPACE || '/workspace';
const IDLE_TIMEOUT_HOURS = parseInt(process.env.IDLE_TIMEOUT_HOURS || '12', 10);
const AUTH_ENABLED = AUTH_USER.length > 0;
const SCROLLBACK_LIMIT = 200000; // ~200KB per session

// Session store
const sessionMiddleware = session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware);

// PTY session manager
const sessions = new Map();

// Auth middleware
function requireAuth(req, res, next) {
  if (!AUTH_ENABLED || req.session.authenticated) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
  res.redirect('/login');
}

// Login routes
app.get('/login', (req, res) => {
  if (!AUTH_ENABLED) return res.redirect('/');
  if (req.session.authenticated) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
  if (!AUTH_ENABLED) return res.redirect('/');
  const { username, password } = req.body;
  if (username === AUTH_USER && password === AUTH_PASSWORD) {
    req.session.authenticated = true;
    return res.redirect('/');
  }
  res.redirect('/login?error=1');
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// Static files
app.use('/css', express.static(path.join(__dirname, 'public', 'css')));
app.use('/js', express.static(path.join(__dirname, 'public', 'js')));
app.use('/favicon.png', express.static(path.join(__dirname, 'public', 'favicon.png')));
app.use('/hero.png', express.static(path.join(__dirname, 'public', 'hero.png')));

// Protected routes
app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/terminal/:id', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'terminal.html'));
});

// --- Session API ---

app.get('/api/sessions', requireAuth, (req, res) => {
  const list = [];
  for (const [id, s] of sessions) {
    list.push({
      id,
      createdAt: s.createdAt,
      title: s.title,
      cwd: s.cwd,
      lastActivity: s.lastActivity
    });
  }
  list.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
  res.json(list);
});

app.post('/api/sessions', requireAuth, (req, res) => {
  const id = uuidv4();
  const cwd = req.body.cwd || WORKSPACE;
  const title = req.body.title || `Session ${sessions.size + 1}`;
  const shell = '/bin/bash';

  // Validate cwd is under workspace
  const resolvedCwd = path.resolve(cwd);
  if (!resolvedCwd.startsWith(path.resolve(WORKSPACE))) {
    return res.status(400).json({ error: 'Directory must be within workspace' });
  }

  // Ensure directory exists
  try {
    fs.mkdirSync(resolvedCwd, { recursive: true });
  } catch {}

  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: 120,
    rows: 40,
    cwd: resolvedCwd,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      HOME: process.env.HOME || '/home/claude'
    }
  });

  setTimeout(() => {
    ptyProcess.write('claude\r');
  }, 300);

  const sessionData = {
    pty: ptyProcess,
    createdAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
    title,
    cwd: resolvedCwd,
    clients: new Set(),
    scrollback: []
  };

  // Buffer PTY output
  ptyProcess.onData((data) => {
    sessionData.lastActivity = new Date().toISOString();
    sessionData.scrollback.push(data);
    let totalLen = 0;
    for (let i = sessionData.scrollback.length - 1; i >= 0; i--) {
      totalLen += sessionData.scrollback[i].length;
      if (totalLen > SCROLLBACK_LIMIT) {
        sessionData.scrollback = sessionData.scrollback.slice(i + 1);
        break;
      }
    }
  });

  ptyProcess.onExit(() => {
    sessionData.clients.forEach(ws => {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'exit' }));
        ws.close();
      }
    });
    sessions.delete(id);
  });

  sessions.set(id, sessionData);
  res.json({ id, createdAt: sessionData.createdAt, title, cwd: resolvedCwd });
});

// Rename session
app.patch('/api/sessions/:id', requireAuth, (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Session not found' });
  if (req.body.title) s.title = req.body.title;
  res.json({ ok: true, title: s.title });
});

app.delete('/api/sessions/:id', requireAuth, (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Session not found' });
  s.pty.kill();
  sessions.delete(req.params.id);
  res.json({ ok: true });
});

// --- File Browser API ---

app.get('/api/files', requireAuth, (req, res) => {
  const reqPath = req.query.path || '/';
  const fullPath = path.join(WORKSPACE, reqPath);
  const resolved = path.resolve(fullPath);

  if (!resolved.startsWith(path.resolve(WORKSPACE))) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    const items = entries
      .filter(e => !e.name.startsWith('.'))
      .map(e => ({
        name: e.name,
        type: e.isDirectory() ? 'directory' : 'file',
        path: path.join(reqPath, e.name)
      }))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    res.json({ path: reqPath, items });
  } catch {
    res.json({ path: reqPath, items: [] });
  }
});

app.get('/api/files/download', requireAuth, (req, res) => {
  const reqPath = req.query.path;
  if (!reqPath) return res.status(400).json({ error: 'Path required' });
  const fullPath = path.join(WORKSPACE, reqPath);
  const resolved = path.resolve(fullPath);

  if (!resolved.startsWith(path.resolve(WORKSPACE))) {
    return res.status(403).json({ error: 'Access denied' });
  }

  if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
    return res.status(404).json({ error: 'File not found' });
  }

  res.download(resolved);
});

app.post('/api/files/upload', requireAuth, (req, res) => {
  const reqPath = req.query.path || '/';
  const fullPath = path.join(WORKSPACE, reqPath);
  const resolved = path.resolve(fullPath);

  if (!resolved.startsWith(path.resolve(WORKSPACE))) {
    return res.status(403).json({ error: 'Access denied' });
  }

  // Simple raw body upload
  const fileName = req.headers['x-filename'];
  if (!fileName) return res.status(400).json({ error: 'X-Filename header required' });

  const filePath = path.join(resolved, path.basename(fileName));
  const writeStream = fs.createWriteStream(filePath);
  req.pipe(writeStream);
  writeStream.on('finish', () => res.json({ ok: true, path: path.join(reqPath, path.basename(fileName)) }));
  writeStream.on('error', (err) => res.status(500).json({ error: err.message }));
});

// Create file
app.post('/api/files/create', requireAuth, (req, res) => {
  const reqPath = req.body.path;
  if (!reqPath) return res.status(400).json({ error: 'Path required' });
  const fullPath = path.join(WORKSPACE, reqPath);
  const resolved = path.resolve(fullPath);

  if (!resolved.startsWith(path.resolve(WORKSPACE))) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    if (fs.existsSync(resolved)) {
      return res.status(409).json({ error: 'Already exists' });
    }
    fs.writeFileSync(resolved, '');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create directory
app.post('/api/files/mkdir', requireAuth, (req, res) => {
  const reqPath = req.body.path;
  if (!reqPath) return res.status(400).json({ error: 'Path required' });
  const fullPath = path.join(WORKSPACE, reqPath);
  const resolved = path.resolve(fullPath);

  if (!resolved.startsWith(path.resolve(WORKSPACE))) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    fs.mkdirSync(resolved, { recursive: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete file or directory
app.post('/api/files/delete', requireAuth, (req, res) => {
  const reqPath = req.body.path;
  if (!reqPath || reqPath === '/') return res.status(400).json({ error: 'Cannot delete root' });
  const fullPath = path.join(WORKSPACE, reqPath);
  const resolved = path.resolve(fullPath);

  if (!resolved.startsWith(path.resolve(WORKSPACE)) || resolved === path.resolve(WORKSPACE)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
      fs.rmSync(resolved, { recursive: true });
    } else {
      fs.unlinkSync(resolved);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Export terminal scrollback
app.get('/api/sessions/:id/export', requireAuth, (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Session not found' });

  // Strip ANSI escape codes for clean text export
  const raw = s.scrollback.join('');
  const clean = raw.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\x1b[()][0-9A-B]/g, '')
    .replace(/\r/g, '');

  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', `attachment; filename="${s.title.replace(/[^a-zA-Z0-9-_ ]/g, '')}-export.txt"`);
  res.send(clean);
});

// --- Workspace directories API ---

app.get('/api/workspaces', requireAuth, (req, res) => {
  function getDirs(dir, prefix) {
    const results = [prefix || '/'];
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') {
          const sub = path.join(prefix || '/', e.name);
          results.push(sub);
          // Only go one level deep
        }
      }
    } catch {}
    return results;
  }
  res.json(getDirs(WORKSPACE, '/'));
});

// --- Chat API ---

app.get('/chat', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

// Chat diagnostic endpoint
app.get('/api/chat/test', requireAuth, (req, res) => {
  const chatEnv = { ...process.env };
  delete chatEnv.CLAUDECODE;
  delete chatEnv.CLAUDE_CODE_ENTRYPOINT;

  const proc = spawn('claude', ['--version'], { env: chatEnv });
  let out = '', err = '';
  proc.stdout.on('data', d => out += d);
  proc.stderr.on('data', d => err += d);
  proc.on('close', code => {
    res.json({ code, stdout: out.trim(), stderr: err.trim(), cwd: WORKSPACE });
  });
  proc.on('error', e => {
    res.json({ error: e.message });
  });
});

// Active chat processes (to allow cancellation)
const chatProcesses = new Map();

app.post('/api/chat', requireAuth, (req, res) => {
  const { message, sessionId } = req.body;
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Message required' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const args = [
    '-p', message,
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--max-turns', '1',
    '--tools', ''
  ];

  if (sessionId) {
    args.push('--resume', sessionId);
  }

  const chatEnv = { ...process.env, HOME: process.env.HOME || '/home/claude' };
  delete chatEnv.CLAUDECODE;
  delete chatEnv.CLAUDE_CODE_ENTRYPOINT;

  console.log('[chat] spawning claude with args:', args.join(' '));

  const proc = spawn('claude', args, {
    cwd: WORKSPACE,
    env: chatEnv
  });

  const procId = uuidv4();
  chatProcesses.set(procId, proc);

  let buffer = '';
  let resultSessionId = sessionId || null;

  proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);

        // Extract session ID from init or result messages
        if (obj.session_id) {
          resultSessionId = obj.session_id;
        }

        // Handle streaming text deltas (token-by-token)
        if (obj.type === 'stream_event' &&
            obj.event?.type === 'content_block_delta' &&
            obj.event?.delta?.text) {
          res.write(`data: ${JSON.stringify({ type: 'text', content: obj.event.delta.text })}\n\n`);
        }
      } catch {}
    }
  });

  let stderrBuf = '';
  proc.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    stderrBuf += text;
    console.log('[chat][stderr]', text);
  });

  proc.on('close', (code) => {
    chatProcesses.delete(procId);
    console.log('[chat] process exited with code', code);
    if (code !== 0 && stderrBuf.trim()) {
      res.write(`data: ${JSON.stringify({ type: 'error', content: stderrBuf.trim() })}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ type: 'done', sessionId: resultSessionId })}\n\n`);
    res.end();
  });

  proc.on('error', (err) => {
    chatProcesses.delete(procId);
    res.write(`data: ${JSON.stringify({ type: 'error', content: err.message })}\n\n`);
    res.end();
  });

  req.on('close', () => {
    chatProcesses.delete(procId);
    proc.kill();
  });
});

// --- WebSocket ---

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  sessionMiddleware(request, {}, () => {
    if (AUTH_ENABLED && !request.session?.authenticated) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    const match = request.url.match(/^\/ws\/([a-f0-9-]+)$/);
    if (!match) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }

    const sessionId = match[1];
    const sessionData = sessions.get(sessionId);
    if (!sessionData) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request, sessionId);
    });
  });
});

wss.on('connection', (ws, request, sessionId) => {
  const sessionData = sessions.get(sessionId);
  if (!sessionData) { ws.close(); return; }

  sessionData.clients.add(ws);

  // Replay scrollback
  if (sessionData.scrollback.length > 0) {
    ws.send(JSON.stringify({ type: 'output', data: sessionData.scrollback.join('') }));
  }

  const dataHandler = sessionData.pty.onData((data) => {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'output', data }));
    }
  });

  ws.on('message', (msg) => {
    try {
      const parsed = JSON.parse(msg);
      if (parsed.type === 'input') {
        sessionData.lastActivity = new Date().toISOString();
        sessionData.pty.write(parsed.data);
      } else if (parsed.type === 'resize') {
        sessionData.pty.resize(parsed.cols, parsed.rows);
      }
    } catch {
      sessionData.pty.write(msg.toString());
    }
  });

  ws.on('close', () => {
    sessionData.clients.delete(ws);
    dataHandler.dispose();
  });
});

// --- Idle timeout & cleanup ---

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    // Check if process is alive
    try {
      process.kill(s.pty.pid, 0);
    } catch {
      sessions.delete(id);
      continue;
    }
    // Idle timeout
    const idleMs = now - new Date(s.lastActivity).getTime();
    if (IDLE_TIMEOUT_HOURS > 0 && idleMs > IDLE_TIMEOUT_HOURS * 60 * 60 * 1000) {
      console.log(`Killing idle session ${id} (${s.title})`);
      s.clients.forEach(ws => {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'output', data: '\r\n\x1b[33mSession killed due to inactivity.\x1b[0m\r\n' }));
          ws.send(JSON.stringify({ type: 'exit' }));
        }
      });
      s.pty.kill();
      sessions.delete(id);
    }
  }
}, 60000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Claude Web Terminal running on port ${PORT}`);
  console.log(`Auth: ${AUTH_ENABLED ? 'enabled' : 'disabled'}`);
  console.log(`Idle timeout: ${IDLE_TIMEOUT_HOURS}h`);
});
