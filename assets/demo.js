(() => {
  'use strict';
  const byId = id => document.getElementById(`demo-${id}`);
  const ui = Object.fromEntries(['employee-form','name','rules','create','setup-status','chat-name','employee-status','dot','log','chat-form','message','send','sample','refine','new-chat','error','quota','char-count','result-actions','confirm','copy','result-status'].map(id => [id, byId(id)]));
  const sample = '以下は架空の会議メモです。議事録にまとめてください。\n\n9月24日 営業定例\n参加：佐藤・田中・鈴木\n新サービスの紹介資料は、専門用語を減らして3ページにする。\n田中が9月27日までに初稿を作成。佐藤が9月28日に確認。\n鈴木は既存顧客5社へヒアリングする。期限はまだ未定。\n次回の会議でヒアリング結果を共有する。';
  let employee = null;
  let history = [];
  let busy = false;
  let configured = false;
  let remaining = 10;
  let limit = 10;
  let globalAvailable = true;
  let lastAnswer = '';
  let confirmed = false;
  let thinking = null;
  let refreshAt = 0;

  function step(number) {
    for (let i = 1; i <= 3; i++) {
      const item = byId(`step-${i}`);
      item.classList.toggle('is-current', i === number);
      item.classList.toggle('is-complete', i < number);
      if (i === number) item.setAttribute('aria-current', 'step'); else item.removeAttribute('aria-current');
    }
  }
  function error(message = '') { ui.error.textContent = message; ui.error.hidden = !message; }
  function update() {
    const active = Boolean(employee) && !busy;
    ui.message.disabled = !active;
    ui.send.disabled = !active || !configured || !globalAvailable || remaining <= 0 || !ui.message.value.trim();
    ui.sample.disabled = !active;
    ui.refine.disabled = !active || !lastAnswer;
    ui['new-chat'].disabled = !active;
    ui.create.disabled = busy;
    ui.name.disabled = busy;
    ui.rules.disabled = busy;
    ui.confirm.disabled = busy || confirmed;
    ui.copy.disabled = busy;
    ui['char-count'].textContent = `${ui.message.value.length} / 500`;
    ui.quota.textContent = configured ? globalAvailable ? `本日あと ${remaining} / ${limit} 回` : '本日の受付は終了しました' : 'AIへの接続準備中';
  }
  function quota(data) {
    if (Number.isInteger(data.remaining)) remaining = data.remaining;
    if (Number.isInteger(data.limit)) limit = data.limit;
    if (typeof data.globalAvailable === 'boolean') globalAvailable = data.globalAvailable;
    update();
  }
  function scrollLog() { ui.log.scrollTop = ui.log.scrollHeight; }
  function addMessage(role, text, label) {
    const item = document.createElement('div');
    item.className = `demo-message is-${role}`;
    const meta = document.createElement('div'); meta.className = 'demo-message-meta';
    const name = document.createElement(role === 'model' ? 'strong' : 'span');
    name.textContent = label || (role === 'user' ? 'あなた' : employee.name);
    const time = document.createElement('span'); time.textContent = new Date().toLocaleTimeString('ja-JP', { hour:'2-digit', minute:'2-digit' });
    meta.append(name, time);
    const body = document.createElement('div'); body.className = 'demo-message-body'; body.textContent = text;
    item.append(meta, body); ui.log.append(item); scrollLog();
    return item;
  }
  function resetChat() {
    history = []; lastAnswer = ''; confirmed = false; ui.log.replaceChildren(); ui.message.value = '';
    ui['result-actions'].hidden = true; error(); step(2);
    addMessage('notice', `${employee.name}を設定しました。会議メモを送ると、設定したルールに沿って議事録を作成します。まずは下のサンプルを使ってみましょう。`, 'ご案内');
    ui.message.placeholder = '会議メモや、追加の指示を入力してください';
    update();
  }
  ui['employee-form'].addEventListener('submit', event => {
    event.preventDefault();
    const name = ui.name.value.trim(); const rules = ui.rules.value.trim();
    if (!name || !rules) { ui['setup-status'].textContent = '名前と仕事のルールを入力してください。'; return; }
    employee = { name, rules };
    ui['chat-name'].textContent = name; ui['employee-status'].textContent = '準備完了';
    ui.dot.classList.add('is-ready'); ui.create.textContent = '設定を更新して会話を始める →';
    ui['setup-status'].textContent = '設定済み · 変更後は上のボタンで反映できます。';
    resetChat();
    if (matchMedia('(max-width: 760px)').matches) ui['chat-name'].scrollIntoView({ block:'start', behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    ui.message.focus({ preventScroll:true });
  });
  [ui.name, ui.rules].forEach(field => field.addEventListener('input', () => {
    if (employee) ui['setup-status'].textContent = '未反映の変更があります。上のボタンで反映してください。';
  }));
  ui['new-chat'].addEventListener('click', () => { resetChat(); ui.message.focus(); });
  ui.sample.addEventListener('click', () => { ui.message.value = sample; update(); ui.message.focus(); });
  ui.refine.addEventListener('click', () => { ui.message.value = '担当者と期限を残して、もっと短くまとめてください。'; update(); ui.message.focus(); });
  ui.message.addEventListener('input', update);
  ui.message.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.isComposing && !ui.send.disabled) { event.preventDefault(); ui['chat-form'].requestSubmit(); }
  });
  ui.confirm.addEventListener('click', () => { confirmed = true; ui['result-status'].textContent = '確認済み · 体験完了'; update(); });
  ui.copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(lastAnswer); ui['result-status'].textContent = '回答をコピーしました'; }
    catch { ui['result-status'].textContent = '回答の文章を選択してコピーしてください'; }
  });
  async function refreshSession() {
    try {
      const response = await fetch('/api/session', { cache:'no-store', credentials:'same-origin', signal:AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('offline');
      const data = await response.json(); configured = data.configured === true; quota(data);
      refreshAt = Date.now();
      if (!configured) error('AIへの接続準備中です。ローカルサーバーの設定をご確認ください。');
    } catch { configured = false; update(); error('AIに接続できません。起動用ファイルでローカルサーバーを起動してから、このページを開いてください。'); }
  }
  ui['chat-form'].addEventListener('submit', async event => {
    event.preventDefault();
    const message = ui.message.value.trim();
    if (busy || !employee || !message || ui.send.disabled) return;
    busy = true; update(); error(); step(2); ui['result-actions'].hidden = true;
    const userItem = addMessage('user', message);
    thinking = document.createElement('div'); thinking.className = 'demo-thinking'; thinking.textContent = `${employee.name}が考えています…`;
    ui.log.append(thinking); ui.log.setAttribute('aria-busy','true'); scrollLog();
    try {
      const response = await fetch('/api/chat', { method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ employee, message, history }), signal:AbortSignal.timeout(35000) });
      const data = await response.json(); quota(data);
      if (!response.ok) throw new Error(data.error || '送信できませんでした。もう一度お試しください。');
      if (typeof data.text !== 'string' || !data.text.trim()) throw new Error('回答を取得できませんでした。もう一度お試しください。');
      thinking.remove();
      addMessage('model', data.text); lastAnswer = data.text; confirmed = false;
      history.push({ role:'user', text:message }, { role:'model', text:data.text });
      while (history.length > 4 || history.reduce((n, item) => n + item.text.length, 0) > 4000) history.splice(0,2);
      ui.message.value = ''; ui['result-actions'].hidden = false;
      ui['result-status'].textContent = data.truncated ? '回答は文字数の上限に達しました' : '内容を確認し、必要なら追加で指示できます';
      step(3);
    } catch (cause) {
      // Preserve the unsent draft and avoid fake/template answers on failure.
      userItem.remove(); error(cause.name === 'TimeoutError' ? '接続がタイムアウトしました。時間をおいてお試しください。' : cause.message === 'Failed to fetch' ? '接続できませんでした。サーバーの起動状態をご確認ください。' : cause.message);
      if (lastAnswer) { ui['result-actions'].hidden = false; step(3); }
      await refreshSession();
    } finally {
      thinking?.remove(); ui.log.setAttribute('aria-busy','false'); busy = false; update();
      if (remaining <= 0) error('本日の体験回数を使い切りました。明日またお試しください。');
      ui.message.focus({ preventScroll:true });
    }
  });
  // Refresh counts on return / midnight without polling or further model calls.
  window.addEventListener('focus', () => { if (!busy && Date.now() - refreshAt > 60000) refreshSession(); });
  function refreshAtMidnight() {
    const japanNow = new Date(Date.now() + 9 * 3600000);
    const untilMidnight = 86400000 - (japanNow.getUTCHours() * 3600000 + japanNow.getUTCMinutes() * 60000 + japanNow.getUTCSeconds() * 1000);
    setTimeout(() => { if (!busy) refreshSession(); refreshAtMidnight(); }, untilMidnight + 1000);
  }
  refreshAtMidnight();
  refreshSession();
})();
