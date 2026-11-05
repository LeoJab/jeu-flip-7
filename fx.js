'use strict';
/* Sons (WebAudio synthétisé) et effets visuels (particules, bannières, secousses). */

const SND = (() => {
  let ctx = null, master = null, muted = false;
  try { muted = localStorage.getItem('f7mute') === '1'; } catch (e) {}

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);
    } catch (e) { ctx = null; }
  }
  function tone(f, d, type, v, at, to) {
    if (!ctx || muted) return;
    const t = ctx.currentTime + (at || 0);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(f, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + d);
    g.gain.setValueAtTime(v || 0.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + d);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + d + 0.03);
  }
  function noise(d, v, at, hp) {
    if (!ctx || muted) return;
    const n = Math.floor(ctx.sampleRate * d);
    const b = ctx.createBuffer(1, n, ctx.sampleRate), a = b.getChannelData(0);
    for (let i = 0; i < n; i++) a[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = ctx.createBufferSource(); s.buffer = b;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp || 800;
    const g = ctx.createGain(); g.gain.value = v || 0.2;
    s.connect(f); f.connect(g); g.connect(master);
    s.start(ctx.currentTime + (at || 0));
  }

  const S = {
    draw() { noise(0.12, 0.15, 0, 2000); tone(500, 0.06, 'triangle', 0.1); },
    num(n) { tone(260 + n * 45, 0.18, 'triangle', 0.25); tone(520 + n * 90, 0.1, 'sine', 0.1, 0.03); },
    mod() { [880, 1175, 1568].forEach((f, i) => tone(f, 0.15, 'sine', 0.15, i * 0.06)); },
    x2() { [392, 523, 784, 1047].forEach((f, i) => tone(f, 0.2, 'square', 0.12, i * 0.07)); },
    bust() { tone(220, 0.5, 'sawtooth', 0.3, 0, 40); noise(0.4, 0.35, 0, 200); tone(90, 0.4, 'square', 0.25, 0.05, 30); },
    save() { tone(660, 0.12, 'sine', 0.25); tone(990, 0.25, 'sine', 0.25, 0.1); tone(1320, 0.3, 'sine', 0.2, 0.2); },
    freeze() { noise(0.5, 0.2, 0, 4000); [2200, 2800, 3300].forEach((f, i) => tone(f, 0.4, 'sine', 0.1, i * 0.05)); },
    flip3() { tone(200, 0.5, 'sawtooth', 0.15, 0, 900); tone(400, 0.4, 'triangle', 0.15, 0.1, 1200); },
    stay() { tone(988, 0.07, 'square', 0.12); tone(1319, 0.25, 'square', 0.12, 0.07); },
    flip7() {
      [523, 659, 784, 1047, 1319, 1568, 2093].forEach((f, i) => { tone(f, 0.35, 'square', 0.14, i * 0.08); tone(f / 2, 0.35, 'triangle', 0.18, i * 0.08); });
      noise(0.8, 0.2, 0.5, 5000);
    },
    win() {
      [392, 392, 392, 523, 659, 523, 659, 784].forEach((f, i) => { tone(f, 0.3, 'square', 0.13, i * 0.14); tone(f / 2, 0.3, 'triangle', 0.16, i * 0.14); });
    },
    tick() { tone(1200, 0.04, 'square', 0.06); },
    heart() { tone(60, 0.12, 'sine', 0.5); tone(55, 0.14, 'sine', 0.5, 0.18); },
    turn() { tone(784, 0.1, 'triangle', 0.2); tone(1047, 0.16, 'triangle', 0.2, 0.09); },
    pop() { tone(400, 0.08, 'sine', 0.15, 0, 800); }
  };

  return Object.assign(S, {
    init,
    isMuted: () => muted,
    toggle() {
      muted = !muted;
      try { localStorage.setItem('f7mute', muted ? '1' : '0'); } catch (e) {}
      return muted;
    }
  });
})();

const FX = (() => {
  const cv = document.getElementById('fx'), c = cv.getContext('2d');
  const RM = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.3 : 1;
  const P = [];
  let W = 0, H = 0, raf = 0;

  function size() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = innerWidth; H = innerHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  addEventListener('resize', size); size();

  // Emojis dessinés une seule fois dans un petit canvas (beaucoup plus léger que fillText à chaque image)
  const SPR = {};
  function sprite(e) {
    if (SPR[e]) return SPR[e];
    const k = document.createElement('canvas'); k.width = k.height = 64;
    const g = k.getContext('2d');
    g.font = '46px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(e, 32, 34);
    return (SPR[e] = k);
  }

  function spawn(o) {
    if (P.length > 120) return; // plafond de particules : évite de faire ramer / planter
    P.push(Object.assign({ x: 0, y: 0, vx: 0, vy: 0, g: 0.18, life: 70, max: 70, size: 7, color: '#fff', rot: 0, vr: 0, shape: 'sq', drag: 0.992, emoji: null }, o, { max: o.life || 70 }));
    if (!raf) raf = requestAnimationFrame(loop);
  }
  function loop() {
    c.clearRect(0, 0, W, H);
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i];
      p.vx *= p.drag; p.vy = p.vy * p.drag + p.g;
      p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life--;
      if (p.life <= 0 || p.y > H + 40) { P.splice(i, 1); continue; }
      c.globalAlpha = Math.min(1, p.life / (p.max * 0.35));
      c.save(); c.translate(p.x, p.y); c.rotate(p.rot);
      if (p.emoji) c.drawImage(sprite(p.emoji), -p.size / 2, -p.size / 2, p.size, p.size);
      else {
        c.fillStyle = p.color;
        if (p.shape === 'c') { c.beginPath(); c.arc(0, 0, p.size / 2, 0, 6.283); c.fill(); }
        else c.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
      }
      c.restore();
    }
    c.globalAlpha = 1;
    if (P.length) raf = requestAnimationFrame(loop);
    else { raf = 0; c.clearRect(0, 0, W, H); }
  }

  const r = (a, b) => a + Math.random() * (b - a);
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const COLORS = ['#ffd426', '#ff3b4e', '#2433f2', '#2fd27a', '#ff8a2b', '#fff', '#b45bff'];

  function burst(x, y, o) {
    o = o || {};
    const n = Math.round((o.emoji ? Math.min(o.n || 20, 6) : Math.min(o.n || 20, 30)) * RM);
    for (let i = 0; i < n; i++) {
      const a = r(0, 6.283), sp = r(1, o.speed || 5);
      spawn({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1, g: o.g == null ? 0.15 : o.g,
        life: r(35, 70), size: o.emoji ? r(16, 30) : r(5, 10), rot: r(0, 6), vr: r(-0.3, 0.3),
        color: pick(o.colors || COLORS), shape: o.round ? 'c' : 'sq', emoji: o.emoji ? pick(Array.isArray(o.emoji) ? o.emoji : [o.emoji]) : null
      });
    }
  }
  function confetti(power) {
    power = power || 1;
    const n = Math.round(34 * power * RM);
    for (let i = 0; i < n; i++) {
      const left = i % 2 === 0;
      spawn({
        x: left ? 0 : W, y: H * 0.85, vx: (left ? 1 : -1) * r(4, 13), vy: r(-19, -8), g: 0.28,
        life: r(90, 160), size: r(6, 12), rot: r(0, 6), vr: r(-0.4, 0.4), color: pick(COLORS), drag: 0.985
      });
    }
    for (let i = 0; i < Math.round(18 * power * RM); i++) {
      spawn({ x: r(0, W), y: r(-60, -10), vx: r(-1.5, 1.5), vy: r(1, 4), g: 0.06, life: r(120, 200), size: r(6, 11), rot: r(0, 6), vr: r(-0.3, 0.3), color: pick(COLORS) });
    }
  }
  // Petite pluie d'emojis qui tombe doucement sur tout l'écran
  function rain(list, n) {
    n = Math.round((n || 12) * RM);
    for (let i = 0; i < n; i++) {
      setTimeout(() => spawn({ x: r(20, W - 20), y: r(-50, -10), vx: r(-0.5, 0.5), vy: r(1.5, 3), g: 0.02, drag: 1, life: 170, size: r(26, 40), rot: r(-0.4, 0.4), vr: r(-0.03, 0.03), emoji: pick(list) }), i * 90);
    }
  }
  function snow(x, y) {
    burst(x, y, { n: 6, speed: 6, g: 0.03, emoji: '❄️' });
    burst(x, y, { n: 20, speed: 4, g: 0.05, colors: ['#bfeaff', '#fff', '#7fd0ff'], round: true });
  }
  function coins(x, y) { burst(x, y, { n: 16, speed: 6, g: 0.25, emoji: '🪙' }); }

  function flash(color) {
    const f = document.getElementById('flash');
    f.style.background = color;
    if (f.animate) f.animate([{ opacity: 0.8 }, { opacity: 0 }], { duration: 650, easing: 'ease-out' });
  }
  function banner(txt, color, ms) {
    const b = document.getElementById('banner');
    b.textContent = txt; b.style.color = color || '#ffd426';
    if (b.animate) b.animate([
      { transform: 'scale(.2) rotate(-8deg)', opacity: 0 },
      { transform: 'scale(1.15) rotate(-3deg)', opacity: 1, offset: 0.22 },
      { transform: 'scale(1) rotate(-3deg)', opacity: 1, offset: 0.8 },
      { transform: 'scale(1.5) rotate(-3deg)', opacity: 0 }
    ], { duration: ms || 1300, easing: 'ease-out' });
  }
  function shake() {
    const a = document.getElementById('app');
    if (a.animate && RM === 1) a.animate([
      { transform: 'translate(0,0)' }, { transform: 'translate(-12px,6px)' }, { transform: 'translate(10px,-8px)' },
      { transform: 'translate(-8px,-5px)' }, { transform: 'translate(6px,5px)' }, { transform: 'translate(0,0)' }
    ], { duration: 480 });
  }
  function float(text, x, y, color) {
    const d = document.createElement('div');
    d.className = 'float'; d.textContent = text;
    if (color) d.style.color = color;
    d.style.left = x + 'px'; d.style.top = y + 'px';
    document.getElementById('floaters').appendChild(d);
    const done = () => d.remove();
    if (d.animate) d.animate([
      { transform: 'translate(-50%,0) scale(.6)', opacity: 0 },
      { transform: 'translate(-50%,-20px) scale(1.2)', opacity: 1, offset: 0.2 },
      { transform: 'translate(-50%,-90px) scale(1)', opacity: 0 }
    ], { duration: 1500, easing: 'ease-out' }).onfinish = done;
    else setTimeout(done, 1500);
  }

  return { burst, confetti, rain, snow, coins, flash, banner, shake, float };
})();
