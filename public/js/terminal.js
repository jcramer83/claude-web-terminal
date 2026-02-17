(function () {
  const sessionId = window.location.pathname.split('/').pop();
  const statusEl = document.getElementById('conn-status');
  const titleEl = document.getElementById('toolbar-title');
  const themeSelect = document.getElementById('theme-select');

  titleEl.textContent = 'Session ' + sessionId.slice(0, 8);

  // Apply saved theme
  const savedTheme = localStorage.getItem('theme') || '';
  if (savedTheme) {
    document.body.className = savedTheme;
    themeSelect.value = savedTheme;
  }

  // Theme definitions for xterm
  const themes = {
    '': {
      background: '#0d1117',
      foreground: '#e6edf3',
      cursor: '#58a6ff',
      selectionBackground: '#264f78',
      black: '#484f58', red: '#ff7b72', green: '#3fb950', yellow: '#d29922',
      blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39d353', white: '#b1bac4',
      brightBlack: '#6e7681', brightRed: '#ffa198', brightGreen: '#56d364',
      brightYellow: '#e3b341', brightBlue: '#79c0ff', brightMagenta: '#d2a8ff',
      brightCyan: '#56d364', brightWhite: '#f0f6fc'
    },
    'theme-monokai': {
      background: '#272822',
      foreground: '#f8f8f2',
      cursor: '#f8f8f0',
      selectionBackground: '#49483e',
      black: '#272822', red: '#f92672', green: '#a6e22e', yellow: '#f4bf75',
      blue: '#66d9ef', magenta: '#ae81ff', cyan: '#a1efe4', white: '#f8f8f2',
      brightBlack: '#75715e', brightRed: '#f92672', brightGreen: '#a6e22e',
      brightYellow: '#f4bf75', brightBlue: '#66d9ef', brightMagenta: '#ae81ff',
      brightCyan: '#a1efe4', brightWhite: '#f9f8f5'
    },
    'theme-dracula': {
      background: '#282a36',
      foreground: '#f8f8f2',
      cursor: '#f8f8f2',
      selectionBackground: '#44475a',
      black: '#21222c', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c',
      blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2',
      brightBlack: '#6272a4', brightRed: '#ff6e6e', brightGreen: '#69ff94',
      brightYellow: '#ffffa5', brightBlue: '#d6acff', brightMagenta: '#ff92df',
      brightCyan: '#a4ffff', brightWhite: '#ffffff'
    },
    'theme-nord': {
      background: '#2e3440',
      foreground: '#d8dee9',
      cursor: '#d8dee9',
      selectionBackground: '#434c5e',
      black: '#3b4252', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b',
      blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0', white: '#e5e9f0',
      brightBlack: '#4c566a', brightRed: '#bf616a', brightGreen: '#a3be8c',
      brightYellow: '#ebcb8b', brightBlue: '#81a1c1', brightMagenta: '#b48ead',
      brightCyan: '#8fbcbb', brightWhite: '#eceff4'
    }
  };

  // Initialize xterm.js
  const term = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', Menlo, monospace",
    theme: themes[savedTheme] || themes[''],
    allowProposedApi: true,
    scrollback: 10000
  });

  const fitAddon = new FitAddon.FitAddon();
  const webLinksAddon = new WebLinksAddon.WebLinksAddon();
  const searchAddon = new SearchAddon.SearchAddon();

  term.loadAddon(fitAddon);
  term.loadAddon(webLinksAddon);
  term.loadAddon(searchAddon);
  term.open(document.getElementById('terminal-container'));
  fitAddon.fit();
  term.focus();

  // Theme switcher
  themeSelect.addEventListener('change', function () {
    const t = this.value;
    document.body.className = t;
    localStorage.setItem('theme', t);
    term.options.theme = themes[t] || themes[''];
  });

  // --- Rename session ---
  titleEl.addEventListener('click', async () => {
    const newName = prompt('Rename session:', titleEl.textContent);
    if (newName && newName.trim()) {
      await fetch('/api/sessions/' + sessionId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newName.trim() })
      });
      titleEl.textContent = newName.trim();
      term.focus();
    }
  });

  // --- Search ---
  const searchBar = document.getElementById('search-bar');
  const searchInput = document.getElementById('search-input');
  const btnSearch = document.getElementById('btn-search');

  function toggleSearch() {
    searchBar.classList.toggle('active');
    if (searchBar.classList.contains('active')) {
      searchInput.focus();
    } else {
      searchAddon.clearDecorations();
      term.focus();
    }
    fitAddon.fit();
    sendResize();
  }

  btnSearch.addEventListener('click', toggleSearch);
  document.getElementById('search-close').addEventListener('click', toggleSearch);

  searchInput.addEventListener('input', () => {
    if (searchInput.value) searchAddon.findNext(searchInput.value);
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.shiftKey ? searchAddon.findPrevious(searchInput.value) : searchAddon.findNext(searchInput.value);
    }
    if (e.key === 'Escape') toggleSearch();
  });
  document.getElementById('search-prev').addEventListener('click', () => searchAddon.findPrevious(searchInput.value));
  document.getElementById('search-next').addEventListener('click', () => searchAddon.findNext(searchInput.value));

  // --- File Browser ---
  const fileSidebar = document.getElementById('file-sidebar');
  const fileList = document.getElementById('file-list');
  const filePath = document.getElementById('file-path');
  const btnFiles = document.getElementById('btn-files');
  let currentFilePath = '/';

  function toggleFiles() {
    fileSidebar.classList.toggle('open');
    if (fileSidebar.classList.contains('open')) {
      loadFiles('/');
    }
    setTimeout(() => { fitAddon.fit(); sendResize(); }, 50);
  }

  btnFiles.addEventListener('click', toggleFiles);
  document.getElementById('sidebar-close').addEventListener('click', toggleFiles);

  async function loadFiles(dirPath) {
    currentFilePath = dirPath;
    filePath.textContent = dirPath;
    fileList.innerHTML = '';

    const res = await fetch('/api/files?path=' + encodeURIComponent(dirPath));
    const data = await res.json();

    // Parent directory
    if (dirPath !== '/') {
      const parent = document.createElement('div');
      parent.className = 'file-item';
      parent.innerHTML = '<span class="file-item-icon">..</span><span class="file-item-name">..</span>';
      parent.addEventListener('click', () => {
        const parts = dirPath.split('/').filter(Boolean);
        parts.pop();
        loadFiles('/' + parts.join('/'));
      });
      fileList.appendChild(parent);
    }

    data.items.forEach(item => {
      const el = document.createElement('div');
      el.className = 'file-item';
      const icon = item.type === 'directory' ? '&#128193;' : '&#128196;';
      el.innerHTML = `<span class="file-item-icon">${icon}</span><span class="file-item-name">${item.name}</span>`;

      if (item.type === 'directory') {
        el.addEventListener('click', () => loadFiles(item.path));
      } else {
        el.addEventListener('click', () => {
          window.open('/api/files/download?path=' + encodeURIComponent(item.path), '_blank');
        });
      }
      fileList.appendChild(el);
    });
  }

  // Upload
  document.getElementById('btn-upload').addEventListener('click', () => {
    document.getElementById('file-upload-input').click();
  });

  document.getElementById('file-upload-input').addEventListener('change', async (e) => {
    for (const file of e.target.files) {
      await fetch('/api/files/upload?path=' + encodeURIComponent(currentFilePath), {
        method: 'POST',
        headers: { 'X-Filename': file.name },
        body: file
      });
    }
    e.target.value = '';
    loadFiles(currentFilePath);
  });

  // --- Clipboard ---
  term.attachCustomKeyEventHandler(function (ev) {
    if (ev.type !== 'keydown') return true;

    // Ctrl+Shift+F = search
    if (ev.ctrlKey && ev.shiftKey && ev.key === 'F') {
      toggleSearch();
      return false;
    }

    // Ctrl+C = copy if selection, else send interrupt
    if (ev.ctrlKey && ev.key === 'c' && term.hasSelection()) {
      navigator.clipboard.writeText(term.getSelection());
      term.clearSelection();
      return false;
    }

    // Ctrl+V = paste
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

  // --- WebSocket ---
  var ws;
  var reconnectAttempts = 0;
  var MAX_RECONNECT_ATTEMPTS = 20;
  var RECONNECT_BASE_DELAY = 1000;

  function getWsUrl() {
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return proto + '//' + location.host + '/ws/' + sessionId;
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
      sendResize();
    };

    ws.onmessage = function (event) {
      try {
        var msg = JSON.parse(event.data);
        if (msg.type === 'output') {
          term.write(msg.data);
        } else if (msg.type === 'exit') {
          term.write('\r\n\x1b[33mSession ended.\x1b[0m\r\n');
          setStatus(false);
        }
      } catch (e) {
        term.write(event.data);
      }
    };

    ws.onclose = function () {
      setStatus(false);
      attemptReconnect();
    };

    ws.onerror = function () {};
  }

  function attemptReconnect() {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      term.write('\r\n\x1b[31mConnection lost. Refresh the page to retry.\x1b[0m\r\n');
      return;
    }
    var delay = Math.min(RECONNECT_BASE_DELAY * Math.pow(1.5, reconnectAttempts), 10000);
    reconnectAttempts++;
    setTimeout(connect, delay);
  }

  function sendResize() {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    }
  }

  // Terminal input
  term.onData(function (data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'input', data: data }));
    }
  });

  // Resize handling
  window.addEventListener('resize', function () {
    fitAddon.fit();
    sendResize();
  });

  var resizeObserver = new ResizeObserver(function () {
    fitAddon.fit();
    sendResize();
  });
  resizeObserver.observe(document.getElementById('terminal-container'));

  connect();
})();
