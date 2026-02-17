(function () {
  const sessionId = window.location.pathname.split('/').pop();
  const statusEl = document.getElementById('conn-status');
  const titleEl = document.getElementById('toolbar-title');

  titleEl.textContent = 'Session ' + sessionId.slice(0, 8);

  // Initialize xterm.js
  const term = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', Menlo, monospace",
    theme: {
      background: '#0d1117',
      foreground: '#e6edf3',
      cursor: '#58a6ff',
      selectionBackground: '#264f78',
      black: '#484f58',
      red: '#ff7b72',
      green: '#3fb950',
      yellow: '#d29922',
      blue: '#58a6ff',
      magenta: '#bc8cff',
      cyan: '#39d353',
      white: '#b1bac4',
      brightBlack: '#6e7681',
      brightRed: '#ffa198',
      brightGreen: '#56d364',
      brightYellow: '#e3b341',
      brightBlue: '#79c0ff',
      brightMagenta: '#d2a8ff',
      brightCyan: '#56d364',
      brightWhite: '#f0f6fc'
    },
    allowProposedApi: true
  });

  const fitAddon = new FitAddon.FitAddon();
  const webLinksAddon = new WebLinksAddon.WebLinksAddon();

  term.loadAddon(fitAddon);
  term.loadAddon(webLinksAddon);
  term.open(document.getElementById('terminal-container'));
  fitAddon.fit();

  // Handle Ctrl+C (copy if selection, else send interrupt) and Ctrl+V (paste)
  term.attachCustomKeyEventHandler(function (ev) {
    if (ev.type !== 'keydown') return true;

    if (ev.ctrlKey && ev.key === 'c' && term.hasSelection()) {
      navigator.clipboard.writeText(term.getSelection());
      term.clearSelection();
      return false; // prevent sending to PTY
    }

    if (ev.ctrlKey && ev.key === 'v') {
      navigator.clipboard.readText().then(function (text) {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'input', data: text }));
        }
      });
      return false;
    }

    return true;
  });

  // WebSocket connection
  let ws;
  let reconnectTimer;
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 20;
  const RECONNECT_BASE_DELAY = 1000;

  function getWsUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws/${sessionId}`;
  }

  function setStatus(connected) {
    statusEl.textContent = connected ? 'Connected' : 'Disconnected';
    statusEl.className = 'connection-status' + (connected ? '' : ' disconnected');
  }

  function connect() {
    ws = new WebSocket(getWsUrl());

    ws.onopen = function () {
      setStatus(true);
      reconnectAttempts = 0;
      // Send current terminal size
      sendResize();
    };

    ws.onmessage = function (event) {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'output') {
          term.write(msg.data);
        } else if (msg.type === 'exit') {
          term.write('\r\n\x1b[33mSession ended.\x1b[0m\r\n');
          setStatus(false);
        }
      } catch {
        // If not JSON, write raw
        term.write(event.data);
      }
    };

    ws.onclose = function () {
      setStatus(false);
      attemptReconnect();
    };

    ws.onerror = function () {
      // onclose will fire after this
    };
  }

  function attemptReconnect() {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      term.write('\r\n\x1b[31mConnection lost. Refresh the page to retry.\x1b[0m\r\n');
      return;
    }
    const delay = Math.min(RECONNECT_BASE_DELAY * Math.pow(1.5, reconnectAttempts), 10000);
    reconnectAttempts++;
    reconnectTimer = setTimeout(connect, delay);
  }

  function sendResize() {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    }
  }

  // Terminal input -> WebSocket
  term.onData(function (data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'input', data: data }));
    }
  });

  // Handle resize
  window.addEventListener('resize', function () {
    fitAddon.fit();
    sendResize();
  });

  // Also observe the terminal container for size changes
  const resizeObserver = new ResizeObserver(function () {
    fitAddon.fit();
    sendResize();
  });
  resizeObserver.observe(document.getElementById('terminal-container'));

  // Start connection
  connect();
})();
