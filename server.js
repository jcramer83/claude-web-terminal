const express = require('express');
const session = require('express-session');
const { WebSocketServer } = require('ws');
const pty = require('node-pty');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);

// Config
const PORT = process.env.PORT || 3000;
const AUTH_USER = process.env.AUTH_USER || '';
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const WORKSPACE = process.env.WORKSPACE || '/workspace';
const AUTH_ENABLED = AUTH_USER.length > 0;

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
const sessions = new Map(); // sessionId -> { pty, createdAt, title }

// Auth middleware
function requireAuth(req, res, next) {
  if (!AUTH_ENABLED || req.session.authenticated) {
    return next();
  }
  res.redirect('/login');
}

// Login page
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

// Static files (after auth for protected routes)
app.use('/css', express.static(path.join(__dirname, 'public', 'css')));
app.use('/js', express.static(path.join(__dirname, 'public', 'js')));

// Protected routes
app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/terminal/:id', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'terminal.html'));
});

// API routes
app.get('/api/sessions', requireAuth, (req, res) => {
  const list = [];
  for (const [id, s] of sessions) {
    list.push({ id, createdAt: s.createdAt, title: s.title });
  }
  list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(list);
});

app.post('/api/sessions', requireAuth, (req, res) => {
  const id = uuidv4();
  const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';

  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: 120,
    rows: 40,
    cwd: WORKSPACE,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      HOME: process.env.HOME || '/root'
    }
  });

  // Launch claude CLI after shell is ready
  // On first run with Claude Max, it will show an OAuth URL to authenticate
  setTimeout(() => {
    ptyProcess.write('claude\r');
  }, 300);

  const sessionData = {
    pty: ptyProcess,
    createdAt: new Date().toISOString(),
    title: `Session ${sessions.size + 1}`,
    clients: new Set()
  };

  // Clean up when PTY exits
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
  res.json({ id, createdAt: sessionData.createdAt, title: sessionData.title });
});

app.delete('/api/sessions/:id', requireAuth, (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Session not found' });
  s.pty.kill();
  sessions.delete(req.params.id);
  res.json({ ok: true });
});

// WebSocket server
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  // Parse session cookie for auth
  sessionMiddleware(request, {}, () => {
    if (AUTH_ENABLED && !request.session?.authenticated) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    // Extract session ID from URL: /ws/:sessionId
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
  if (!sessionData) {
    ws.close();
    return;
  }

  sessionData.clients.add(ws);

  // Forward PTY output to WebSocket
  const dataHandler = sessionData.pty.onData((data) => {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'output', data }));
    }
  });

  // Handle incoming messages from client
  ws.on('message', (msg) => {
    try {
      const parsed = JSON.parse(msg);
      if (parsed.type === 'input') {
        sessionData.pty.write(parsed.data);
      } else if (parsed.type === 'resize') {
        sessionData.pty.resize(parsed.cols, parsed.rows);
      }
    } catch {
      // Raw string input fallback
      sessionData.pty.write(msg.toString());
    }
  });

  ws.on('close', () => {
    sessionData.clients.delete(ws);
    dataHandler.dispose();
  });
});

// Periodic cleanup of dead sessions
setInterval(() => {
  for (const [id, s] of sessions) {
    try {
      // Check if process is still alive by sending signal 0
      process.kill(s.pty.pid, 0);
    } catch {
      sessions.delete(id);
    }
  }
}, 30000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Claude Web Terminal running on port ${PORT}`);
  console.log(`Auth: ${AUTH_ENABLED ? 'enabled' : 'disabled (no AUTH_USER set)'}`);
});
