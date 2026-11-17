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
    'user-modify-playback-state',  // 再生開始・デバイス切替
    'playlist-read-private',
    'playlist-read-collaborative',
    'user-library-read',           // お気に入りの曲
  ].join(' ');
  const REDIRECT_URI = (window.SPOTIFY_REDIRECT_URI || '').trim() || location.origin + location.pathname;

  const ICON_PLAY = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
  const ICON_PAUSE = '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';

  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    ['sp_access', 'sp_expires', 'sp_refresh'].forEach(store.del);
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

  function setStatus(text, kind = '') {
    const el = $('deviceStatus');
    el.textContent = text;
    el.className = `status ${kind}`;
  }

  function initPlayer() {
    window.onSpotifyWebPlaybackSDKReady = () => {
      player = new window.Spotify.Player({
        name: 'My Web Player',
        getOAuthToken: (cb) => { getToken().then(cb).catch((e) => toast(e.message)); },
        volume: Number($('volume').value) / 100,
      });
      player.addListener('ready', ({ device_id }) => {
        deviceId = device_id;
        setStatus('準備完了', 'ok');
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

  function onPlayerState(state) {
    lastState = state;
    lastStateAt = performance.now();
    const track = state?.track_window?.current_track;
    $('playBtn').innerHTML = state && !state.paused ? ICON_PAUSE : ICON_PLAY;
    $('trackName').textContent = track?.name || '再生していません';
    $('trackArtist').textContent = artistsOf(track);
    const art = largestImage(track?.album?.images);
    $('art').hidden = !art;
    if (art && $('art').src !== art) $('art').src = art;
    $('dur').textContent = fmt(state?.duration);
    document.title = track ? `${track.name} · ${artistsOf(track)}` : 'My Player';
    updateProgress();
    highlightPlaying();
  }

  function currentUris() {
    const t = lastState?.track_window?.current_track;
    return t ? [t.uri, t.linked_from?.uri].filter(Boolean) : [];
  }
  function highlightPlaying() {
    const uris = currentUris();
    document.querySelectorAll('.track').forEach((el) => {
      el.classList.toggle('playing', uris.includes(el.dataset.uri));
    });
  }

  function updateProgress() {
    if (!lastState || seeking) return;
    const elapsed = lastState.paused ? 0 : performance.now() - lastStateAt;
    const pos = Math.min(lastState.duration, lastState.position + elapsed);
    $('pos').textContent = fmt(pos);
    $('seek').value = lastState.duration ? Math.round((pos / lastState.duration) * 1000) : 0;
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

  function bindPlayerControls() {
    $('playBtn').innerHTML = ICON_PLAY;
    $('playBtn').addEventListener('click', () => {
      if (!player || !deviceId) return toast('プレーヤーの準備中です');
      player.activateElement?.();
      if (lastState) return safe(player.togglePlay());
      // このページでまだ何も再生していない → 他デバイスで再生中の曲をこちらに引き継ぐ
      safe(api('/me/player', { method: 'PUT', body: { device_ids: [deviceId], play: true } }));
    });
    $('prevBtn').addEventListener('click', () => player && safe(player.previousTrack()));
    $('nextBtn').addEventListener('click', () => player && safe(player.nextTrack()));

    const seek = $('seek');
    seek.addEventListener('input', () => {
      seeking = true;
      if (lastState) $('pos').textContent = fmt((seek.value / 1000) * lastState.duration);
    });
    seek.addEventListener('change', () => {
      seeking = false;
      if (player && lastState) safe(player.seek(Math.round((seek.value / 1000) * lastState.duration)));
    });

    const vol = $('volume');
    vol.value = store.get('sp_volume') ?? 50;
    vol.addEventListener('input', () => {
      store.set('sp_volume', vol.value);
      if (player) safe(player.setVolume(vol.value / 100));
    });

    setInterval(updateProgress, 500);
  }

  // ---------------------------------------------------------------- views
  let renderSeq = 0;
  let lastQuery = '';

  function show(view, arg) {
    document.querySelectorAll('.tabs button').forEach((b) => {
      b.classList.toggle('active', b.dataset.view === (view === 'playlist' ? 'playlists' : view));
    });
    const seq = ++renderSeq;
    const alive = () => seq === renderSeq; // 画面遷移後に古い結果を描画しないため
    const root = $('content');
    root.replaceChildren();
    root.scrollTop = 0;
    views[view](root, alive, arg);
  }

  function trackRow(t, i, onPlay) {
    const img = smallestImage(t.album?.images || t.images);
    return h('li', {
      class: 'track',
      'data-uri': t.uri,
      tabindex: '0',
      onclick: onPlay,
      onkeydown: (e) => { if (e.key === 'Enter') onPlay(); },
    },
    h('span', { class: 'idx' }, i + 1),
    img ? h('img', { src: img, alt: '', loading: 'lazy' }) : h('span', { class: 'ph' }),
    h('div', { class: 'tmeta' }, h('div', { class: 't' }, t.name), h('div', { class: 'a' }, artistsOf(t))),
    h('span', { class: 'dur' }, fmt(t.duration_ms)));
  }

  /** uris 指定で再生（キューを index 付近 100 曲に制限） */
  function playUris(uris, index) {
    const start = Math.max(0, index - 50);
    return safe(play({ uris: uris.slice(start, start + 100), offset: { position: index - start } }));
  }

  const views = {
    // ---------- 検索 ----------
    search(root, alive) {
      const input = h('input', { type: 'search', placeholder: '曲名・アーティスト名で検索', value: lastQuery });
      const list = h('ul', { class: 'tracks' });
      let debounce;
      async function run() {
        const q = input.value.trim();
        lastQuery = q;
        if (!q) return list.replaceChildren();
        list.replaceChildren(h('li', { class: 'muted' }, '検索中…'));
        try {
          // 開発モードのアプリは limit の上限が 10
          const r = await api(`/search?${new URLSearchParams({ q, type: 'track', limit: '10' })}`);
          if (!alive() || q !== lastQuery) return;
          const tracks = (r?.tracks?.items || []).filter(Boolean);
          const uris = tracks.map((t) => t.uri);
          list.replaceChildren(...(tracks.length
            ? tracks.map((t, i) => trackRow(t, i, () => playUris(uris, i)))
            : [h('li', { class: 'muted' }, '見つかりませんでした')]));
          highlightPlaying();
        } catch (e) {
          if (alive()) list.replaceChildren(h('li', { class: 'muted' }, `エラー: ${e.message}`));
        }
      }
      input.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(run, 400); });
      root.append(
        h('h2', {}, '検索'),
        h('form', { class: 'searchbar', onsubmit: (e) => { e.preventDefault(); clearTimeout(debounce); run(); } },
          input, h('button', { type: 'submit', class: 'primary' }, '検索')),
        list,
      );
      if (lastQuery) run();
      input.focus();
    },

    // ---------- プレイリスト一覧 ----------
    async playlists(root, alive) {
      root.append(h('h2', {}, 'プレイリスト'));
      const grid = h('div', { class: 'grid' });
      const status = h('p', { class: 'muted' }, '読み込み中…');
      root.append(status, grid);
      try {
        let next = '/me/playlists?limit=50';
        let pages = 0;
        while (next && pages++ < 6) {
          const r = await api(next);
          if (!alive()) return;
          for (const p of (r?.items || []).filter(Boolean)) {
            const count = p.items?.total ?? p.tracks?.total;
            grid.append(h('button', { class: 'pl', onclick: () => show('playlist', p) },
              coverImg(p),
              h('div', { class: 'name' }, p.name),
              h('div', { class: 'sub' }, [p.owner?.display_name, count != null ? `${count} 曲` : null].filter(Boolean).join(' · '))));
          }
          next = r?.next;
        }
        status.remove();
        if (!grid.children.length) root.append(h('p', { class: 'muted' }, 'プレイリストがありません'));
      } catch (e) {
        status.textContent = `エラー: ${e.message}`;
      }
    },

    // ---------- プレイリスト詳細 ----------
    async playlist(root, alive, p) {
      const img = largestImage(p.images);
      root.append(
        h('button', { class: 'back', onclick: () => show('playlists') }, '← プレイリスト一覧'),
        h('div', { class: 'pl-head' },
          img ? h('img', { class: 'cover', src: img, alt: '' }) : h('div', { class: 'cover' }),
          h('div', { class: 'info' },
            h('span', { class: 'muted small' }, 'プレイリスト'),
            h('h2', {}, p.name),
            h('span', { class: 'muted small' }, p.owner?.display_name || ''),
            h('button', { class: 'primary', onclick: () => safe(play({ context_uri: p.uri })) }, '▶ 再生'))),
      );
      const list = h('ul', { class: 'tracks' }, h('li', { class: 'muted' }, '読み込み中…'));
      root.append(list);

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
        list.replaceWith(h('p', { class: 'note' },
          'このプレイリストの曲一覧は取得できません（Spotify の開発モード制限により、自分が作成・共同編集しているプレイリストのみ取得できます）。上の「▶ 再生」で再生はできます。'));
        return;
      }
      const tracks = entries.map((e) => e?.item ?? e?.track).filter((t) => t && t.uri && !t.is_local);
      list.replaceChildren(...(tracks.length
        ? tracks.map((t, i) => trackRow(t, i, () => safe(play({ context_uri: p.uri, offset: { uri: t.uri } }))))
        : [h('li', { class: 'muted' }, '曲がありません')]));
      highlightPlaying();
    },

    // ---------- お気に入りの曲 ----------
    async liked(root, alive) {
      root.append(h('h2', {}, 'お気に入りの曲'));
      const list = h('ul', { class: 'tracks' }, h('li', { class: 'muted' }, '読み込み中…'));
      const more = h('button', { class: 'ghost more', hidden: true }, 'さらに読み込む');
      root.append(list, more);
      const tracks = [];
      let next = '/me/tracks?limit=50';
      async function load() {
        more.disabled = true;
        try {
          const r = await api(next);
          if (!alive()) return;
          if (!tracks.length) list.replaceChildren();
          const added = (r?.items || []).map((e) => e?.track ?? e?.item).filter((t) => t && t.uri);
          const base = tracks.length;
          tracks.push(...added);
          const uris = tracks.map((t) => t.uri);
          added.forEach((t, j) => list.append(trackRow(t, base + j, () => playUris(uris, base + j))));
          next = r?.next;
          more.hidden = !next;
          if (!tracks.length) list.replaceChildren(h('li', { class: 'muted' }, 'お気に入りの曲がありません'));
          highlightPlaying();
        } catch (e) {
          list.replaceChildren(h('li', { class: 'muted' }, `エラー: ${e.message}`));
        } finally {
          more.disabled = false;
        }
      }
      more.addEventListener('click', load);
      load();
    },
  };

  function coverImg(p) {
    const url = p.images?.[0]?.url;
    return url ? h('img', { class: 'cover', src: url, alt: '', loading: 'lazy' }) : h('div', { class: 'cover' });
  }

  // ---------------------------------------------------------------- screens & boot
  function showScreen(name) {
    for (const id of ['setup', 'login', 'app']) $(id).hidden = id !== name;
  }

  function bindStatic() {
    $('redirectUri').textContent = REDIRECT_URI;
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
    document.querySelectorAll('.tabs button').forEach((b) => {
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

    let me;
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

    $('userName').textContent = me.display_name || me.id;
    if (me.product && me.product !== 'premium') toast('ブラウザでの再生には Spotify Premium が必要です');
    showScreen('app');
    bindPlayerControls();
    initPlayer();
    show('search');
  }

  boot();
})();
