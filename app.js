(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const fmtTime = (iso) => new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const fmtDur = (s) => (s ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : '');

  let me = null;
  let calls = [];
  let voicemails = [];
  let demoTimer = null;

  async function api(path, opts = {}) {
    const res = await fetch('/api' + path, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong. Try again.');
    return data;
  }

  function toast(msg, bad) {
    const el = document.createElement('div');
    el.className = 'toast' + (bad ? ' bad' : '');
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  function speak(text) {
    if (!('speechSynthesis' in window)) return toast('Your browser cannot read text aloud.', true);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  }

  /* ---------- landing demo phone ---------- */
  function startDemo() {
    const states = [
      { top: 'Incoming call', status: 'Ringing', ring: true },
      { top: 'Checking rules', status: 'Forwarding is on', ring: true },
      { top: 'Connected', status: 'Call forwarded to [03027475322]', ring: false },
    ];
    let i = 0;
    const paint = () => {
      const s = states[i % states.length];
      $('#demoTop').textContent = s.top;
      $('#demoStatus').textContent = s.status;
      $('#demo').classList.toggle('ringing', s.ring);
      i++;
    };
    paint();
    demoTimer = setInterval(paint, 2400);
  }
  function stopDemo() { clearInterval(demoTimer); }

  /* ---------- views ---------- */
  function showLanding() {
    me = null;
    $('#landing').hidden = false;
    $('#app').hidden = true;
    $('#userbar').hidden = true;
    stopDemo();
    startDemo();
  }

  async function enter(user) {
    me = user;
    stopDemo();
    $('#landing').hidden = true;
    $('#app').hidden = false;
    $('#userbar').hidden = false;
    $('#userName').textContent = user.name;
    await refreshData();
    renderAll();
  }

  async function refreshData() {
    const [c, v] = await Promise.all([api('/calls'), api('/voicemails')]);
    calls = c.calls;
    voicemails = v.voicemails;
  }

  function renderAll() {
    const s = me.settings;
    $('#bigNum').textContent = me.virtualNumber;
    const fc = $('#fwdChip');
    fc.textContent = s.forwardEnabled && s.forwardTo ? `Forwarding to ${s.forwardTo}` : 'Forwarding off';
    fc.classList.toggle('on', !!(s.forwardEnabled && s.forwardTo));
    const vc = $('#vmChip');
    vc.textContent = s.voicemailEnabled ? 'Voicemail on' : 'Voicemail off';
    vc.classList.toggle('on', s.voicemailEnabled);

    $('#fwdOn').checked = s.forwardEnabled;
    $('#fwdTo').value = s.forwardTo;
    $('#ringSec').value = String(s.ringSeconds);
    updatePreview();
    $('#vmOn').checked = s.voicemailEnabled;
    $('#greeting').value = s.greeting;
    $('#vmMax').value = String(s.voicemailMaxSeconds);

    renderStats();
    renderVoicemails();
    renderCalls();
  }

  function renderStats() {
    const unread = voicemails.filter((v) => !v.read).length;
    $('#stCalls').textContent = calls.length;
    $('#stFwd').textContent = calls.filter((c) => c.outcome === 'forwarded').length;
    $('#stVm').textContent = unread;
    const b = $('#vmBadge');
    b.hidden = unread === 0;
    b.textContent = unread;
  }

  function updatePreview() {
    const on = $('#fwdOn').checked;
    const to = $('#fwdTo').value.trim();
    const sec = $('#ringSec').value;
    $('#fwdPreview').textContent = on && to
      ? `Calls to ${me.virtualNumber} ring ${to} for ${sec} seconds. If nobody answers, they go to voicemail.`
      : 'Forwarding is off. Turn it on and add a phone number to send calls to your phone.';
  }

  function renderVoicemails() {
    const el = $('#vmList');
    if (!voicemails.length) {
      el.innerHTML = '<div class="empty">No voicemails yet. Use Simulate a call and let it go unanswered to see one arrive.</div>';
      return;
    }
    el.innerHTML = voicemails.map((v) => `
      <article class="item" data-id="${esc(v.id)}">
        <div class="item-head">
          <b>${v.read ? '' : '<span class="dot" title="New"></span>'}${esc(v.callerName)}</b>
          <span class="meta">${esc(v.callerNumber)} · ${fmtTime(v.at)} · ${v.seconds}s</span>
        </div>
        <p>${esc(v.message)}</p>
        <div class="item-actions">
          <button class="btn small sky" data-act="play" type="button">Play</button>
          ${v.read ? '' : '<button class="btn small" data-act="read" type="button">Mark as read</button>'}
          <button class="btn small ghost" data-act="del" type="button">Delete</button>
        </div>
      </article>`).join('');
  }

  function renderCalls() {
    const el = $('#callList');
    if (!calls.length) {
      el.innerHTML = '<div class="empty">No calls yet. Press Simulate a call to place your first one.</div>';
      return;
    }
    const label = { forwarded: 'Forwarded', voicemail: 'Voicemail', missed: 'Missed' };
    el.innerHTML = calls.map((c) => `
      <article class="item">
        <div class="item-head">
          <b>${esc(c.callerName)}</b>
          <span class="tag ${esc(c.outcome)}">${label[c.outcome] || esc(c.outcome)}</span>
        </div>
        <span class="meta">${esc(c.callerNumber)} · ${fmtTime(c.at)}${c.forwardedTo ? ` · to ${esc(c.forwardedTo)}` : ''}${c.duration ? ` · ${fmtDur(c.duration)}` : ''}</span>
      </article>`).join('');
  }

  /* ---------- simulate call ---------- */
  function openSimulate() {
    $('#modal-root').innerHTML = `
      <div class="scrim" id="scrim">
        <form class="modal" id="simForm">
          <h2>Simulate an incoming call</h2>
          <label>Caller name<input name="callerName" maxlength="60" value="Ayesha Khan"></label>
          <label>Caller number<input name="callerNumber" inputmode="tel" value="03001234567"></label>
          <label class="switch"><input type="checkbox" name="answered" checked><span class="track"></span><span>My phone answers</span></label>
          <label>Voicemail message <small>(used when nobody answers)</small>
            <textarea name="message" rows="3" maxlength="500">Hi, this is Ayesha. Please call me back about my order.</textarea>
          </label>
          <div class="modal-btns">
            <button class="btn ghost" type="button" id="simCancel">Cancel</button>
            <button class="btn lime" type="submit">Start call</button>
          </div>
        </form>
      </div>`;
    $('#simCancel').onclick = closeModal;
    $('#scrim').addEventListener('mousedown', (e) => { if (e.target.id === 'scrim') closeModal(); });
    $('#simForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try {
        const result = await api('/calls/simulate', {
          method: 'POST',
          body: {
            callerName: f.get('callerName'),
            callerNumber: f.get('callerNumber'),
            answered: f.get('answered') === 'on',
            message: f.get('message'),
          },
        });
        await playCall(result, f.get('callerName') || 'Unknown caller', f.get('callerNumber'));
      } catch (err) {
        toast(err.message, true);
      }
    });
    $('#simForm input').focus();
  }

  function closeModal() { $('#modal-root').innerHTML = ''; }

  async function playCall(result, name, number) {
    const initial = (name.trim()[0] || '?').toUpperCase();
    $('#modal-root').innerHTML = `
      <div class="scrim">
        <div class="callscreen" id="callscreen">
          <div class="rings"><span></span><span></span><span></span><div class="avatar">${esc(initial)}</div></div>
          <h2>${esc(name)}</h2>
          <p class="meta">${esc(number || '')}</p>
          <ol class="steps" id="steps"></ol>
          <div class="final" id="final" hidden></div>
          <button class="btn lime" id="callDone" type="button" hidden>Done</button>
        </div>
      </div>`;
    const ol = $('#steps');
    for (let i = 0; i < result.steps.length; i++) {
      await sleep(i === 0 ? 350 : 1000);
      const li = document.createElement('li');
      li.textContent = result.steps[i];
      if (/forwarded to|voicemail saved|missed/i.test(result.steps[i])) li.className = 'hl';
      ol.appendChild(li);
    }
    await sleep(500);
    $('#callscreen').classList.add('done');
    const fin = $('#final');
    fin.textContent = result.message;
    fin.hidden = false;
    $('#callDone').hidden = false;
    $('#callDone').onclick = closeModal;
    $('#callDone').focus();
    await refreshData();
    renderStats();
    renderVoicemails();
    renderCalls();
  }

  /* ---------- events ---------- */
  function bind() {
    $$('.auth-tabs button').forEach((b) => b.addEventListener('click', () => {
      const signup = b.dataset.auth === 'signup';
      $$('.auth-tabs button').forEach((x) => {
        x.classList.toggle('on', x === b);
        x.setAttribute('aria-selected', x === b);
      });
      $('#signupForm').hidden = !signup;
      $('#loginForm').hidden = signup;
    }));

    $('#signupForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type=submit]');
      $('#signupError').textContent = '';
      btn.disabled = true;
      try {
        const body = Object.fromEntries(new FormData(e.target));
        const { user } = await api('/signup', { method: 'POST', body });
        e.target.reset();
        await enter(user);
        toast(`Your number is ${user.virtualNumber}`);
      } catch (err) {
        $('#signupError').textContent = err.message;
      } finally { btn.disabled = false; }
    });

    $('#loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type=submit]');
      $('#loginError').textContent = '';
      btn.disabled = true;
      try {
        const body = Object.fromEntries(new FormData(e.target));
        const { user } = await api('/login', { method: 'POST', body });
        e.target.reset();
        await enter(user);
      } catch (err) {
        $('#loginError').textContent = err.message;
      } finally { btn.disabled = false; }
    });

    $('#logoutBtn').addEventListener('click', async () => {
      await api('/logout', { method: 'POST' }).catch(() => {});
      showLanding();
    });

    $$('.tabs button').forEach((b) => b.addEventListener('click', () => {
      $$('.tabs button').forEach((x) => {
        x.classList.toggle('on', x === b);
        x.setAttribute('aria-selected', x === b);
      });
      ['forwarding', 'voicemail', 'calls'].forEach((t) => { $('#tab-' + t).hidden = t !== b.dataset.tab; });
    }));

    $('#copyNum').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(me.virtualNumber);
        toast('Number copied');
      } catch { toast('Copy failed. Select the number and copy it.', true); }
    });
    $('#simBtn').addEventListener('click', openSimulate);

    ['#fwdOn', '#fwdTo', '#ringSec'].forEach((s) => $(s).addEventListener('input', updatePreview));

    $('#saveFwd').addEventListener('click', async () => {
      try {
        const { user } = await api('/settings', {
          method: 'PUT',
          body: { forwardEnabled: $('#fwdOn').checked, forwardTo: $('#fwdTo').value, ringSeconds: Number($('#ringSec').value) },
        });
        me = user;
        renderAll();
        toast('Forwarding saved');
      } catch (err) { toast(err.message, true); }
    });

    $('#saveVm').addEventListener('click', async () => {
      try {
        const { user } = await api('/settings', {
          method: 'PUT',
          body: { voicemailEnabled: $('#vmOn').checked, greeting: $('#greeting').value, voicemailMaxSeconds: Number($('#vmMax').value) },
        });
        me = user;
        renderAll();
        toast('Voicemail saved');
      } catch (err) { toast(err.message, true); }
    });

    $('#hearGreeting').addEventListener('click', () => speak($('#greeting').value));

    $('#vmList').addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const item = btn.closest('.item');
      const id = item.dataset.id;
      const vm = voicemails.find((v) => v.id === id);
      try {
        if (btn.dataset.act === 'play') {
          speak(`Voicemail from ${vm.callerName}. ${vm.message}`);
          if (!vm.read) { await api(`/voicemails/${id}/read`, { method: 'PATCH' }); vm.read = true; }
        } else if (btn.dataset.act === 'read') {
          await api(`/voicemails/${id}/read`, { method: 'PATCH' });
          vm.read = true;
        } else if (btn.dataset.act === 'del') {
          await api(`/voicemails/${id}`, { method: 'DELETE' });
          voicemails = voicemails.filter((v) => v.id !== id);
          toast('Voicemail deleted');
        }
        renderStats();
        renderVoicemails();
      } catch (err) { toast(err.message, true); }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && $('#simForm')) closeModal();
    });
  }

  async function boot() {
    bind();
    try {
      const { user } = await api('/me');
      await enter(user);
    } catch {
      showLanding();
    }
  }
  boot();
})();
