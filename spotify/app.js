/*
 * My Player — Spotify Web API + Web Playback SDK を使った個人用プレーヤー
 * 認証: Authorization Code with PKCE（サーバー・Client Secret 不要）
 */
(() => {
  'use strict';

  const API = 'https://api.spotify.com/v1';
  const AUTH = 'https://accounts.spotify.com';
  const SCOPES = [
    'streaming',                   // Web Playback SDK で再生
    'user-read-email',
    'user-read-private',
    'user-read-playback-state',
    'user-modify-playback-state',  // 再生開始・デバイス切替・シャッフル等
    'playlist-read-private',
    'playlist-read-collaborative',
    'user-library-read',           // お気に入りの曲
    'user-read-recently-played',   // 再生回数の集計
  ].join(' ');
  const REDIRECT_URI = (window.SPOTIFY_REDIRECT_URI || '').trim() || location.origin + location.pathname;

  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------------------------------------------------------------- icons
  const F = 'fill="currentColor" stroke="none"';
  const ICONS = {
    home: '<path d="M3.5 10.2 12 3.5l8.5 6.7"/><path d="M5.5 9v10.5a1 1 0 0 0 1 1H10v-6h4v6h3.5a1 1 0 0 0 1-1V9"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-4.2-4.2"/>',
    heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    play: `<path ${F} d="M7 5.14v13.72a1 1 0 0 0 1.52.85l11-6.86a1 1 0 0 0 0-1.7l-11-6.86A1 1 0 0 0 7 5.14z"/>`,
    pause: `<rect ${F} x="6" y="4.5" width="4" height="15" rx="1.3"/><rect ${F} x="14" y="4.5" width="4" height="15" rx="1.3"/>`,
    prev: `<rect ${F} x="4.5" y="5" width="2.6" height="14" rx="1.1"/><path ${F} d="M19 6.2v11.6a1 1 0 0 1-1.54.84L9 13.2a1.4 1.4 0 0 1 0-2.4l8.46-5.44A1 1 0 0 1 19 6.2z"/>`,
    next: `<rect ${F} x="16.9" y="5" width="2.6" height="14" rx="1.1"/><path ${F} d="M5 6.2v11.6a1 1 0 0 0 1.54.84L15 13.2a1.4 1.4 0 0 0 0-2.4L6.54 5.36A1 1 0 0 0 5 6.2z"/>`,
    shuffle: '<path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6"/><path d="M4 4l5 5"/>',
    repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
    volume: `<path ${F} d="M11 5 6.5 9H3v6h3.5l4.5 4z"/><path d="M15.5 8.8a4.5 4.5 0 0 1 0 6.4"/><path d="M18.5 6a8.5 8.5 0 0 1 0 12"/>`,
    volumeLow: `<path ${F} d="M11 5 6.5 9H3v6h3.5l4.5 4z"/><path d="M15.5 8.8a4.5 4.5 0 0 1 0 6.4"/>`,
    mute: `<path ${F} d="M11 5 6.5 9H3v6h3.5l4.5 4z"/><path d="m22 9-6 6M16 9l6 6"/>`,
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>',
    music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    back: '<path d="m15 18-6-6 6-6"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
  };
  function icon(name, cls = '') {
    const t = document.createElement('template');
    t.innerHTML = `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
    return t.content.firstChild;
  }
  function setIcon(el, name, cls) { el.replaceChildren(icon(name, cls)); }

  // ---------------------------------------------------------------- storage
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  };
  const clientId = () => ((window.SPOTIFY_CLIENT_ID || '').trim() || (store.get('sp_client_id') || '').trim());

  // ---------------------------------------------------------------- DOM helper
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : String(c));
    }
    return el;
  }

  const fmt = (ms) => {
    const s = Math.max(0, Math.floor((ms || 0) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  const artistsOf = (t) => t?.artists?.map((a) => a.name).join(', ') || t?.show?.name || '';
  const smallestImage = (imgs) => (imgs && imgs.length ? imgs[imgs.length - 1].url : null);
  const largestImage = (imgs) => (imgs && imgs.length ? imgs[0].url : null);
  const cssUrl = (u) => `url(${JSON.stringify(u)})`;

  let toastTimer;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 4500);
  }
  const safe = (p) => Promise.resolve(p).catch((e) => toast(e.message || String(e)));

  // ---------------------------------------------------------------- auth (PKCE)
  function randomString(len) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from(crypto.getRandomValues(new Uint8Array(len)), (x) => chars[x % chars.length]).join('');
  }
  async function sha256base64url(text) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  async function login() {
    const verifier = randomString(64);
    const state = randomString(16);
    store.set('sp_verifier', verifier);
    store.set('sp_state', state);
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId(),
      scope: SCOPES,
      redirect_uri: REDIRECT_URI,
      code_challenge_method: 'S256',
      code_challenge: await sha256base64url(verifier),
      state,
    });
    location.href = `${AUTH}/authorize?${params}`;
  }

  async function handleCallback() {
    const q = new URLSearchParams(location.search);
    if (!q.has('code') && !q.has('error')) return;
    history.replaceState(null, '', location.pathname); // URL から code を消す
    if (q.get('error')) throw new Error(`ログインできませんでした (${q.get('error')})`);
    if (q.get('state') !== store.get('sp_state')) throw new Error('state が一致しません。もう一度ログインしてください。');
    await tokenRequest(new URLSearchParams({
      grant_type: 'authorization_code',
      code: q.get('code'),
      redirect_uri: REDIRECT_URI,
      client_id: clientId(),
      code_verifier: store.get('sp_verifier') || '',
    }));
    store.del('sp_verifier');
    store.del('sp_state');
  }

  async function tokenRequest(body) {
    const res = await fetch(`${AUTH}/api/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = new Error(json.error_description || json.error || `token error ${res.status}`);
      e.code = json.error || 'token_error';
      throw e;
    }
    store.set('sp_access', json.access_token);
    store.set('sp_expires', String(Date.now() + json.expires_in * 1000));
    if (json.refresh_token) store.set('sp_refresh', json.refresh_token);
    if (json.scope != null) store.set('sp_scope', json.scope);
    return json.access_token;
  }

  let refreshing = null;
  async function getToken(force = false) {
    const token = store.get('sp_access');
    const exp = Number(store.get('sp_expires') || 0);
    if (!force && token && Date.now() < exp - 60_000) return token;
    const rt = store.get('sp_refresh');
    if (!rt) {
      const e = new Error('ログインが必要です');
      e.code = 'no_token';
      throw e;
    }
    refreshing ??= tokenRequest(new URLSearchParams({
      grant_type: 'refresh_token', refresh_token: rt, client_id: clientId(),
    })).finally(() => { refreshing = null; });
    try {
      return await refreshing;
    } catch (e) {
      if (e.code === 'invalid_grant') clearTokens();
      throw e;
    }
  }

  function clearTokens() {
    ['sp_access', 'sp_expires', 'sp_refresh', 'sp_scope'].forEach(store.del);
  }

  // ---------------------------------------------------------------- 再生回数
  // Spotify API は曲の再生回数（全世界）を公開していないため、
  // 「最近再生した曲」を定期的に取り込み、自分のアカウントでの再生回数を数える。
  // （Spotify アプリやスマホで聴いた分も含む。ブラウザごとに保存）
  const PC_KEY = 'sp_playcounts';
  const PC_AFTER = 'sp_pc_after';
  const PC_SINCE = 'sp_pc_since';
  let playCounts = {};
  try { playCounts = JSON.parse(store.get(PC_KEY) || '{}') || {}; } catch { playCounts = {}; }
  let needsScope = false;
  let syncing = null;
  let syncTimer = null;

  const countOf = (uri) => playCounts[uri] || 0;
  const fmtCount = (n) => (n ? `${n.toLocaleString()}回` : '–');

  function hasScope(name) {
    const sc = store.get('sp_scope');
    return sc == null ? null : sc.split(' ').includes(name); // null = 不明（古いトークン）
  }

  function syncPlayCounts() {
    if (needsScope) return Promise.resolve();
    if (hasScope('user-read-recently-played') === false) { requireScope(); return Promise.resolve(); }
    syncing ??= (async () => {
      const after = Number(store.get(PC_AFTER) || 0);
      const params = new URLSearchParams({ limit: '50' });
      if (after) params.set('after', String(after));
      let r;
      try {
        r = await api(`/me/player/recently-played?${params}`);
      } catch (e) {
        if (e.status === 401 || e.status === 403) requireScope();
        return;
      }
      let maxTs = after;
      for (const it of r?.items || []) {
        const ts = Date.parse(it.played_at);
        const uri = it.track?.uri;
        if (!uri || !ts || ts <= after) continue;
        playCounts[uri] = (playCounts[uri] || 0) + 1;
        maxTs = Math.max(maxTs, ts);
      }
      if (!store.get(PC_SINCE)) store.set(PC_SINCE, String(Date.now()));
      store.set(PC_AFTER, String(maxTs || Date.now()));
      store.set(PC_KEY, JSON.stringify(playCounts));
      refreshCounts();
    })().finally(() => { syncing = null; });
    return syncing;
  }

  function scheduleSync(ms) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => safe(syncPlayCounts()), ms);
  }

  function refreshCounts() {
    document.querySelectorAll('.trow').forEach((el) => {
      const c = el.querySelector('.c-plays');
      if (c) c.textContent = fmtCount(countOf(el.dataset.uri));
    });
    const uris = currentUris();
    const n = uris.reduce((m, u) => Math.max(m, countOf(u)), 0);
    $('npPlays').hidden = !uris.length;
    $('npPlaysNum').textContent = n ? `${n.toLocaleString()}回` : 'まだ記録なし';
  }

  function scopeBanner() {
    return h('div', { class: 'banner' },
      h('span', {}, '再生回数を表示するには、一度ログインし直してください。'),
      h('button', { class: 'btn-accent small', onclick: () => safe(login()) }, '再ログイン'));
  }
  function requireScope() {
    if (needsScope) return;
    needsScope = true;
    const view = document.querySelector('#content .view');
    if (view && !view.querySelector('.banner')) view.prepend(scopeBanner());
  }

  // ---------------------------------------------------------------- Web API
  async function api(path, { method = 'GET', body, retry = true } = {}) {
    const url = path.startsWith('http') ? path : API + path;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${await getToken()}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && retry) {
      await getToken(true);
      return api(path, { method, body, retry: false });
    }
    if (res.status === 429 && retry) {
      const wait = Number(res.headers.get('Retry-After')) || 1;
      await sleep(Math.min(wait, 10) * 1000);
      return api(path, { method, body, retry: false });
    }
    if (res.status === 204) return null;
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
    if (!res.ok) {
      const e = new Error(json?.error?.message || `HTTP ${res.status}`);
      e.status = res.status;
      throw e;
    }
    return json;
  }

  // ---------------------------------------------------------------- player (Web Playback SDK)
  let player = null;
  let deviceId = null;
  let lastState = null;
  let lastStateAt = 0;
  let seeking = false;
  let lastArt = null;
  let volBeforeMute = 50;

  function setStatus(text, kind = '') {
    const el = $('deviceStatus');
    el.className = `status ${kind}`;
    el.querySelector('span').textContent = text;
  }

  function initPlayer() {
    window.onSpotifyWebPlaybackSDKReady = () => {
      player = new window.Spotify.Player({
        name: 'My Player (Web)',
        getOAuthToken: (cb) => { getToken().then(cb).catch((e) => toast(e.message)); },
        volume: Number($('volume').value) / 100,
      });
      player.addListener('ready', ({ device_id }) => {
        deviceId = device_id;
        setStatus('このブラウザで再生', 'ok');
      });
      player.addListener('not_ready', () => {
        deviceId = null;
        setStatus('オフライン', 'warn');
      });
      player.addListener('initialization_error', ({ message }) => {
        setStatus('初期化エラー', 'err');
        toast(`プレーヤーを初期化できません: ${message}`);
      });
      player.addListener('authentication_error', ({ message }) => {
        setStatus('認証エラー', 'err');
        toast(`認証エラー: ${message}`);
      });
      player.addListener('account_error', () => {
        setStatus('Premium が必要', 'err');
        toast('ブラウザでの再生には Spotify Premium が必要です');
      });
      player.addListener('playback_error', ({ message }) => toast(`再生エラー: ${message}`));
      player.addListener('player_state_changed', onPlayerState);
      player.connect().then((ok) => { if (!ok) setStatus('接続失敗', 'err'); });
    };
    document.head.append(h('script', { src: 'https://sdk.scdn.co/spotify-player.js' }));
  }

  let lastTrackUri = null;
  function onPlayerState(state) {
    lastState = state;
    lastStateAt = performance.now();
    const track = state?.track_window?.current_track;
    if (track && track.uri !== lastTrackUri) {
      // 曲が変わったら、前の曲の再生が Spotify 側に記録された頃に集計を更新
      lastTrackUri = track.uri;
      scheduleSync(10_000);
    }
    const playing = !!state && !state.paused;
    document.body.classList.toggle('paused', !playing);

    setIcon($('playBtn'), playing ? 'pause' : 'play', playing ? '' : 'play-ic');

    $('trackName').textContent = track?.name || '再生していません';
    $('trackArtist').textContent = artistsOf(track) || '—';
    $('dur').textContent = fmt(state?.duration);
    document.title = track ? `${track.name} · ${artistsOf(track)}` : 'My Player';

    // Now Playing パネル
    $('npTitle').textContent = track?.name || 'まだ何も再生していません';
    $('npArtist').textContent = track ? artistsOf(track) : '曲を選ぶとここに表示されます';
    $('npAlbum').textContent = track?.album?.name || '';

    const art = largestImage(track?.album?.images);
    if (art !== lastArt) {
      lastArt = art;
      for (const id of ['art', 'npArt']) {
        const img = $(id);
        img.hidden = !art;
        if (art) img.src = art;
      }
      $('npArtWrap').querySelector('.i')?.toggleAttribute('hidden', !!art);
      const amb = $('ambient');
      if (art) amb.style.backgroundImage = cssUrl(art);
      amb.classList.toggle('on', !!art);
    }

    // シャッフル / リピート
    $('shuffleBtn').classList.toggle('on', !!state?.shuffle);
    const rm = state?.repeat_mode || 0; // 0: off, 1: context, 2: track
    const rb = $('repeatBtn');
    rb.classList.toggle('on', rm > 0);
    rb.querySelector('.badge')?.remove();
    if (rm === 2) rb.append(h('span', { class: 'badge' }, '1'));

    updateProgress();
    highlightPlaying();
    refreshCounts();
  }

  function currentUris() {
    const t = lastState?.track_window?.current_track;
    return t ? [t.uri, t.linked_from?.uri].filter(Boolean) : [];
  }
  function highlightPlaying() {
    const uris = currentUris();
    document.querySelectorAll('.trow').forEach((el) => {
      el.classList.toggle('playing', uris.includes(el.dataset.uri));
    });
  }

  function setRangeFill(el) {
    el.style.setProperty('--p', `${((el.value - el.min) / (el.max - el.min)) * 100}%`);
  }

  function updateProgress() {
    if (seeking) return;
    const seek = $('seek');
    if (!lastState) {
      seek.value = 0;
      setRangeFill(seek);
      $('pos').textContent = '0:00';
      return;
    }
    const elapsed = lastState.paused ? 0 : performance.now() - lastStateAt;
    const pos = Math.min(lastState.duration, lastState.position + elapsed);
    $('pos').textContent = fmt(pos);
    seek.value = lastState.duration ? Math.round((pos / lastState.duration) * 1000) : 0;
    setRangeFill(seek);
  }

  /** このページ（ブラウザ）で再生を開始する */
  async function play(body) {
    if (!deviceId) {
      toast('プレーヤーの準備中です。数秒待ってからもう一度お試しください。');
      return;
    }
    player.activateElement?.(); // iOS/Safari の自動再生制限対策（クリック直後に同期で呼ぶ）
    const path = `/me/player/play?device_id=${encodeURIComponent(deviceId)}`;
    try {
      await api(path, { method: 'PUT', body });
    } catch (e) {
      if (e.status !== 404) throw e;
      // デバイスがまだ認識されていない場合は再生先を切り替えてから再試行
      await api('/me/player', { method: 'PUT', body: { device_ids: [deviceId], play: false } });
      await sleep(700);
      await api(path, { method: 'PUT', body });
    }
  }

  function updateVolumeIcon() {
    const v = Number($('volume').value);
    setIcon($('muteBtn'), v === 0 ? 'mute' : v < 50 ? 'volumeLow' : 'volume');
  }

  function bindPlayerControls() {
    setIcon($('playBtn'), 'play', 'play-ic');
    $('playBtn').addEventListener('click', () => {
      if (!player || !deviceId) return toast('プレーヤーの準備中です');
      player.activateElement?.();
      if (lastState) return safe(player.togglePlay());
      // このページでまだ何も再生していない → 他デバイスで再生中の曲をこちらに引き継ぐ
      safe(api('/me/player', { method: 'PUT', body: { device_ids: [deviceId], play: true } }));
    });
    $('prevBtn').addEventListener('click', () => player && safe(player.previousTrack()));
    $('nextBtn').addEventListener('click', () => player && safe(player.nextTrack()));
    $('shuffleBtn').addEventListener('click', () => {
      if (!deviceId || !lastState) return;
      safe(api(`/me/player/shuffle?state=${!lastState.shuffle}&device_id=${encodeURIComponent(deviceId)}`, { method: 'PUT' }));
    });
    $('repeatBtn').addEventListener('click', () => {
      if (!deviceId || !lastState) return;
      const next = ['context', 'track', 'off'][lastState.repeat_mode || 0];
      safe(api(`/me/player/repeat?state=${next}&device_id=${encodeURIComponent(deviceId)}`, { method: 'PUT' }));
    });

    const seek = $('seek');
    seek.addEventListener('input', () => {
      seeking = true;
      setRangeFill(seek);
      if (lastState) $('pos').textContent = fmt((seek.value / 1000) * lastState.duration);
    });
    seek.addEventListener('change', () => {
      seeking = false;
      if (player && lastState) safe(player.seek(Math.round((seek.value / 1000) * lastState.duration)));
    });

    const vol = $('volume');
    vol.value = store.get('sp_volume') ?? 50;
    setRangeFill(vol);
    updateVolumeIcon();
    const applyVolume = () => {
      setRangeFill(vol);
      updateVolumeIcon();
      store.set('sp_volume', vol.value);
      if (player) safe(player.setVolume(vol.value / 100));
    };
    vol.addEventListener('input', applyVolume);
    $('muteBtn').addEventListener('click', () => {
      if (Number(vol.value) > 0) { volBeforeMute = vol.value; vol.value = 0; }
      else vol.value = volBeforeMute || 50;
      applyVolume();
    });

    setInterval(updateProgress, 500);
  }

  // ---------------------------------------------------------------- views
  let renderSeq = 0;
  let lastQuery = '';
  let me = null;

  function show(view, arg) {
    const tab = view === 'playlist' ? 'home' : view;
    document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === tab));
    const seq = ++renderSeq;
    const alive = () => seq === renderSeq; // 画面遷移後に古い結果を描画しないため
    const root = $('content');
    const wrap = h('div', { class: 'view' });
    if (needsScope) wrap.append(scopeBanner());
    root.replaceChildren(wrap);
    root.scrollTop = 0;
    views[view](wrap, alive, arg);
  }

  // ----- 部品 -----
  function trackList() {
    return h('div', { class: 'tlist', role: 'list' },
      h('div', { class: 'thead' },
        h('span', { class: 'c-idx' }, '#'),
        h('span', {}, 'タイトル'),
        h('span', { class: 'c-album' }, 'アルバム'),
        h('span', { class: 'c-plays', title: playsTitle() }, '再生回数'),
        h('span', { class: 'c-dur' }, icon('clock'))));
  }

  function playsTitle() {
    const since = Number(store.get(PC_SINCE) || 0);
    return `あなたのアカウントでの再生回数${since ? `（${new Date(since).toLocaleDateString('ja-JP')} から記録）` : ''}`;
  }

  function trackRow(t, i, onPlay) {
    const img = smallestImage(t.album?.images || t.images);
    return h('div', {
      class: 'trow',
      role: 'listitem',
      'data-uri': t.uri,
      tabindex: '0',
      onclick: onPlay,
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPlay(); } },
    },
    h('div', { class: 'c-idx' }, h('span', { class: 'n' }, i + 1), icon('play', 'pi'), h('span', { class: 'eq' }, h('i'), h('i'), h('i'))),
    h('div', { class: 'c-title' },
      img ? h('img', { src: img, alt: '', loading: 'lazy' }) : h('span', { class: 'ph' }),
      h('div', {}, h('div', { class: 't' }, t.name), h('div', { class: 'a' }, artistsOf(t)))),
    h('div', { class: 'c-album' }, t.album?.name || ''),
    h('div', { class: 'c-plays' }, fmtCount(countOf(t.uri))),
    h('div', { class: 'c-dur' }, fmt(t.duration_ms)));
  }

  function loadingRow(text = '読み込み中…') { return h('div', { class: 'loading-row' }, text); }

  /** uris 指定で再生（キューを index 付近 100 曲に制限） */
  function playUris(uris, index) {
    const start = Math.max(0, index - 50);
    return safe(play({ uris: uris.slice(start, start + 100), offset: { position: index - start } }));
  }

  function greeting() {
    const hr = new Date().getHours();
    if (hr >= 5 && hr < 11) return 'おはようございます';
    if (hr >= 11 && hr < 18) return 'こんにちは';
    return 'こんばんは';
  }

  function coverEl(url, cls = 'cover') {
    return url ? h('img', { class: cls, src: url, alt: '', loading: 'lazy' }) : h('div', { class: cls }, icon('music'));
  }

  const views = {
    // ---------- ホーム（ライブラリ） ----------
    async home(root, alive) {
      root.append(
        h('div', { class: 'eyebrow' }, 'Library'),
        h('h1', { class: 'page-title' }, greeting()),
        h('p', { class: 'page-sub' }, `${me?.display_name || ''} さんのライブラリ`),
        h('h2', { class: 'section-title' }, 'プレイリスト'),
      );
      const grid = h('div', { class: 'grid' });
      root.append(grid);

      grid.append(h('button', { class: 'card liked-card', onclick: () => show('liked') },
        h('div', { class: 'cover-wrap' }, h('div', { class: 'cover' }, icon('heart'))),
        h('div', { class: 'name' }, 'お気に入りの曲'),
        h('div', { class: 'sub' }, 'Liked Songs')));

      const skeletons = Array.from({ length: 5 }, () => h('div', { class: 'card skeleton' },
        h('div', { class: 'cover sk' }), h('div', { class: 'line sk', style: 'width:80%' }), h('div', { class: 'line sk', style: 'width:50%' })));
      grid.append(...skeletons);

      try {
        let next = '/me/playlists?limit=50';
        let pages = 0;
        let count = 0;
        while (next && pages++ < 6) {
          const r = await api(next);
          if (!alive()) return;
          if (pages === 1) skeletons.forEach((s) => s.remove());
          for (const p of (r?.items || []).filter(Boolean)) {
            count++;
            const total = p.items?.total ?? p.tracks?.total;
            const card = h('div', { class: 'card', role: 'button', tabindex: '0',
              onclick: () => show('playlist', p),
              onkeydown: (e) => { if (e.key === 'Enter') show('playlist', p); } },
            h('div', { class: 'cover-wrap' },
              coverEl(p.images?.[0]?.url),
              h('button', { class: 'fab', 'aria-label': `${p.name} を再生`,
                onclick: (e) => { e.stopPropagation(); safe(play({ context_uri: p.uri })); } }, icon('play'))),
            h('div', { class: 'name' }, p.name),
            h('div', { class: 'sub' }, [p.owner?.display_name, total != null ? `${total} 曲` : null].filter(Boolean).join(' · ')));
            grid.append(card);
          }
          next = r?.next;
        }
        if (!count) root.append(h('p', { class: 'page-sub', style: 'margin-top:18px' }, 'プレイリストはまだありません'));
      } catch (e) {
        skeletons.forEach((s) => s.remove());
        if (alive()) root.append(h('div', { class: 'note' }, `プレイリストを読み込めませんでした: ${e.message}`));
      }
    },

    // ---------- 検索 ----------
    search(root, alive) {
      const input = h('input', { type: 'search', placeholder: '曲名・アーティスト名', value: lastQuery, 'aria-label': '検索', enterkeyhint: 'search' });
      const results = h('div');
      let debounce;

      const emptyState = () => h('div', { class: 'empty' }, icon('music'), h('b', {}, '何を聴きますか？'), h('span', {}, '曲名やアーティスト名を入力してください'));

      async function run() {
        const q = input.value.trim();
        lastQuery = q;
        if (!q) return results.replaceChildren(emptyState());
        results.replaceChildren(loadingRow('検索中…'));
        try {
          // 開発モードのアプリは limit の上限が 10
          const r = await api(`/search?${new URLSearchParams({ q, type: 'track', limit: '10' })}`);
          if (!alive() || q !== lastQuery) return;
          const tracks = (r?.tracks?.items || []).filter(Boolean);
          if (!tracks.length) {
            return results.replaceChildren(h('div', { class: 'empty' }, icon('search'), h('b', {}, '見つかりませんでした'), h('span', {}, '別のキーワードで試してみてください')));
          }
          const uris = tracks.map((t) => t.uri);
          const list = trackList();
          tracks.forEach((t, i) => list.append(trackRow(t, i, () => playUris(uris, i))));
          results.replaceChildren(h('h2', { class: 'section-title', style: 'margin-top:30px' }, '曲'), list);
          highlightPlaying();
        } catch (e) {
          if (alive()) results.replaceChildren(h('div', { class: 'note' }, `エラー: ${e.message}`));
        }
      }
      input.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(run, 350); });
      root.append(
        h('div', { class: 'eyebrow' }, 'Search'),
        h('h1', { class: 'page-title' }, '検索'),
        h('form', { class: 'searchbox', role: 'search', onsubmit: (e) => { e.preventDefault(); clearTimeout(debounce); run(); } },
          icon('search'), input),
        results,
      );
      if (lastQuery) run(); else results.append(emptyState());
      input.focus();
    },

    // ---------- プレイリスト詳細 ----------
    async playlist(root, alive, p) {
      const total = p.items?.total ?? p.tracks?.total;
      const img = largestImage(p.images);
      root.append(
        h('button', { class: 'back', onclick: () => show('home') }, icon('back'), 'ライブラリ'),
        h('div', { class: 'hero' },
          coverEl(img, 'hero-cover'),
          h('div', { class: 'hero-info' },
            h('div', { class: 'eyebrow' }, 'Playlist'),
            h('h1', { class: 'page-title' }, p.name),
            h('div', { class: 'hero-meta' }, h('b', {}, p.owner?.display_name || ''), total != null ? ` · ${total} 曲` : ''),
            h('div', { class: 'actions' },
              h('button', { class: 'play-big', 'aria-label': '再生', onclick: () => safe(play({ context_uri: p.uri })) }, icon('play'))))),
      );
      const holder = h('div', {}, loadingRow());
      root.append(holder);

      // 2026年2月以降: /tracks → /items、各要素の track → item に名称変更。旧形式にもフォールバック。
      let entries = null;
      for (const ep of ['items', 'tracks']) {
        try {
          entries = [];
          let next = `/playlists/${p.id}/${ep}?limit=100`;
          let pages = 0;
          while (next && pages++ < 10) {
            const r = await api(next);
            entries.push(...(r?.items || []));
            next = r?.next;
          }
          break;
        } catch {
          entries = null;
        }
      }
      if (!alive()) return;
      if (!entries) {
        holder.replaceChildren(h('div', { class: 'note' },
          'このプレイリストの曲一覧は表示できません。Spotify の制限で、曲一覧を取得できるのは自分が作成・共同編集しているプレイリストだけです。上の再生ボタンからまとめて再生はできます。'));
        return;
      }
      const tracks = entries.map((e) => e?.item ?? e?.track).filter((t) => t && t.uri && !t.is_local);
      if (!tracks.length) return holder.replaceChildren(h('div', { class: 'empty' }, icon('music'), h('b', {}, '曲がありません')));
      const list = trackList();
      tracks.forEach((t, i) => list.append(trackRow(t, i, () => safe(play({ context_uri: p.uri, offset: { uri: t.uri } })))));
      holder.replaceChildren(list);
      highlightPlaying();
    },

    // ---------- お気に入りの曲 ----------
    async liked(root, alive) {
      const meta = h('div', { class: 'hero-meta' }, h('b', {}, me?.display_name || ''));
      const playAll = h('button', { class: 'play-big', 'aria-label': 'すべて再生', disabled: true }, icon('play'));
      root.append(
        h('div', { class: 'hero' },
          h('div', { class: 'hero-cover liked' }, icon('heart')),
          h('div', { class: 'hero-info' },
            h('div', { class: 'eyebrow' }, 'Playlist'),
            h('h1', { class: 'page-title' }, 'お気に入りの曲'),
            meta,
            h('div', { class: 'actions' }, playAll))),
      );
      const list = trackList();
      const holder = h('div', {}, loadingRow());
      const more = h('button', { class: 'ghost-btn' }, 'さらに読み込む');
      const moreWrap = h('div', { class: 'more-wrap', hidden: true }, more);
      root.append(holder, moreWrap);

      const tracks = [];
      let next = '/me/tracks?limit=50';
      playAll.addEventListener('click', () => tracks.length && playUris(tracks.map((t) => t.uri), 0));

      async function load() {
        more.disabled = true;
        try {
          const r = await api(next);
          if (!alive()) return;
          const added = (r?.items || []).map((e) => e?.track ?? e?.item).filter((t) => t && t.uri);
          const base = tracks.length;
          tracks.push(...added);
          const uris = tracks.map((t) => t.uri);
          added.forEach((t, j) => list.append(trackRow(t, base + j, () => playUris(uris, base + j))));
          if (r?.total != null) meta.append(` · ${r.total} 曲`);
          next = r?.next;
          moreWrap.hidden = !next;
          playAll.disabled = !tracks.length;
          if (!tracks.length) holder.replaceChildren(h('div', { class: 'empty' }, icon('heart'), h('b', {}, 'お気に入りの曲はまだありません')));
          else if (base === 0) holder.replaceChildren(list);
          highlightPlaying();
        } catch (e) {
          holder.replaceChildren(h('div', { class: 'note' }, `エラー: ${e.message}`));
        } finally {
          more.disabled = false;
        }
      }
      more.addEventListener('click', load);
      load();
    },
  };

  // ---------------------------------------------------------------- screens & boot
  function showScreen(name) {
    for (const id of ['setup', 'login', 'app']) $(id).hidden = id !== name;
    document.body.classList.toggle('in-app', name === 'app');
  }

  function bindStatic() {
    // data-icon 属性を持つ要素にアイコンを差し込む
    document.querySelectorAll('[data-icon]').forEach((el) => el.prepend(icon(el.dataset.icon)));
    $('npArtWrap').prepend(icon('music'));

    $('redirectUri').textContent = REDIRECT_URI;
    $('copyBtn').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(REDIRECT_URI);
        $('copyBtn').replaceChildren(icon('check'), 'コピーしました');
        setTimeout(() => $('copyBtn').replaceChildren(icon('copy'), 'コピー'), 1800);
      } catch {
        toast('コピーできませんでした。手動で選択してコピーしてください。');
      }
    });
    $('setupForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = $('clientIdInput').value.trim();
      if (!v) return;
      store.set('sp_client_id', v);
      showScreen('login');
    });
    $('loginBtn').addEventListener('click', () => safe(login()));
    $('resetClientBtn').addEventListener('click', () => {
      if (window.SPOTIFY_CLIENT_ID) return toast('config.js の SPOTIFY_CLIENT_ID を編集してください');
      store.del('sp_client_id');
      $('clientIdInput').value = '';
      showScreen('setup');
    });
    $('logoutBtn').addEventListener('click', () => {
      clearTokens();
      player?.disconnect();
      location.reload();
    });
    document.querySelectorAll('[data-view]').forEach((b) => {
      b.addEventListener('click', () => show(b.dataset.view));
    });
  }

  async function boot() {
    bindStatic();
    if (!clientId()) return showScreen('setup');

    try {
      await handleCallback();
    } catch (e) {
      toast(e.message);
    }
    if (!store.get('sp_access') && !store.get('sp_refresh')) return showScreen('login');

    try {
      me = await api('/me');
    } catch (e) {
      if (e.code === 'no_token' || e.code === 'invalid_grant' || e.status === 401) clearTokens();
      showScreen('login');
      // 403 の多くは「Dashboard の User Management にユーザーが登録されていない」
      toast(e.status === 403
        ? `アクセスが拒否されました: ${e.message}（Dashboard の User Management に自分のアカウントを追加してください）`
        : e.message);
      return;
    }

    const name = me.display_name || me.id || '';
    $('userName').textContent = name;
    const avatar = $('avatar');
    const avatarUrl = smallestImage(me.images);
    if (avatarUrl) avatar.style.backgroundImage = cssUrl(avatarUrl);
    else avatar.textContent = name.slice(0, 1).toUpperCase();

    if (me.product && me.product !== 'premium') toast('ブラウザでの再生には Spotify Premium が必要です');
    showScreen('app');
    bindPlayerControls();
    initPlayer();
    show('home');
    safe(syncPlayCounts());
    setInterval(() => safe(syncPlayCounts()), 3 * 60_000);
  }

  boot();
})();
