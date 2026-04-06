(function () {
  'use strict';

  // --- Configuration ---
  var BRAND_COLOR = '#1a365d';
  var BRAND_LIGHT = '#2a4a7f';
  var BRAND_BG = '#edf2f7';
  var WIDGET_Z = 2147483647;

  // Derive API base from script src
  var scriptSrc = document.currentScript && document.currentScript.src;
  var API_URL = '/api/webchat';
  if (scriptSrc) {
    try {
      var u = new URL(scriptSrc);
      API_URL = u.origin + '/api/webchat';
    } catch (e) { /* keep default */ }
  }

  // --- User ID ---
  var STORAGE_KEY = 'jia_webchat_user_id';
  function getUserId() {
    var id = null;
    try { id = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (!id) {
      id = 'web_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      try { localStorage.setItem(STORAGE_KEY, id); } catch (e) {}
    }
    return id;
  }

  var userId = getUserId();

  // --- Styles ---
  var CSS = '\
.jia-chat-container * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }\
.jia-chat-btn {\
  position: fixed; bottom: 20px; right: 20px; z-index: ' + WIDGET_Z + ';\
  width: 60px; height: 60px; border-radius: 50%; border: none;\
  background: ' + BRAND_COLOR + '; color: #fff; cursor: pointer;\
  box-shadow: 0 4px 12px rgba(0,0,0,0.25); display: flex; align-items: center; justify-content: center;\
  transition: transform 0.2s, box-shadow 0.2s;\
}\
.jia-chat-btn:hover { transform: scale(1.08); box-shadow: 0 6px 20px rgba(0,0,0,0.3); }\
.jia-chat-btn svg { width: 28px; height: 28px; fill: #fff; }\
.jia-chat-window {\
  position: fixed; bottom: 90px; right: 20px; z-index: ' + WIDGET_Z + ';\
  width: 370px; max-width: calc(100vw - 24px); height: 520px; max-height: calc(100vh - 110px);\
  border-radius: 16px; overflow: hidden; display: none; flex-direction: column;\
  background: #fff; box-shadow: 0 8px 30px rgba(0,0,0,0.2);\
}\
.jia-chat-window.open { display: flex; }\
.jia-chat-header {\
  background: ' + BRAND_COLOR + '; color: #fff; padding: 16px; display: flex; align-items: center; gap: 10px; flex-shrink: 0;\
}\
.jia-chat-header-avatar {\
  width: 36px; height: 36px; border-radius: 50%; background: ' + BRAND_LIGHT + ';\
  display: flex; align-items: center; justify-content: center; font-size: 18px; flex-shrink: 0;\
}\
.jia-chat-header-text { flex: 1; }\
.jia-chat-header-title { font-size: 15px; font-weight: 600; }\
.jia-chat-header-sub { font-size: 11px; opacity: 0.85; margin-top: 2px; }\
.jia-chat-close {\
  background: none; border: none; color: #fff; cursor: pointer; font-size: 22px; padding: 4px 8px;\
  opacity: 0.8; transition: opacity 0.15s;\
}\
.jia-chat-close:hover { opacity: 1; }\
.jia-chat-messages {\
  flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px;\
  background: ' + BRAND_BG + ';\
}\
.jia-msg { max-width: 82%; padding: 10px 14px; border-radius: 16px; font-size: 14px; line-height: 1.5; word-break: break-word; }\
.jia-msg-bot { background: #fff; color: #333; align-self: flex-start; border-bottom-left-radius: 4px; box-shadow: 0 1px 2px rgba(0,0,0,0.08); }\
.jia-msg-user { background: ' + BRAND_COLOR + '; color: #fff; align-self: flex-end; border-bottom-right-radius: 4px; }\
.jia-typing { align-self: flex-start; background: #fff; padding: 10px 18px; border-radius: 16px; border-bottom-left-radius: 4px; box-shadow: 0 1px 2px rgba(0,0,0,0.08); display: none; }\
.jia-typing span {\
  display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #a0aec0; margin: 0 2px;\
  animation: jia-bounce 1.2s infinite;\
}\
.jia-typing span:nth-child(2) { animation-delay: 0.2s; }\
.jia-typing span:nth-child(3) { animation-delay: 0.4s; }\
@keyframes jia-bounce {\
  0%, 60%, 100% { transform: translateY(0); }\
  30% { transform: translateY(-6px); }\
}\
.jia-chat-input-area {\
  display: flex; padding: 12px; gap: 8px; border-top: 1px solid #e2e8f0; background: #fff; flex-shrink: 0;\
}\
.jia-chat-input {\
  flex: 1; border: 1px solid #cbd5e0; border-radius: 24px; padding: 10px 16px; font-size: 14px;\
  outline: none; transition: border-color 0.15s;\
}\
.jia-chat-input:focus { border-color: ' + BRAND_COLOR + '; }\
.jia-chat-send {\
  width: 40px; height: 40px; border-radius: 50%; border: none;\
  background: ' + BRAND_COLOR + '; color: #fff; cursor: pointer;\
  display: flex; align-items: center; justify-content: center;\
  transition: background 0.15s;\
}\
.jia-chat-send:hover { background: ' + BRAND_LIGHT + '; }\
.jia-chat-send:disabled { background: #a0aec0; cursor: not-allowed; }\
.jia-chat-send svg { width: 18px; height: 18px; fill: #fff; }\
@media (max-width: 480px) {\
  .jia-chat-window { bottom: 0; right: 0; width: 100vw; height: 100vh; max-height: 100vh; border-radius: 0; }\
  .jia-chat-btn { bottom: 16px; right: 16px; width: 56px; height: 56px; }\
}\
';

  // --- Create DOM ---
  var container = document.createElement('div');
  container.className = 'jia-chat-container';

  var style = document.createElement('style');
  style.textContent = CSS;
  container.appendChild(style);

  // Floating button
  var btn = document.createElement('button');
  btn.className = 'jia-chat-btn';
  btn.setAttribute('aria-label', 'Open chat');
  btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z"/><path d="M7 9h10v2H7zm0-3h10v2H7z"/></svg>';
  container.appendChild(btn);

  // Chat window
  var win = document.createElement('div');
  win.className = 'jia-chat-window';
  win.innerHTML = '\
<div class="jia-chat-header">\
  <div class="jia-chat-header-avatar">\xF0\x9F\x92\x99</div>\
  <div class="jia-chat-header-text">\
    <div class="jia-chat-header-title">\u0E19\u0E49\u0E2D\u0E07\u0E40\u0E08\u0E35\u0E22 \u2014 JIA TRAINER CENTER</div>\
    <div class="jia-chat-header-sub">\u0E1E\u0E23\u0E49\u0E2D\u0E21\u0E15\u0E2D\u0E1A\u0E17\u0E38\u0E01\u0E04\u0E33\u0E16\u0E32\u0E21\u0E04\u0E48\u0E30</div>\
  </div>\
  <button class="jia-chat-close" aria-label="Close chat">&times;</button>\
</div>\
<div class="jia-chat-messages"></div>\
<div class="jia-chat-input-area">\
  <input class="jia-chat-input" type="text" placeholder="\u0E1E\u0E34\u0E21\u0E1E\u0E4C\u0E02\u0E49\u0E2D\u0E04\u0E27\u0E32\u0E21\u0E17\u0E35\u0E48\u0E19\u0E35\u0E48..." maxlength="500" />\
  <button class="jia-chat-send" aria-label="Send"><svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg></button>\
</div>';
  container.appendChild(win);

  document.body.appendChild(container);

  // --- References ---
  var messagesEl = win.querySelector('.jia-chat-messages');
  var inputEl = win.querySelector('.jia-chat-input');
  var sendBtn = win.querySelector('.jia-chat-send');
  var closeBtn = win.querySelector('.jia-chat-close');

  // Typing indicator
  var typingEl = document.createElement('div');
  typingEl.className = 'jia-typing';
  typingEl.innerHTML = '<span></span><span></span><span></span>';
  messagesEl.appendChild(typingEl);

  var isOpen = false;
  var isSending = false;

  // --- Toggle ---
  function toggle() {
    isOpen = !isOpen;
    if (isOpen) {
      win.classList.add('open');
      btn.style.display = 'none';
      inputEl.focus();
      // Show welcome message on first open
      if (messagesEl.querySelectorAll('.jia-msg').length === 0) {
        addMessage('bot', '\u0E2A\u0E27\u0E31\u0E2A\u0E14\u0E35\u0E04\u0E48\u0E30 \u0E22\u0E34\u0E19\u0E14\u0E35\u0E15\u0E49\u0E2D\u0E19\u0E23\u0E31\u0E1A\u0E04\u0E48\u0E30! \u0E19\u0E49\u0E2D\u0E07\u0E40\u0E08\u0E35\u0E22\u0E1E\u0E23\u0E49\u0E2D\u0E21\u0E15\u0E2D\u0E1A\u0E17\u0E38\u0E01\u0E04\u0E33\u0E16\u0E32\u0E21\u0E40\u0E01\u0E35\u0E48\u0E22\u0E27\u0E01\u0E31\u0E1A\u0E2B\u0E25\u0E31\u0E01\u0E2A\u0E39\u0E15\u0E23 CPR \u0E41\u0E25\u0E30 First Aid \u0E04\u0E48\u0E30 \u0E2A\u0E2D\u0E1A\u0E16\u0E32\u0E21\u0E44\u0E14\u0E49\u0E40\u0E25\u0E22\u0E04\u0E48\u0E30 \uD83D\uDE0A');
      }
    } else {
      win.classList.remove('open');
      btn.style.display = 'flex';
    }
  }

  btn.addEventListener('click', toggle);
  closeBtn.addEventListener('click', toggle);

  // --- Messages ---
  function addMessage(role, text) {
    var div = document.createElement('div');
    div.className = 'jia-msg ' + (role === 'bot' ? 'jia-msg-bot' : 'jia-msg-user');
    div.textContent = text;
    messagesEl.insertBefore(div, typingEl);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function setTyping(show) {
    typingEl.style.display = show ? 'block' : 'none';
    if (show) messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // --- Send ---
  function sendMessage() {
    var text = inputEl.value.trim();
    if (!text || isSending) return;

    addMessage('user', text);
    inputEl.value = '';
    isSending = true;
    sendBtn.disabled = true;
    setTyping(true);

    fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: userId, message: text }),
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        setTyping(false);
        if (data.reply) {
          addMessage('bot', data.reply);
        } else if (data.error) {
          addMessage('bot', '\u0E02\u0E2D\u0E2D\u0E20\u0E31\u0E22\u0E04\u0E48\u0E30 \u0E40\u0E01\u0E34\u0E14\u0E02\u0E49\u0E2D\u0E1C\u0E34\u0E14\u0E1E\u0E25\u0E32\u0E14 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E25\u0E2D\u0E07\u0E43\u0E2B\u0E21\u0E48\u0E2D\u0E35\u0E01\u0E04\u0E23\u0E31\u0E49\u0E07\u0E04\u0E48\u0E30');
        }
      })
      .catch(function () {
        setTyping(false);
        addMessage('bot', '\u0E44\u0E21\u0E48\u0E2A\u0E32\u0E21\u0E32\u0E23\u0E16\u0E40\u0E0A\u0E37\u0E48\u0E2D\u0E21\u0E15\u0E48\u0E2D\u0E44\u0E14\u0E49 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E25\u0E2D\u0E07\u0E43\u0E2B\u0E21\u0E48\u0E2D\u0E35\u0E01\u0E04\u0E23\u0E31\u0E49\u0E07\u0E04\u0E48\u0E30');
      })
      .finally(function () {
        isSending = false;
        sendBtn.disabled = false;
        inputEl.focus();
      });
  }

  sendBtn.addEventListener('click', sendMessage);
  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
})();
