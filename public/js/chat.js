(function () {
  const messagesEl = document.getElementById('chat-messages');
  const welcomeEl = document.getElementById('chat-welcome');
  const inputEl = document.getElementById('chat-input');
  const sendBtn = document.getElementById('btn-send');
  const chatListEl = document.getElementById('chat-list');
  const chatTitle = document.getElementById('chat-title');
  const themeSelect = document.getElementById('theme-select');
  const newChatBtn = document.getElementById('btn-new-chat');
  const sidebarToggle = document.getElementById('btn-toggle-sidebar');
  const sidebar = document.getElementById('chat-sidebar');

  let sessionId = null;
  let messages = []; // { role, content }
  let streaming = false;
  let currentChatId = null;

  // --- Theme ---
  const savedTheme = localStorage.getItem('theme') || '';
  if (savedTheme) {
    document.body.className = savedTheme;
    themeSelect.value = savedTheme;
  }
  themeSelect.addEventListener('change', function () {
    document.body.className = this.value;
    localStorage.setItem('theme', this.value);
  });

  // --- Sidebar toggle (mobile) ---
  sidebarToggle.addEventListener('click', () => {
    sidebar.classList.toggle('open');
  });

  // --- Chat history (localStorage) ---
  function loadChats() {
    const chats = getChats();
    chatListEl.innerHTML = '';
    if (chats.length === 0) {
      chatListEl.innerHTML = '<div class="chat-list-empty">No conversations yet</div>';
      return;
    }
    chats.forEach(c => {
      const item = document.createElement('div');
      item.className = 'chat-list-item' + (c.id === currentChatId ? ' active' : '');
      item.innerHTML = `
        <span class="chat-list-title">${escapeHtml(c.title)}</span>
        <button class="chat-list-delete" title="Delete">&times;</button>
      `;
      item.querySelector('.chat-list-title').addEventListener('click', () => loadChat(c.id));
      item.querySelector('.chat-list-delete').addEventListener('click', (e) => {
        e.stopPropagation();
        deleteChat(c.id);
      });
      chatListEl.appendChild(item);
    });
  }

  function getChats() {
    try { return JSON.parse(localStorage.getItem('claude-chats') || '[]'); }
    catch { return []; }
  }

  function saveChats(chats) {
    localStorage.setItem('claude-chats', JSON.stringify(chats));
  }

  function saveCurrentChat() {
    if (messages.length === 0) return;
    const chats = getChats();
    const title = messages[0].content.slice(0, 50) || 'New Chat';
    const idx = chats.findIndex(c => c.id === currentChatId);
    const chatData = { id: currentChatId, title, sessionId, messages, updatedAt: Date.now() };
    if (idx >= 0) {
      chats[idx] = chatData;
    } else {
      chats.unshift(chatData);
    }
    // Keep max 50 chats
    if (chats.length > 50) chats.length = 50;
    saveChats(chats);
    loadChats();
  }

  function loadChat(id) {
    const chats = getChats();
    const chat = chats.find(c => c.id === id);
    if (!chat) return;
    currentChatId = chat.id;
    sessionId = chat.sessionId;
    messages = chat.messages || [];
    renderAllMessages();
    chatTitle.textContent = chat.title;
    loadChats();
    sidebar.classList.remove('open');
  }

  function deleteChat(id) {
    const chats = getChats().filter(c => c.id !== id);
    saveChats(chats);
    if (id === currentChatId) newChat();
    loadChats();
  }

  function newChat() {
    currentChatId = generateId();
    sessionId = null;
    messages = [];
    messagesEl.innerHTML = '';
    messagesEl.appendChild(welcomeEl);
    welcomeEl.style.display = '';
    chatTitle.textContent = 'New Chat';
    clearInput();
    loadChats();
    sidebar.classList.remove('open');
  }

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // --- Rendering ---
  function renderAllMessages() {
    messagesEl.innerHTML = '';
    if (messages.length === 0) {
      messagesEl.appendChild(welcomeEl);
      welcomeEl.style.display = '';
      return;
    }
    welcomeEl.style.display = 'none';
    messages.forEach(m => {
      appendMessageBubble(m.role, m.content);
    });
    scrollToBottom();
  }

  function appendMessageBubble(role, content) {
    const wrap = document.createElement('div');
    wrap.className = 'msg ' + (role === 'user' ? 'msg-user' : 'msg-assistant');
    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    if (role === 'assistant') {
      bubble.innerHTML = renderMarkdown(content);
    } else {
      bubble.textContent = content;
    }
    wrap.appendChild(bubble);
    messagesEl.appendChild(wrap);
    return bubble;
  }

  function renderMarkdown(text) {
    if (typeof marked !== 'undefined') {
      marked.setOptions({ breaks: true, gfm: true });
      return marked.parse(text);
    }
    return escapeHtml(text).replace(/\n/g, '<br>');
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // --- Get/set text from contenteditable ---
  function getInputText() {
    return inputEl.innerText.trim();
  }

  function clearInput() {
    inputEl.textContent = '';
  }

  // --- Send message ---
  async function sendMessage() {
    const text = getInputText();
    if (!text || streaming) return;

    welcomeEl.style.display = 'none';
    messages.push({ role: 'user', content: text });
    appendMessageBubble('user', text);
    clearInput();
    scrollToBottom();

    // Create assistant bubble for streaming
    const assistantBubble = appendMessageBubble('assistant', '');
    assistantBubble.innerHTML = '<span class="typing-indicator"></span>';
    scrollToBottom();

    streaming = true;
    sendBtn.disabled = true;
    let fullText = '';

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, sessionId })
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split('\n');
        sseBuffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === 'text') {
              fullText += evt.content;
              assistantBubble.innerHTML = renderMarkdown(fullText);
              scrollToBottom();
            } else if (evt.type === 'done') {
              if (evt.sessionId) sessionId = evt.sessionId;
            } else if (evt.type === 'error') {
              fullText += '\n\n**Error:** ' + evt.content;
              assistantBubble.innerHTML = renderMarkdown(fullText);
            }
          } catch {}
        }
      }
    } catch (err) {
      fullText = '**Connection error.** Please try again.';
      assistantBubble.innerHTML = renderMarkdown(fullText);
    }

    if (!fullText) {
      fullText = '*No response received.*';
      assistantBubble.innerHTML = renderMarkdown(fullText);
    }

    messages.push({ role: 'assistant', content: fullText });
    streaming = false;
    sendBtn.disabled = false;
    chatTitle.textContent = messages[0].content.slice(0, 50);
    saveCurrentChat();
    inputEl.focus();
  }

  // --- Event listeners ---
  sendBtn.addEventListener('click', sendMessage);

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Paste as plain text only
  inputEl.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  });

  newChatBtn.addEventListener('click', newChat);

  // --- Init ---
  currentChatId = generateId();
  loadChats();
  inputEl.focus();
})();
