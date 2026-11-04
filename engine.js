'use strict';
/* Moteur de règles Flip 7 — exécuté uniquement par l'hôte de la salle.
   Cartes : nombre (0-12) = entier ; '+2','+4','+6','+8','+10','x2' = bonus ;
   'F' = Gel, 'T' = Flip Three, 'S' = Seconde Chance. */
const Flip7 = (() => {
  const TARGET = 200;
  const MAX_PLAYERS = 12;

  const rnd = n => Math.floor(Math.random() * n);
  const isNum = c => typeof c === 'number';
  const isMod = c => typeof c === 'string' && (c[0] === '+' || c === 'x2');

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = rnd(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function newDeck() {
    const d = [];
    for (let n = 0; n <= 12; n++) {
      const copies = n === 0 ? 1 : n;
      for (let i = 0; i < copies; i++) d.push(n);
    }
    ['+2', '+4', '+6', '+8', '+10', 'x2'].forEach(m => d.push(m));
    for (let i = 0; i < 3; i++) d.push('F', 'T', 'S');
    return shuffle(d); // 79 + 6 + 9 = 94 cartes
  }

  function ev(s, k, p, x) {
    s.ev.push({ id: ++s.evId, k, p, x });
    if (s.ev.length > 16) s.ev.shift();
  }
  function lg(s, t) {
    s.log.push(t);
    if (s.log.length > 8) s.log.shift();
  }

  // Points de la manche d'un joueur
  function calc(p) {
    if (p.st === 'busted') return 0;
    let t = [...new Set(p.nums)].reduce((a, b) => a + b, 0);
    if (p.mods.includes('x2')) t *= 2;
    p.mods.forEach(m => { if (m[0] === '+') t += parseInt(m.slice(1), 10); });
    if (p.st === 'flip7') t += 15;
    return t;
  }

  /* ---------- création ---------- */
  function newGame(humans, bots, code, evId) {
    const players = humans.map(h => ({ id: h.id, name: h.name, bot: false }))
      .concat(bots.map(b => ({ id: b.id, name: b.name, emoji: b.emoji, bot: true })));
    players.forEach(p => Object.assign(p, { gone: false, score: 0, rs: 0, st: 'active', nums: [], mods: [], sc: false }));
    const s = {
      v: 0, phase: 'play', code, partie: code + '-' + Date.now().toString(36),
      round: 0, players, deck: newDeck(), discard: [], dealer: rnd(players.length),
      ev: [], evId: evId || 0, log: [], wait: null, winner: -1, tie: false
    };
    startRound(s);
    return s;
  }

  function startRound(s) {
    s.round++;
    s.players.forEach(p => {
      s.discard.push(...p.nums, ...p.mods);
      if (p.sc) s.discard.push('S');
      p.nums = []; p.mods = []; p.sc = false; p.rs = 0;
      p.st = p.gone ? 'out' : 'active';
    });
    s.phase = 'play';
    s.dealIdx = 0; s.turn = -1; s.turnDone = false;
    s.pending = null; s.flip = null; s.todo = []; s.wait = null; s.tie = false;
    ev(s, 'round', -1, s.round);
    lg(s, '▶ Manche ' + s.round + ' : on distribue !');
  }

  function nextRound(s) {
    if (s.phase !== 'roundEnd') return;
    s.dealer = (s.dealer + 1) % s.players.length;
    startRound(s);
  }

  /* ---------- pioche ---------- */
  function draw(s) {
    if (!s.deck.length && s.discard.length) {
      s.deck = shuffle(s.discard.splice(0));
      ev(s, 'shuffle');
      lg(s, '🔀 La défausse est mélangée dans la pioche');
    }
    if (!s.deck.length) { finishRound(s); return null; }
    return s.deck.pop();
  }

  /* ---------- effets des cartes ---------- */
  function give(s, pi, c, inFlip) {
    const p = s.players[pi];
    ev(s, 'draw', pi, c);
    if (isNum(c)) {
      if (p.nums.includes(c)) {
        if (p.sc) {
          p.sc = false; s.discard.push('S', c);
          ev(s, 'save', pi, c);
          lg(s, '🛡️ ' + p.name + ' évite le doublon ' + c + ' grâce à sa Seconde Chance');
        } else {
          p.nums.push(c); p.st = 'busted';
          ev(s, 'bust', pi, c);
          lg(s, '💥 ' + p.name + ' fait BUST avec un deuxième ' + c);
        }
      } else {
        p.nums.push(c);
        ev(s, 'num', pi, p.nums.length);
        lg(s, p.name + ' pioche un ' + c);
        if (p.nums.length === 7) {
          p.st = 'flip7';
          ev(s, 'flip7', pi);
          lg(s, '🔥 FLIP 7 pour ' + p.name + ' !!!');
        }
      }
    } else if (isMod(c)) {
      p.mods.push(c);
      ev(s, 'mod', pi, c);
      lg(s, '✨ ' + p.name + ' gagne un bonus ' + (c === 'x2' ? '×2' : c));
    } else if (c === 'S') {
      if (!p.sc) {
        p.sc = true;
        ev(s, 'sc', pi);
        lg(s, '🛡️ ' + p.name + ' garde une Seconde Chance');
      } else {
        const el = [];
        s.players.forEach((q, i) => { if (i !== pi && q.st === 'active' && !q.sc) el.push(i); });
        if (!el.length) { s.discard.push('S'); lg(s, '🛡️ Seconde Chance en trop : défaussée'); }
        else if (el.length === 1) { s.players[el[0]].sc = true; ev(s, 'sc', el[0]); lg(s, '🛡️ ' + p.name + ' offre sa Seconde Chance à ' + s.players[el[0]].name); }
        else s.pending = { card: 'S', by: pi, elig: el };
      }
    } else { // F ou T
      if (inFlip) s.flip.deferred.push({ card: c, by: pi });
      else startAction(s, c, pi);
    }
  }

  function startAction(s, c, by) {
    const el = [];
    s.players.forEach((q, i) => { if (q.st === 'active') el.push(i); });
    if (!el.length) { s.discard.push(c); return; }
    if (el.length === 1) resolveTarget(s, c, by, el[0]);
    else s.pending = { card: c, by, elig: el };
  }

  function resolveTarget(s, c, by, t) {
    const tp = s.players[t], bp = s.players[by];
    if (c === 'F') {
      s.discard.push('F');
      tp.st = 'frozen';
      ev(s, 'freeze', t, by);
      lg(s, '❄️ ' + bp.name + ' gèle ' + tp.name + ' (' + calc(tp) + ' pts encaissés)');
    } else if (c === 'T') {
      s.discard.push('T');
      s.flip = { p: t, left: 3, deferred: [] };
      ev(s, 'flip3', t, by);
      lg(s, '🔄 ' + bp.name + ' lance Flip Three sur ' + tp.name);
    } else {
      tp.sc = true;
      ev(s, 'sc', t);
      lg(s, '🛡️ ' + bp.name + ' offre sa Seconde Chance à ' + tp.name);
    }
  }

  function target(s, t) {
    const pd = s.pending;
    if (!pd || !pd.elig.includes(t)) return false;
    s.pending = null; s.wait = null;
    resolveTarget(s, pd.card, pd.by, t);
    return true;
  }

  /* ---------- actions des joueurs ---------- */
  function hit(s) {
    s.wait = null; s.turnDone = true;
    const c = draw(s);
    if (c == null) return;
    give(s, s.turn, c, false);
  }

  function stay(s) {
    s.wait = null; s.turnDone = true;
    const p = s.players[s.turn];
    p.st = 'stayed';
    ev(s, 'stay', s.turn, calc(p));
    lg(s, '✋ ' + p.name + ' s\'arrête avec ' + calc(p) + ' pts');
  }

  /* ---------- fin de manche ---------- */
  function finishRound(s) {
    // cartes en suspens -> défausse
    if (s.pending) s.discard.push(s.pending.card);
    if (s.flip) s.flip.deferred.forEach(d => s.discard.push(d.card));
    (s.todo || []).forEach(d => s.discard.push(d.card));
    s.pending = null; s.flip = null; s.todo = []; s.wait = null;

    s.players.forEach(p => { p.rs = calc(p); p.score += p.rs; });
    const max = Math.max(...s.players.map(p => p.score));
    const leaders = s.players.filter(p => p.score === max);
    s.phase = 'roundEnd';
    if (max >= TARGET && leaders.length === 1) {
      s.phase = 'gameEnd';
      s.winner = s.players.indexOf(leaders[0]);
      ev(s, 'roundEnd', -1);
      ev(s, 'win', s.winner);
      lg(s, '🏆 ' + leaders[0].name + ' remporte la partie avec ' + max + ' pts !');
    } else {
      s.tie = max >= TARGET;
      ev(s, 'roundEnd', -1);
      lg(s, s.tie ? '⚖️ Égalité au sommet : manche supplémentaire !' : '🏁 Fin de la manche ' + s.round);
    }
  }

  /* ---------- un pas de jeu automatique ----------
     Renvoie true s'il s'est passé quelque chose (l'hôte rappelle step après un délai),
     false quand on attend un joueur (s.wait = 'turn' ou 'target'). */
  function nextActive(s, from) {
    const n = s.players.length;
    for (let k = 1; k <= n; k++) {
      const i = (from + k) % n;
      if (s.players[i].st === 'active') return i;
    }
    return -1;
  }

  function step(s) {
    s.wait = null;
    if (s.phase !== 'play') return false;
    const pl = s.players;

    if (pl.some(p => p.st === 'flip7')) { finishRound(s); return true; }
    if (s.pending) { s.wait = 'target'; return false; }

    if (s.flip) {
      const f = s.flip, p = pl[f.p];
      if (p.st !== 'active') {
        f.deferred.forEach(d => s.discard.push(d.card));
        s.flip = null; return true;
      }
      if (f.left <= 0) { s.todo.push(...f.deferred); s.flip = null; return true; }
      f.left--;
      const c = draw(s);
      if (c == null) return true;
      give(s, f.p, c, true);
      return true;
    }

    if (s.todo.length) {
      const d = s.todo.shift();
      startAction(s, d.card, d.by);
      return true;
    }

    while (s.dealIdx < pl.length && pl[(s.dealer + 1 + s.dealIdx) % pl.length].st !== 'active') s.dealIdx++;
    if (s.dealIdx < pl.length) {
      const i = (s.dealer + 1 + s.dealIdx) % pl.length;
      s.dealIdx++;
      const c = draw(s);
      if (c == null) return true;
      give(s, i, c, false);
      return true;
    }

    if (!pl.some(p => p.st === 'active')) { finishRound(s); return true; }

    if (s.turn < 0) s.turn = nextActive(s, s.dealer);
    else if (s.turnDone || pl[s.turn].st !== 'active') s.turn = nextActive(s, s.turn);
    s.turnDone = false;
    s.wait = 'turn';
    return false;
  }

  /* ---------- bots ---------- */
  function botHits(s) {
    const me = s.players[s.turn];
    const cur = calc(me);
    const uniq = new Set(me.nums);
    const left = Math.max(1, s.deck.length);
    let danger = 0;
    if (!me.sc) uniq.forEach(n => { danger += s.deck.filter(c => c === n).length; });
    const pb = danger / left;
    let gain = 6.5;
    if (uniq.size === 6) gain += 15;
    else if (uniq.size === 5) gain += 3;
    const value = (1 - pb) * gain - pb * cur + (Math.random() * 3 - 1.5);
    return cur === 0 || value > 0;
  }

  function botTarget(s) {
    const pd = s.pending, me = pd.by, el = pd.elig, pl = s.players;
    const others = el.filter(i => i !== me);
    if (pd.card === 'S') return el[rnd(el.length)];
    if (pd.card === 'F') {
      if (el.includes(me) && calc(pl[me]) >= 14 && Math.random() < 0.7) return me;
      if (others.length) return others.reduce((a, b) => calc(pl[b]) > calc(pl[a]) ? b : a);
      return me;
    }
    if (others.length) {
      const rate = i => new Set(pl[i].nums).size - (pl[i].sc ? 4 : 0) + Math.random();
      return others.reduce((a, b) => rate(b) > rate(a) ? b : a);
    }
    return me;
  }

  function botAct(s) {
    if (s.wait === 'turn') { if (botHits(s)) hit(s); else stay(s); }
    else if (s.wait === 'target') target(s, botTarget(s));
  }

  return { TARGET, MAX_PLAYERS, newGame, nextRound, step, hit, stay, target, botAct, calc, isNum };
})();

if (typeof module !== 'undefined') module.exports = Flip7;
