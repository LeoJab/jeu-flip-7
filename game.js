'use strict';
/* Flip 7 — interface + réseau (hôte = premier joueur de la salle, il fait foi). */
(() => {
  const E = Flip7;
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const rnd = n => Math.floor(Math.random() * n);

  const PACE = 700;   // pause après une action de joueur
  const DELAY = 950;  // pause entre deux cartes automatiques
  const BOTS = [['Robo-Chad', '🤖'], ['Gégé Bot', '👾'], ['Cyber-Kevin', '🦾'], ['Mécha-Jul', '🐸'], ['Sir Bluff', '🎩'], ['Dame Risque', '🦊'], ['Pixel', '🐙'], ['Turbo', '🐲']];
  const EMOS = ['😂', '😱', '🔥', '👏', '💀', '😎'];
  const PROMPT = { F: '❄️ GEL : qui est gelé ?', T: '🔄 FLIP THREE : qui pioche 3 cartes ?', S: '🛡️ Offre ta Seconde Chance à qui ?' };
  const STATUS = { active: 'En jeu', stayed: '✋ Reste', frozen: '🥶 Gelé', busted: '💥 BUST !', flip7: '🔥 FLIP 7 !', out: 'Absent' };

  let me = { id: '', name: 'Joueur', avatar: null };
  let myId = '', room = null, local = false, code = '';
  let S = null, roomPlayers = [], lastEv = null, timer = null, wasMyTurn = false;
  const reported = new Set();
  let prev = {};

  /* ======================= démarrage ======================= */
  async function init() {
    if (window.ChadGang) {
      try { Object.assign(me, await ChadGang.me()); } catch (e) {}
    } else {
      let id = null;
      try { id = localStorage.getItem('f7id'); } catch (e) {}
      if (!id) { id = 'L' + Math.random().toString(36).slice(2, 8); try { localStorage.setItem('f7id', id); } catch (e) {} }
      me.id = id;
      try { me.name = localStorage.getItem('f7name') || 'Joueur'; } catch (e) {}
    }
    myId = me.id;
    if (window.ChadGang) {
      $('#pseudoBox').hidden = true;
      $('#whoami').textContent = 'Connecté en tant que ' + me.name + ' 👋';
    } else {
      $('#pseudo').value = me.name;
      $('#online').hidden = true;
      $('#whoami').textContent = 'Hors hub : seul le mode contre bots est disponible.';
    }
    const inv = window.ChadGang && ChadGang.room && ChadGang.room();
    if (inv) connectOnline(String(inv).toUpperCase(), false);
  }

  function show(name) {
    ['menu', 'lobby', 'game'].forEach(n => { $('#' + n).hidden = n !== name; });
  }

  function toast(t) {
    const el = $('#toast');
    el.textContent = t; el.classList.add('on');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove('on'), 2600);
  }

  /* ======================= salle ======================= */
  function randomCode() {
    const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    return Array.from({ length: 4 }, () => L[rnd(L.length)]).join('');
  }

  function connectOnline(c, create) {
    c = (c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (c.length < 4) { toast('Entre un code de 4 à 12 caractères'); return; }
    code = c; local = false; resetState();
    try { room = ChadGang.join(c, { create: !!create }); }
    catch (e) { toast('Impossible de rejoindre la salle'); return; }
    wire(room);
    show('lobby'); render();
  }

  function startLocal() {
    if (!window.ChadGang) {
      const v = ($('#pseudo').value || '').trim().slice(0, 16);
      if (v) { me.name = v; try { localStorage.setItem('f7name', v); } catch (e) {} }
    }
    code = 'SOLO'; local = true; resetState();
    room = localRoom();
    wire(room);
    setTimeout(room._start, 0);
  }

  function localRoom() {
    const h = {};
    const r = {
      on(e, f) { h[e] = f; return r; },
      send(d) { setTimeout(() => h.message && h.message(d, { id: me.id, name: me.name }), 0); },
      leave() {},
      _start() {
        const pl = [{ id: me.id, name: me.name }];
        h.ready && h.ready({ me: me.id, players: pl, last: null });
        h.players && h.players(pl);
      }
    };
    return r;
  }

  function resetState() {
    S = null; roomPlayers = []; lastEv = null; prev = {}; wasMyTurn = false;
    clearTimeout(timer);
  }

  function leaveRoom() {
    try { room && room.leave(); } catch (e) {}
    room = null; resetState(); show('menu');
  }

  function wire(r) {
    r.on('ready', info => {
      myId = info.me || me.id;
      roomPlayers = info.players || [];
      if (info.last && info.last.t === 'state') acceptState(info.last.s);
      if (!local) send({ t: 'hi', avatar: me.avatar || null });
      updateHost();
    });
    r.on('players', list => { roomPlayers = list || []; updateHost(); });
    r.on('message', onMessage);
    r.on('error', msg => { toast(typeof msg === 'string' ? msg : 'Salle introuvable'); leaveRoom(); });
  }

  const send = (d, o) => { if (room) room.send(d, o); };
  const amHost = () => roomPlayers.length > 0 && roomPlayers[0].id === myId;
  const myIdx = () => (S && S.players) ? S.players.findIndex(p => p.id === myId) : -1;
  const botlike = p => p.bot || p.gone;

  function updateHost() {
    if (amHost()) {
      if (!S) {
        const bots = [];
        if (local) BOTS.slice(0, 3).forEach((b, i) => bots.push({ id: 'bot' + i, name: b[0], emoji: b[1] }));
        S = { v: 0, phase: 'lobby', bots, av: {}, ev: [], evId: 0, log: [] };
        commit();
      } else {
        reconcile();
        kick();
      }
    } else clearTimeout(timer);
    render();
  }

  // Marque absents / de retour les joueurs de la partie
  function reconcile() {
    if (!S || S.phase === 'lobby' || !S.players) return;
    let changed = false;
    S.players.forEach(p => {
      if (p.bot) return;
      const here = roomPlayers.some(r => r.id === p.id);
      if (!here && !p.gone) { p.gone = true; changed = true; S.log.push('📴 ' + p.name + ' a quitté (un bot joue à sa place)'); }
      else if (here && p.gone) { p.gone = false; changed = true; S.log.push('👋 ' + p.name + ' est de retour'); }
    });
    if (changed) commit();
  }

  /* ======================= messages ======================= */
  function onMessage(d, from) {
    if (!d || !from) return;
    if (d.t === 'state') acceptState(d.s, true);
    else if (d.t === 'act') { if (amHost()) handleAct(d, from); }
    else if (d.t === 'hi') {
      if (amHost() && S && d.avatar && typeof d.avatar === 'string') {
        S.av = S.av || {};
        if (S.av[from.id] !== d.avatar) { S.av[from.id] = d.avatar.slice(0, 200); commit(); }
      }
    } else if (d.t === 'emo') showEmo(String(d.e).slice(0, 4), from.id);
  }

  function acceptState(s, live) {
    if (!s || (S && s.v <= S.v)) return;
    S = s;
    onState();
    if (live && amHost()) kick();
  }

  function commit() {
    S.v = (S.v || 0) + 1;
    send({ t: 'state', s: S }, { keep: true });
    onState();
  }

  /* ======================= logique hôte ======================= */
  function kick() {
    clearTimeout(timer);
    if (S && S.phase === 'play') timer = setTimeout(loop, 400);
  }

  function loop() {
    if (!amHost() || !S || S.phase !== 'play') return;
    const did = E.step(S);
    commit();
    if (did) timer = setTimeout(loop, DELAY);
    else botTurn();
  }

  function botTurn() {
    let actor = null;
    if (S.wait === 'turn') actor = S.players[S.turn];
    else if (S.wait === 'target') actor = S.players[S.pending.by];
    if (!actor || !botlike(actor)) return;
    const w = S.wait;
    timer = setTimeout(() => {
      if (!amHost() || !S || S.wait !== w) return;
      E.botAct(S);
      commit();
      timer = setTimeout(loop, PACE);
    }, 1000 + rnd(900));
  }

  function handleAct(d, from) {
    if (!S) return;
    const s = S;
    const isH = roomPlayers.length > 0 && from.id === roomPlayers[0].id;
    const idx = s.players ? s.players.findIndex(p => p.id === from.id) : -1;
    const go = fn => { clearTimeout(timer); fn(); commit(); timer = setTimeout(loop, PACE); };
    switch (d.a) {
      case 'hit':
        if (s.phase === 'play' && s.wait === 'turn' && idx >= 0 && idx === s.turn) go(() => E.hit(s));
        break;
      case 'stay':
        if (s.phase === 'play' && s.wait === 'turn' && idx >= 0 && idx === s.turn) go(() => E.stay(s));
        break;
      case 'target':
        if (s.phase === 'play' && s.wait === 'target' && s.players[s.pending.by].id === from.id) go(() => E.target(s, +d.i));
        break;
      case 'addbot':
        if (isH && s.phase === 'lobby' && roomPlayers.length + s.bots.length < E.MAX_PLAYERS) {
          const used = s.bots.map(b => b.name);
          const b = BOTS.find(x => !used.includes(x[0])) || BOTS[rnd(BOTS.length)];
          s.bots.push({ id: 'bot' + Date.now().toString(36) + rnd(99), name: b[0], emoji: b[1] });
          commit();
        }
        break;
      case 'rmbot':
        if (isH && s.phase === 'lobby' && s.bots[+d.i]) { s.bots.splice(+d.i, 1); commit(); }
        break;
      case 'start':
        if (isH && s.phase === 'lobby' && roomPlayers.length + s.bots.length >= 2) {
          const g = E.newGame(roomPlayers.map(r => ({ id: r.id, name: r.name })), s.bots, code, s.evId);
          g.v = s.v; g.av = s.av || {}; g.bots = s.bots;
          S = g; prev = {};
          commit(); kick();
        }
        break;
      case 'next':
        if (isH && s.phase === 'roundEnd') { E.nextRound(s); commit(); kick(); }
        break;
      case 'again':
        if (isH && s.phase === 'gameEnd') {
          S = { v: s.v, phase: 'lobby', bots: s.bots || [], av: s.av || {}, ev: s.ev, evId: s.evId, log: [] };
          prev = {};
          commit();
        }
        break;
    }
  }

  /* ======================= état reçu ======================= */
  function onState() {
    render();
    runEvents();
    checkTurn();
    reportResult();
  }

  function checkTurn() {
    const my = myIdx();
    const mine = my >= 0 && S.phase === 'play' &&
      ((S.wait === 'turn' && S.turn === my) || (S.wait === 'target' && S.pending && S.pending.by === my));
    if (mine && !wasMyTurn) { SND.turn(); try { navigator.vibrate && navigator.vibrate(60); } catch (e) {} }
    wasMyTurn = !!mine;
  }

  function reportResult() {
    if (local || !S || S.phase !== 'gameEnd' || reported.has(S.partie)) return;
    const my = myIdx();
    if (my < 0 || S.players[my].bot) return;
    reported.add(S.partie);
    if (window.ChadGang && ChadGang.finPartie) {
      ChadGang.finPartie({ gagne: my === S.winner, partie: S.partie, score: S.players[my].score }).catch(() => {});
    }
  }

  /* ======================= rendu ======================= */
  function render() {
    if (!S) {
      show('lobby');
      $('#lobby').innerHTML = '<div class="panel lobby-card"><p class="center">Connexion à la salle…</p><button class="link" data-a="leave">Annuler</button></div>';
      return;
    }
    if (S.phase === 'lobby') { show('lobby'); renderLobby(); }
    else { show('game'); renderGame(); }
  }

  function avatarInner(id, name, emoji) {
    if (emoji) return emoji;
    const u = (S && S.av && S.av[id]) || (id === myId ? me.avatar : null);
    return u ? '<img src="' + esc(u) + '" alt="">' : esc((name || '?').charAt(0).toUpperCase());
  }
  const av = (id, name, emoji) => '<span class="av" data-chadgang-id="' + esc(id) + '">' + avatarInner(id, name, emoji) + '</span>';

  function renderLobby() {
    const host = amHost(), bots = S.bots || [], total = roomPlayers.length + bots.length;
    $('#lobby').innerHTML =
      '<div class="panel lobby-card">' +
      '<h2>🃏 Salle <span class="code">' + esc(code) + '</span></h2>' +
      '<p class="hint">' + (local ? 'Mode solo contre des bots.' : 'Partage le code, ou utilise « Inviter » dans la barre du hub.') + '</p>' +
      '<div class="chips">' +
      roomPlayers.map((p, i) => '<div class="chip">' + av(p.id, p.name) + esc(p.name) + (i === 0 ? ' 👑' : '') + '</div>').join('') +
      bots.map((b, i) => '<div class="chip bot">' + av(b.id, b.name, b.emoji) + esc(b.name) +
        (host ? ' <button class="x" data-a="rmbot" data-i="' + i + '" title="Retirer">✕</button>' : '') + '</div>').join('') +
      '</div>' +
      (host
        ? '<div class="row"><button data-a="addbot"' + (total >= E.MAX_PLAYERS ? ' disabled' : '') + '>＋ Ajouter un bot</button>' +
          '<button class="big go" data-a="start"' + (total < 2 ? ' disabled' : '') + '>Lancer la partie ▶</button></div>' +
          (total < 2 ? '<p class="hint">Il faut au moins 2 joueurs (ajoute un bot !).</p>' : '')
        : '<p class="wait">En attente de l\'hôte…</p>') +
      '<div class="row"><button class="link" data-a="rules">Règles</button><button class="link" data-a="leave">Quitter</button></div>' +
      '</div>';
  }

  function cardHTML(c, cls) {
    cls = cls || '';
    if (typeof c === 'number') return '<div class="card n ' + cls + '" style="--h:' + ((c * 31) % 360) + '"><i>' + c + '</i><b>' + c + '</b></div>';
    if (c === 'F') return '<div class="card act f ' + cls + '"><span>❄️</span><b>GEL</b></div>';
    if (c === 'T') return '<div class="card act t ' + cls + '"><span>🔄</span><b>FLIP ×3</b></div>';
    if (c === 'S') return '<div class="card act s ' + cls + '"><span>🛡️</span><b>2ᵉ CHANCE</b></div>';
    return '<div class="card mod ' + (c === 'x2' ? 'x' : '') + ' ' + cls + '"><b>' + (c === 'x2' ? '×2' : c) + '</b></div>';
  }

  function panelHTML(p, i) {
    const s = S, my = myIdx();
    const uniq = new Set(p.nums).size;
    const dealt = s.dealIdx >= s.players.length;
    const isTurn = s.phase === 'play' && dealt && s.turn === i && !s.turnDone && p.st === 'active';
    const pd = s.pending;
    const elig = pd && pd.by === my && pd.elig.includes(i);
    const pv = prev[i] || { n: {}, m: {}, sc: false };

    const cnt = {};
    const lastDup = p.st === 'busted' ? p.nums[p.nums.length - 1] : -1;
    const nums = p.nums.slice().sort((a, b) => a - b).map(v => {
      cnt[v] = (cnt[v] || 0) + 1;
      const isNew = cnt[v] > (pv.n[v] || 0);
      const dup = v === lastDup && cnt[v] === 2;
      return cardHTML(v, (isNew ? 'deal ' : '') + (dup ? 'dup' : ''));
    }).join('');
    const mc = {};
    const mods = p.mods.slice().sort().map(m => {
      mc[m] = (mc[m] || 0) + 1;
      return cardHTML(m, mc[m] > (pv.m[m] || 0) ? 'deal' : '');
    }).join('');
    const sc = p.sc ? cardHTML('S', pv.sc ? '' : 'deal') : '';
    prev[i] = { n: cnt, m: mc, sc: p.sc };

    const cls = ['pl', 'st-' + p.st, isTurn ? 'turn' : '', i === my ? 'me' : '', elig ? 'elig' : '',
      p.st === 'active' && uniq >= 6 ? 'blaze' : (p.st === 'active' && uniq >= 5 ? 'hot' : ''), p.gone ? 'gone' : ''].join(' ');
    const badge = isTurn ? '👉 Son tour' : STATUS[p.st];
    const pot = p.st === 'busted' ? 0 : E.calc(p);

    return '<div class="' + cls + '" data-pi="' + i + '">' +
      '<div class="pl-head">' + av(p.id, p.name, p.emoji) +
      '<div class="who"><b>' + esc(p.name) + (i === my ? ' (toi)' : '') + '</b><small>' + (p.gone ? '📴 ' : '') + badge + '</small></div>' +
      '<div class="tot"><b>' + p.score + '</b><small>total</small></div></div>' +
      '<div class="cards">' + (nums + mods + sc || '<span class="empty">—</span>') + '</div>' +
      '<div class="pl-foot"><div class="meter" title="' + uniq + ' / 7 numéros">' +
      [0, 1, 2, 3, 4, 5, 6].map(k => '<i class="' + (k < uniq ? 'on' : '') + '"></i>').join('') + '</div>' +
      '<span class="pot ' + (p.st === 'busted' ? 'bad' : '') + '">' + (S.phase === 'play' ? 'vaut ' : 'manche ') + pot + '</span></div>' +
      '</div>';
  }

  function renderGame() {
    const s = S, my = myIdx();
    $('#top').innerHTML =
      '<div class="tag">Manche <b>' + s.round + '</b></div><div class="tag">Objectif <b>' + E.TARGET + '</b></div>' +
      '<span class="grow"></span>' + (local || !amHost() ? '' : '<span class="tag">👑 Hôte</span>') +
      '<button class="ib" data-a="rules">?</button><button class="ib" data-a="mute">' + (SND.isMuted() ? '🔇' : '🔊') + '</button>' +
      '<button class="ib" data-a="leave" title="Quitter">⏏</button>';
    $('#deckn').textContent = s.deck.length;
    $('#log').innerHTML = s.log.slice(-4).map(t => '<li>' + esc(t) + '</li>').join('');

    // résumé fin de manche / partie
    let sum = '';
    if (s.phase === 'roundEnd' || s.phase === 'gameEnd') {
      const order = s.players.map((p, i) => i).sort((a, b) => s.players[b].score - s.players[a].score);
      sum = '<div class="panel summary"><h3>' +
        (s.phase === 'gameEnd' ? '🏆 ' + esc(s.players[s.winner].name) + ' remporte la partie !' : 'Fin de la manche ' + s.round) + '</h3>' +
        (s.tie ? '<p class="hint">⚖️ Égalité au sommet : on rejoue une manche !</p>' : '') +
        order.map((i, rank) => {
          const p = s.players[i];
          return '<div class="srow"><span class="rk">' + (rank + 1) + '</span><span class="nm">' + esc(p.name) + '</span>' +
            '<div class="gauge"><i style="width:' + Math.min(100, p.score / E.TARGET * 100) + '%"></i></div>' +
            '<b>' + p.score + '</b><em>+' + p.rs + '</em></div>';
        }).join('') + '</div>';
    }
    $('#summary').innerHTML = sum;

    const tbl = $('#table'), st = tbl.scrollTop;
    $('#players').innerHTML = s.players.map(panelHTML).join('');
    tbl.scrollTop = st;
    const t = $('.pl.turn') || $('.pl.elig');
    if (t && t.scrollIntoView) t.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

    renderBar(my);
  }

  function renderBar(my) {
    const s = S, host = amHost();
    let h = '';
    if (s.phase === 'play') {
      if (my < 0) h = '<div class="msg">👀 Tu regardes : tu joueras à la prochaine partie.</div>';
      else if (s.wait === 'turn' && s.turn === my) {
        h = '<button class="big hit" data-a="hit">🃏 Piocher</button>' +
          '<button class="big stay" data-a="stay">✋ Stop (' + E.calc(s.players[my]) + ' pts)</button>';
      } else if (s.wait === 'target' && s.pending.by === my) h = '<div class="msg pulse">' + PROMPT[s.pending.card] + ' <small>Clique sur un joueur</small></div>';
      else if (s.wait === 'turn') h = '<div class="msg">Tour de <b>' + esc(s.players[s.turn].name) + '</b>…</div>';
      else if (s.wait === 'target') h = '<div class="msg">' + esc(s.players[s.pending.by].name) + ' choisit une cible…</div>';
      else h = '<div class="msg">…</div>';
    } else if (s.phase === 'roundEnd') {
      h = host ? '<button class="big go" data-a="next">Manche suivante ▶</button>' : '<div class="msg">En attente de l\'hôte…</div>';
    } else {
      h = host ? '<button class="big go" data-a="again">Rejouer ▶</button>' : '<div class="msg">En attente de l\'hôte…</div>';
    }
    h += '<div class="emos">' + EMOS.map(e => '<button data-a="emo" data-e="' + e + '">' + e + '</button>').join('') + '</div>';
    $('#bar').innerHTML = h;
  }

  /* ======================= effets ======================= */
  function centerOf(i) {
    const el = i >= 0 ? $('.pl[data-pi="' + i + '"]') : null;
    if (!el) return { x: innerWidth / 2, y: innerHeight / 2 };
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: Math.min(innerHeight - 90, Math.max(110, r.top + r.height / 2)) };
  }

  function runEvents() {
    const evs = S.ev || [];
    const top = evs.length ? evs[evs.length - 1].id : 0;
    if (lastEv === null) { lastEv = top; return; }
    evs.filter(e => e.id > lastEv).forEach(e => { try { playEvent(e); } catch (err) { /* un effet raté ne doit jamais bloquer le jeu */ } });
    lastEv = Math.max(lastEv, top);
  }

  function playEvent(e) {
    const pl = S.players && e.p >= 0 ? S.players[e.p] : null;
    const nm = pl ? pl.name : '';
    const c = centerOf(e.p);
    switch (e.k) {
      case 'draw':
        $('#last').innerHTML = '<div class="who">' + esc(nm) + ' pioche</div>' + cardHTML(e.x, 'big flipin');
        SND.draw(); break;
      case 'num':
        SND.num(e.x);
        FX.burst(c.x, c.y, { n: 8 + e.x * 2, speed: 3 + e.x * 0.4, colors: ['#ffd426', '#fff'], round: true });
        if (e.x === 6) { FX.banner('PLUS QU\'UNE !', '#ffd426', 1300); SND.heart(); FX.flash('rgba(255,120,0,.4)'); }
        else if (e.x === 5) FX.float('🔥 ça chauffe', c.x, c.y);
        break;
      case 'mod':
        SND.mod(); FX.burst(c.x, c.y, { n: 14, emoji: '✨', speed: 4 });
        if (e.x === 'x2') { SND.x2(); FX.banner('×2 !!', '#ffd426'); FX.flash('rgba(255,212,38,.55)'); }
        break;
      case 'bust':
        SND.bust(); FX.shake(); FX.flash('rgba(255,0,40,.55)'); FX.banner('BUST !', '#ff3b4e');
        FX.burst(c.x, c.y, { n: 30, speed: 9, colors: ['#ff3b4e', '#ff8a2b', '#ffd426', '#12102b'], g: 0.2 });
        FX.rain(['💀', '💥'], 8);
        FX.float('Doublon ' + e.x + ' !', c.x, c.y, '#ff3b4e');
        break;
      case 'save':
        SND.save(); FX.float('🛡️ SAUVÉ !', c.x, c.y, '#2fd27a');
        FX.burst(c.x, c.y, { n: 24, colors: ['#2fd27a', '#b8ffd9', '#fff'], round: true, speed: 6 });
        break;
      case 'sc':
        SND.save(); FX.float('🛡️ Seconde Chance', c.x, c.y, '#2fd27a'); break;
      case 'freeze':
        SND.freeze(); FX.flash('rgba(120,200,255,.55)'); FX.banner('GEL 🥶', '#8fe3ff'); FX.snow(c.x, c.y);
        FX.float('🥶', c.x, c.y); FX.rain(['🥶', '❄️'], 14); break;
      case 'flip3':
        SND.flip3(); FX.banner('FLIP THREE ×3', '#ff9f1c'); FX.burst(c.x, c.y, { n: 6, emoji: '🔄', speed: 6, g: 0 }); break;
      case 'stay':
        SND.stay(); FX.coins(c.x, c.y); FX.float('+' + e.x + ' pts', c.x, c.y, '#ffd426'); break;
      case 'flip7':
        SND.flip7(); FX.banner('FLIP 7 !!!', '#ffd426', 2400); FX.flash('rgba(255,212,38,.85)'); FX.shake(); FX.confetti(1.6); FX.rain(['🔥', '🎉', '7️⃣'], 16); break;
      case 'win':
        SND.win(); FX.confetti(2.5); FX.rain(['🏆', '🎉'], 16); FX.banner('🏆 ' + nm + ' GAGNE !', '#ffd426', 3000); break;
      case 'roundEnd': SND.tick(); break;
      case 'round': SND.tick(); FX.banner('MANCHE ' + e.x, '#fff', 1000); break;
      case 'shuffle': toast('🔀 Défausse mélangée dans la pioche'); break;
    }
  }

  function showEmo(e, fromId) {
    const i = S && S.players ? S.players.findIndex(p => p.id === fromId) : -1;
    const c = i >= 0 ? centerOf(i) : { x: innerWidth / 2 + rnd(80) - 40, y: innerHeight - 140 };
    SND.pop();
    FX.float(e, c.x + rnd(60) - 30, c.y);
    FX.burst(c.x, c.y, { n: 6, emoji: e, speed: 4, g: -0.02 });
  }

  /* ======================= règles ======================= */
  function showRules() {
    const m = $('#modal');
    m.innerHTML = '<div class="panel rules"><h2>Règles de Flip 7</h2><ul>' +
      '<li>À ton tour : <b>Piocher</b> ou <b>Stop</b> (tu encaisses les points de ta manche).</li>' +
      '<li>Piocher un numéro que tu as déjà = <b>BUST 💥</b>, tu perds tout pour la manche.</li>' +
      '<li><b>7 numéros différents</b> = <b>FLIP 7 🔥</b> : la manche s\'arrête, +15 pts !</li>' +
      '<li>Bonus : <b>+2 … +10</b> s\'ajoutent, <b>×2</b> double tes numéros.</li>' +
      '<li>❄️ <b>Gel</b> : la cible encaisse et sort de la manche.</li>' +
      '<li>🔄 <b>Flip Three</b> : la cible pioche 3 cartes d\'affilée.</li>' +
      '<li>🛡️ <b>Seconde Chance</b> : annule un doublon (une fois).</li>' +
      '<li>Premier à <b>' + E.TARGET + ' pts</b> à la fin d\'une manche gagne !</li>' +
      '</ul><button class="big go" data-a="closemodal">Compris !</button></div>';
    m.hidden = false;
  }

  /* ======================= clics ======================= */
  document.addEventListener('click', ev => {
    SND.init();
    const el = ev.target.closest('[data-a]');
    if (el) { act(el.dataset.a, el); return; }
    const pl = ev.target.closest('.pl.elig');
    if (pl) send({ t: 'act', a: 'target', i: +pl.dataset.pi });
  });

  function act(a, el) {
    switch (a) {
      case 'create': connectOnline(randomCode(), true); break;
      case 'join': connectOnline($('#code').value, false); break;
      case 'solo': startLocal(); break;
      case 'leave': leaveRoom(); break;
      case 'rules': showRules(); break;
      case 'closemodal': $('#modal').hidden = true; break;
      case 'mute': SND.toggle(); if (S && S.phase !== 'lobby') renderGame(); break;
      case 'emo': send({ t: 'emo', e: el.dataset.e }); break;
      case 'rmbot': send({ t: 'act', a: 'rmbot', i: +el.dataset.i }); break;
      default: send({ t: 'act', a }); // hit, stay, start, addbot, next, again
    }
  }

  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') e.target.hidden = true; });
  $('#code').addEventListener('keydown', e => { if (e.key === 'Enter') act('join'); });

  init();
})();
