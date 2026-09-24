(() => {
  'use strict';
  const byId = id => document.getElementById(`demo-${id}`);
  const ui = Object.fromEntries(['app','sidebar','sidebar-toggle','employee-form','name','rules','create','setup-status','chat-name','employee-status','chat-context','dot','log','messages','welcome','chat-form','message','send','sample','refine','new-chat','error','quota','char-count','result-actions','confirm','copy','result-status','prompts','top-title','template-overlay','template-close','theme','test-chat','draft'].map(id => [id, byId(id)]));
  const sample = '以下は架空の会議メモです。議事録にまとめてください。\n\n9月24日 営業定例\n参加：佐藤・田中・鈴木\n新サービスの紹介資料は、専門用語を減らして3ページにする。\n田中が9月27日までに初稿を作成。佐藤が9月28日に確認。\n鈴木は既存顧客5社へヒアリングする。期限はまだ未定。\n次回の会議でヒアリング結果を共有する。';
  const defaultEmployee = { name:ui.name.value, rules:ui.rules.value };
  const mobile = matchMedia('(max-width: 760px)');
  let employee = null;
  let history = [];
  let busy = false;
  let configured = false;
  let remaining = 10;
  let limit = 10;
  let globalAvailable = true;
  let lastAnswer = '';
  let confirmed = false;
  let confirmedCount = 0;
  let thinking = null;
  let refreshAt = 0;
  let modalOpener = null;
  let currentView = 'chat';

  function error(message = '') { ui.error.textContent = message; ui.error.hidden = !message; }
  function update() {
    ui.message.disabled = busy;
    ui.send.disabled = busy || !configured || !globalAvailable || remaining <= 0 || !ui.message.value.trim();
    ui.sample.disabled = busy;
    ui.refine.disabled = busy || !lastAnswer;
    ui['new-chat'].disabled = busy;
    byId('side-new').disabled = busy;
    ui.create.disabled = busy;
    ui.name.disabled = busy;
    ui.rules.disabled = busy;
    ui['test-chat'].disabled = busy;
    ui.confirm.disabled = busy || confirmed;
    ui.copy.disabled = busy;
    document.querySelectorAll('[data-demo-prompt]').forEach(button => { button.disabled = busy; });
    ui['char-count'].textContent = `${ui.message.value.length} / 500`;
    ui.quota.textContent = configured ? globalAvailable ? `本日あと ${remaining} / ${limit} 回` : '本日の受付は終了しました' : 'AIへの接続準備中';
    byId('usage-count').textContent = limit - remaining;
    byId('usage-remaining').textContent = remaining;
    byId('confirmed-count').textContent = confirmedCount;
    byId('usage-confirmed').textContent = confirmedCount;
  }
  function quota(data) {
    if (Number.isInteger(data.remaining)) remaining = data.remaining;
    if (Number.isInteger(data.limit)) limit = data.limit;
    if (typeof data.globalAvailable === 'boolean') globalAvailable = data.globalAvailable;
    update();
  }
  function showView(view) {
    currentView = view;
    for (const name of ['chat','employees','editor','usage']) byId(`view-${name}`).hidden = name !== view;
    document.querySelectorAll('.demo-navigation [data-demo-view]').forEach(button => {
      const selected = button.dataset.demoView === (view === 'editor' ? 'employees' : view);
      button.classList.toggle('is-active', selected);
      if (selected) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current');
    });
    ui['top-title'].textContent = ({chat:'',employees:'AI社員',editor:'AI社員 / 業務フロー',usage:'利用ログ'})[view];
    ui.app.classList.remove('is-sidebar-open');
    if (mobile.matches) ui['sidebar-toggle'].setAttribute('aria-expanded','false');
    update();
  }
  document.querySelectorAll('[data-demo-view]').forEach(button => button.addEventListener('click', () => showView(button.dataset.demoView)));
  ui['sidebar-toggle'].setAttribute('aria-expanded', String(!mobile.matches));
  ui['sidebar-toggle'].addEventListener('click', () => {
    const expanded = mobile.matches ? ui.app.classList.toggle('is-sidebar-open') : !ui.app.classList.toggle('is-sidebar-collapsed');
    ui['sidebar-toggle'].setAttribute('aria-expanded', String(expanded));
    ui['sidebar-toggle'].setAttribute('aria-label', expanded ? 'メニューを折りたたむ' : 'メニューを開く');
  });
  mobile.addEventListener('change', () => {
    ui.app.classList.remove('is-sidebar-open','is-sidebar-collapsed');
    ui['sidebar-toggle'].setAttribute('aria-expanded',String(!mobile.matches));
    ui['sidebar-toggle'].setAttribute('aria-label',mobile.matches ? 'メニューを開く' : 'メニューを折りたたむ');
  });
  ui.theme.addEventListener('click', () => {
    const dark = ui.app.classList.toggle('is-dark');
    ui.theme.setAttribute('aria-pressed',String(dark));
    ui.theme.setAttribute('aria-label',dark ? 'ライトモードに切り替える' : 'ダークモードに切り替える');
  });

  function scrollLog() { ui.log.scrollTop = ui.log.scrollHeight; }
  function addMessage(role, text) {
    const item = document.createElement('div'); item.className = `demo-message is-${role}`;
    const meta = document.createElement('div'); meta.className = 'demo-message-meta';
    if (role === 'model') { const name = document.createElement('strong'); name.textContent = 'Gemini 3.1 Flash-Lite'; meta.append(name); }
    const time = document.createElement('span'); time.textContent = new Date().toLocaleTimeString('ja-JP', {hour:'2-digit',minute:'2-digit'}); meta.append(time);
    const body = document.createElement('div'); body.className = 'demo-message-body'; body.textContent = text;
    item.append(meta,body); ui.messages.append(item); ui.welcome.hidden = true; scrollLog(); return item;
  }
  function resetChat() {
    history = []; lastAnswer = ''; confirmed = false; ui.messages.replaceChildren(); ui.message.value = '';
    ui['result-actions'].hidden = true; ui.welcome.hidden = false; ui.prompts.hidden = true;
    byId('conversation-title').textContent = 'はじめてのチャット'; error(); update();
  }
  function activateEmployee(value) {
    employee = value;
    ui['chat-name'].textContent = value.name; ui['chat-context'].hidden = false;
    byId('employee-count').textContent = '1'; byId('job-count').textContent = '1';
    byId('card-name').textContent = value.name; byId('card-status').textContent = '有効';
    byId('card-action').textContent = '設定を編集 →'; byId('list-label').textContent = 'あなたのAI社員';
    byId('hire-label').textContent = '設定を編集'; byId('hire-empty').hidden = true;
  }
  function saveEmployee() {
    if (busy) return false;
    const name = ui.name.value.trim(); const rules = ui.rules.value.trim();
    if (!name || !rules) { selectBlock('ai'); ui['setup-status'].textContent = '名前とAIへの指示を入力してください。'; (!name ? ui.name : ui.rules).focus(); return false; }
    const changed = !employee || employee.name !== name || employee.rules !== rules;
    activateEmployee({name,rules});
    if (changed) resetChat();
    ui.draft.textContent = '保存済み'; ui['setup-status'].textContent = '保存しました。「チャットで試す」から仕事を依頼できます。';
    return true;
  }
  function openEditor() { selectBlock('ai'); showView('editor'); }
  ['hire','hire-empty','employee-card','edit-employee'].forEach(id => byId(id).addEventListener('click',openEditor));
  ui['employee-form'].addEventListener('submit', event => { event.preventDefault(); saveEmployee(); });
  ui['test-chat'].addEventListener('click', () => { if (saveEmployee()) { showView('chat'); ui.message.focus({preventScroll:true}); } });
  [ui.name,ui.rules].forEach(field => field.addEventListener('input', () => {
    ui.draft.textContent = '下書き'; ui['setup-status'].textContent = '未保存の変更があります。「保存」で反映してください。';
  }));
  const blocks = {
    trigger:{badge:'⚡ トリガー',number:'',title:'手動実行',text:'チャットの送信ボタンを押すと、AI社員が仕事を開始します。\n\n今回の体験は手動実行です。'},
    input:{badge:'ユーザー入力',number:'#1',title:'会議メモを入力',text:'チャットに入力した会議メモを、次のAI処理へ渡します。\n\n入力は最大500文字。用意した架空のサンプルからも試せます。'},
    ai:{badge:'✧ AI',number:'#2',title:'AI処理'},
    human:{badge:'ロジックブロック',number:'#3',title:'人間の確認',text:'AIの回答を確認し、「内容を確認しました」を押して完了します。\n\n修正したいときはチャットで追加の指示を送ってください。確認結果は「利用ログ」に反映されます。'},
  };
  function selectBlock(block) {
    const data = blocks[block];
    document.querySelectorAll('[data-demo-block]').forEach(button => { const selected = button.dataset.demoBlock === block; button.classList.toggle('is-selected',selected); button.setAttribute('aria-pressed',String(selected)); });
    byId('block-badge').textContent = data.badge; byId('block-number').textContent = data.number; byId('block-title').textContent = data.title;
    byId('ai-settings').hidden = block !== 'ai'; byId('block-description').hidden = block === 'ai'; byId('block-description').textContent = data.text || '';
    if (mobile.matches && currentView === 'editor') byId('block-title').scrollIntoView({block:'nearest'});
  }
  document.querySelectorAll('[data-demo-block]').forEach(button => button.addEventListener('click', () => selectBlock(button.dataset.demoBlock)));

  function newChat() { if (busy) return; resetChat(); showView('chat'); ui.message.focus({preventScroll:true}); }
  ui['new-chat'].addEventListener('click',newChat); byId('side-new').addEventListener('click',newChat);
  byId('conversation').addEventListener('click', () => showView('chat'));
  function fillSample() { ui.message.value = sample; ui.prompts.hidden = false; update(); ui.message.focus({preventScroll:true}); }
  ui.sample.addEventListener('click',fillSample);
  ui.refine.addEventListener('click', () => { ui.message.value = '担当者と期限を残して、もっと短くまとめてください。'; update(); ui.message.focus({preventScroll:true}); });
  function openTemplates(event) {
    modalOpener = event.currentTarget; ui['template-overlay'].hidden = false;
    ui.sidebar.inert = true; document.querySelector('.demo-main').inert = true;
    ui['template-close'].focus({preventScroll:true});
  }
  function closeTemplates() {
    ui['template-overlay'].hidden = true; ui.sidebar.inert = false; document.querySelector('.demo-main').inert = false;
    modalOpener?.focus({preventScroll:true});
  }
  ['templates','templates-nav','template-tool'].forEach(id => byId(id).addEventListener('click',openTemplates));
  ui['template-close'].addEventListener('click',closeTemplates);
  ui['template-overlay'].addEventListener('click', event => { if (event.target === ui['template-overlay']) closeTemplates(); });
  ui['template-overlay'].addEventListener('keydown',event => {
    if (event.key === 'Escape') { event.preventDefault(); closeTemplates(); }
    if (event.key === 'Tab') {
      const focusable = [...ui['template-overlay'].querySelectorAll('button:not(:disabled)')];
      const first = focusable[0]; const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  document.querySelectorAll('[data-demo-prompt]').forEach(button => button.addEventListener('click', () => {
    const instructions = {minutes:'議事録にまとめてください。',summary:'要点を3つに絞ってまとめてください。',actions:'担当者・期限・やることを箇条書きにしてください。',mail:'会議の結果を社内へ共有するメールの下書きを作ってください。'};
    if (!ui['template-overlay'].hidden) closeTemplates();
    showView('chat'); ui.message.value = sample.replace('議事録にまとめてください。',instructions[button.dataset.demoPrompt]);
    ui.prompts.hidden = false; update(); ui.message.focus({preventScroll:true});
  }));
  ui.message.addEventListener('input',update);
  ui.message.addEventListener('keydown',event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.isComposing && !ui.send.disabled) { event.preventDefault(); ui['chat-form'].requestSubmit(); } });
  ui.confirm.addEventListener('click', () => { if (confirmed) return; confirmed = true; confirmedCount++; ui['result-status'].textContent = '確認済み'; update(); });
  ui.copy.addEventListener('click',async () => { try { await navigator.clipboard.writeText(lastAnswer); ui['result-status'].textContent = 'コピーしました'; } catch { ui['result-status'].textContent = '回答の文章を選択してコピーしてください'; } });
  async function refreshSession() {
    try {
      const response = await fetch('/api/session',{cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(10000)});
      if (!response.ok) throw new Error('offline');
      const data = await response.json(); configured = data.configured === true; quota(data); refreshAt = Date.now();
      if (!configured) error('AIへの接続準備中です。ローカルサーバーの設定をご確認ください。');
    } catch { configured = false; update(); error('AIに接続できません。起動用ファイルでローカルサーバーを起動してから、このページを開いてください。'); }
  }
  ui['chat-form'].addEventListener('submit',async event => {
    event.preventDefault(); const message = ui.message.value.trim();
    if (busy || !message || ui.send.disabled) return;
    if (!employee) activateEmployee({...defaultEmployee});
    busy = true; update(); error(); ui['result-actions'].hidden = true;
    const userItem = addMessage('user',message); ui.prompts.hidden = false;
    thinking = document.createElement('div'); thinking.className = 'demo-thinking'; thinking.textContent = `${employee.name}が考えています…`;
    ui.messages.append(thinking); ui.log.setAttribute('aria-busy','true'); scrollLog();
    try {
      const response = await fetch('/api/chat',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({employee,message,history}),signal:AbortSignal.timeout(35000)});
      const data = await response.json(); quota(data);
      if (!response.ok) throw new Error(data.error || '送信できませんでした。もう一度お試しください。');
      if (typeof data.text !== 'string' || !data.text.trim()) throw new Error('回答を取得できませんでした。もう一度お試しください。');
      thinking.remove(); addMessage('model',data.text); lastAnswer = data.text; confirmed = false;
      history.push({role:'user',text:message},{role:'model',text:data.text});
      while (history.length > 4 || history.reduce((n,item) => n + item.text.length,0) > 4000) history.splice(0,2);
      ui.message.value = ''; ui.messages.append(ui['result-actions']); ui['result-actions'].hidden = false;
      ui['result-status'].textContent = data.truncated ? '回答は文字数の上限に達しました' : '';
      byId('conversation-title').textContent = message.replace(/\s+/g,' ').slice(0,20); scrollLog();
    } catch (cause) {
      userItem.remove(); error(cause.name === 'TimeoutError' ? '接続がタイムアウトしました。時間をおいてお試しください。' : cause.message === 'Failed to fetch' ? '接続できませんでした。サーバーの起動状態をご確認ください。' : cause.message);
      if (lastAnswer) ui['result-actions'].hidden = false;
      if (!history.length) ui.welcome.hidden = false;
      await refreshSession();
    } finally {
      thinking?.remove(); ui.log.setAttribute('aria-busy','false'); busy = false; update();
      if (remaining <= 0) error('本日の体験回数を使い切りました。明日またお試しください。');
      if (currentView === 'chat') ui.message.focus({preventScroll:true});
    }
  });
  window.addEventListener('focus', () => { if (!busy && Date.now() - refreshAt > 60000) refreshSession(); });
  function refreshAtMidnight() {
    const japanNow = new Date(Date.now() + 9 * 3600000);
    const untilMidnight = 86400000 - (japanNow.getUTCHours() * 3600000 + japanNow.getUTCMinutes() * 60000 + japanNow.getUTCSeconds() * 1000);
    setTimeout(() => { if (!busy) refreshSession(); refreshAtMidnight(); },untilMidnight + 1000);
  }
  refreshAtMidnight(); refreshSession();
})();
