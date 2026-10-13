(() => {
  'use strict';

  // ---------- Config ----------
  const START_PRICE = 100;
  const FIELD_HALF_RANGE = 5;  // price distance from midfield to each goal line
  const BREAK_SECONDS = 1.8;   // huddle between rounds

  const C = {
    bull: '#22c55e', bullDark: '#14532d', bullLight: '#bbf7d0',
    bear: '#ef4444', bearDark: '#7f1d1d', bearLight: '#fecaca',
    gold: '#facc15', text: '#e5e7eb', muted: '#94a3b8',
    grid: 'rgba(148,163,184,0.14)', grassA: '#2e7d32', grassB: '#29702c',
  };

  const $ = (id) => document.getElementById(id);
  const ui = {
    len: $('lenInput'), lenOut: $('lenOut'),
    rounds: $('roundsInput'), roundsOut: $('roundsOut'),
    play: $('playBtn'), reset: $('resetBtn'),
    bullsScore: $('bullsScore'), bearsScore: $('bearsScore'),
    roundLabel: $('roundLabel'), clock: $('clockLabel'), price: $('priceLabel'),
    meterFill: $('meterFill'), commentary: $('commentary'),
    anatomy: $('anatomy'), tooltip: $('tooltip'),
  };

  // ---------- Helpers ----------
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ease = (rate, dt) => 1 - Math.exp(-rate * dt);
  const fmt = (p) => '$' + p.toFixed(2);
  const signed = (d) => (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(2);
  const pct = (d, base) => (d >= 0 ? '+' : '−') + Math.abs((d / base) * 100).toFixed(2) + '%';
  const gauss = () => {
    let u = 0, v = 0;
    while (!u) u = Math.random();
    while (!v) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const setText = (el, text) => { if (el.textContent !== text) el.textContent = text; };

  // ---------- Candle patterns ----------
  const PATTERNS = {
    bullMarubozu: { name: 'Bullish Marubozu', tone: 'bull',
      story: 'The Bulls ran the show from kickoff to the final whistle. Price opened near the low and closed near the high, and the wicks are tiny because the Bears never got anywhere.' },
    bearMarubozu: { name: 'Bearish Marubozu', tone: 'bear',
      story: 'The Bears ran the show from kickoff to the final whistle. Price opened near the high and closed near the low, and the wicks are tiny because the Bulls never got anywhere.' },
    bullish: { name: 'Bullish Candle', tone: 'bull',
      story: 'The buyers won this round because the close finished above the open. The wicks show where each side briefly pushed before getting stopped.' },
    bearish: { name: 'Bearish Candle', tone: 'bear',
      story: 'The sellers won this round because the close finished below the open. The wicks show where each side briefly pushed before getting stopped.' },
    hammer: { name: 'Hammer', tone: 'bull',
      story: 'The Bears drove price way down, but the Bulls fought all the way back. The long lower wick is ground the Bears took and then lost, so the market rejected the lower prices.' },
    star: { name: 'Shooting Star', tone: 'bear',
      story: 'The Bulls charged far ahead, but the Bears shoved them back before the whistle. The long upper wick marks higher prices the buyers could not hold.' },
    doji: { name: 'Doji', tone: 'neutral',
      story: 'A stalemate. Both teams gained ground at times, but the round ended right where it started, with the close about equal to the open. That is indecision.' },
    dragonfly: { name: 'Dragonfly Doji', tone: 'bull',
      story: 'The Bears pushed deep into Bull territory, then the Bulls dragged price all the way back to the open. The market strongly rejected the lower prices.' },
    gravestone: { name: 'Gravestone Doji', tone: 'bear',
      story: 'The Bulls pushed deep into Bear territory, then the Bears dragged price all the way back to the open. The market strongly rejected the higher prices.' },
    spinning: { name: 'Spinning Top', tone: 'neutral',
      story: 'A small body with wicks on both sides means each team had its moment, but neither one won by much.' },
  };

  function classify(c, prev) {
    const body = Math.abs(c.c - c.o);
    const range = Math.max(c.h - c.l, 1e-9);
    const upper = c.h - Math.max(c.o, c.c);
    const lower = Math.min(c.o, c.c) - c.l;
    const up = c.c >= c.o;
    let key;
    if (body <= range * 0.1) {
      key = lower >= range * 0.7 ? 'dragonfly' : upper >= range * 0.7 ? 'gravestone' : 'doji';
    } else if (lower >= body * 2 && upper <= body * 0.6) key = 'hammer';
    else if (upper >= body * 2 && lower <= body * 0.6) key = 'star';
    else if (body >= range * 0.8) key = up ? 'bullMarubozu' : 'bearMarubozu';
    else if (body <= range * 0.35) key = 'spinning';
    else key = up ? 'bullish' : 'bearish';

    // Two-candle pattern: this body swallows the previous opposite-colored body.
    let engulfing = null;
    if (prev && body > Math.abs(prev.c - prev.o)) {
      const prevUp = prev.c >= prev.o;
      if (up && !prevUp && c.o <= prev.c && c.c >= prev.o) engulfing = 'bull';
      if (!up && prevUp && c.o >= prev.c && c.c <= prev.o) engulfing = 'bear';
    }
    return { key, ...PATTERNS[key], engulfing, body, upper, lower, range };
  }

  // ---------- Round scripts ----------
  // Each scenario is a rough path (time fraction → move in units of the round's amplitude).
  // Noise is layered on top, and the real candle is classified from what actually happened.
  const SCENARIOS = [
    [[0, 0], [0.25, 0.35], [0.6, 0.7], [1, 1]],                      // bull drive
    [[0, 0], [0.25, -0.35], [0.6, -0.7], [1, -1]],                   // bear drive
    [[0, 0], [0.15, 0.08], [0.45, -1], [0.65, -0.6], [1, 0.2]],      // hammer
    [[0, 0], [0.15, -0.08], [0.45, 1], [0.65, 0.6], [1, -0.2]],      // shooting star
    [[0, 0], [0.25, 0.6], [0.55, -0.6], [0.8, 0.25], [1, 0]],        // doji
    [[0, 0], [0.3, -0.6], [0.6, 0.65], [1, 0.2]],                    // spinning top
    [[0, 0], [0.5, 1], [1, 0.45]],                                   // bulls fade
    [[0, 0], [0.5, -1], [1, -0.45]],                                 // bears fade
    null,                                                            // random brawl
  ];

  function makeScript() {
    const base = SCENARIOS[Math.floor(Math.random() * SCENARIOS.length)];
    if (!base) {
      const n = 3 + Math.floor(Math.random() * 3);
      const pts = [[0, 0]];
      for (let i = 1; i <= n; i++) pts.push([i / n, rand(-1, 1)]);
      return pts;
    }
    return base.map(([t, v], i) => [t, i === 0 ? 0 : v + rand(-0.12, 0.12)]);
  }

  function pathAt(pts, f) {
    for (let i = 1; i < pts.length; i++) {
      if (f <= pts[i][0]) {
        const [t0, v0] = pts[i - 1];
        const [t1, v1] = pts[i];
        const u = (f - t0) / (t1 - t0 || 1);
        return v0 + (v1 - v0) * (1 - Math.cos(Math.PI * u)) / 2;
      }
    }
    return pts[pts.length - 1][1];
  }

  // ---------- Game state ----------
  const game = {
    phase: 'idle',       // idle | playing | break | paused | done
    resumePhase: null,
    totalRounds: +ui.rounds.value,
    roundLen: +ui.len.value,
    round: 0,
    t: 0,
    breakT: 0,
    price: START_PRICE,
    cam: START_PRICE,
    candles: [],
    live: null,
    script: null,
    amp: 1,
    noise: 0,
    pressure: 0,
    sep: 1,             // how far the teams stand apart (1 = lined up, 0 = engaged)
    anim: 0,
    view: { lo: START_PRICE - 3, hi: START_PRICE + 3 },
    hover: null,
    bulls: 0,
    bears: 0,
  };
  let particles = [];

  const allCandles = () => (game.live ? [...game.candles, game.live] : game.candles);
  const isActive = () => ['playing', 'break', 'paused'].includes(game.phase);

  function resetGame() {
    Object.assign(game, {
      phase: 'idle', resumePhase: null, round: 0, t: 0, breakT: 0,
      price: START_PRICE, cam: START_PRICE, candles: [], live: null,
      pressure: 0, noise: 0, bulls: 0, bears: 0, hover: null,
      totalRounds: +ui.rounds.value, roundLen: +ui.len.value,
    });
    particles = [];
    setCommentary('Press <b>Play!</b> to kick off.');
    syncControls();
  }

  function startGame() {
    resetGame();
    startRound();
  }

  function startRound() {
    game.round += 1;
    game.t = 0;
    game.noise = 0;
    game.script = makeScript();
    game.amp = rand(1.2, 2.6);
    game.live = { o: game.price, h: game.price, l: game.price, c: game.price, round: game.round };
    game.phase = 'playing';
    syncControls();
  }

  function finishRound() {
    const c = game.live;
    c.c = game.price;
    const prev = game.candles[game.candles.length - 1];
    c.pattern = classify(c, prev);
    game.candles.push(c);
    game.live = null;
    if (c.c > c.o) game.bulls += 1;
    else if (c.c < c.o) game.bears += 1;

    if (game.round >= game.totalRounds) {
      game.phase = 'done';
      announceFinal();
    } else {
      game.phase = 'break';
      game.breakT = 0;
      const p = c.pattern;
      setCommentary(`<b>End of round ${c.round}: ${p.name}.</b> ${winnerLine(c)} Teams huddle…`);
    }
    syncControls();
  }

  function winnerLine(c) {
    if (c.c > c.o) return `Bulls win the round (${signed(c.c - c.o)}).`;
    if (c.c < c.o) return `Bears win the round (${signed(c.c - c.o)}).`;
    return 'Dead even.';
  }

  function announceFinal() {
    const first = game.candles[0].o;
    const d = game.price - first;
    const verdict = game.bulls > game.bears ? `<b>Bulls win ${game.bulls}–${game.bears}!</b>`
      : game.bears > game.bulls ? `<b>Bears win ${game.bears}–${game.bulls}!</b>`
      : `<b>It's a tie, ${game.bulls}–${game.bears}.</b>`;
    const twist = (game.bulls > game.bears && d < 0) || (game.bears > game.bulls && d > 0)
      ? ` Notice that the ${d < 0 ? 'Bears' : 'Bulls'} lost more rounds but gained more ground overall, because a few big wins can outweigh many small ones.`
      : '';
    setCommentary(`Final whistle! ${verdict} Price went from ${fmt(first)} to ${fmt(game.price)} (${pct(d, first)}).${twist} ` +
      'Hover any candle to replay what happened in that round.');
  }

  // ---------- Simulation ----------
  function update(dt) {
    if (game.phase === 'paused') return;
    game.anim += dt;

    if (game.phase === 'playing') {
      game.t = Math.min(game.t + dt, game.roundLen);
      const f = game.t / game.roundLen;
      const A = game.amp;
      // Ornstein–Uhlenbeck noise: random shoves that drift back toward the script.
      game.noise += -game.noise * 1.2 * dt + 0.22 * A * Math.sqrt(dt) * gauss();
      const target = game.live.o + A * pathAt(game.script, f) + game.noise * Math.min(1, f * 6);
      const prev = game.price;
      game.price += (target - game.price) * ease(6, dt);
      const lim = FIELD_HALF_RANGE - 0.15;
      game.price = clamp(game.price, game.live.o - lim, game.live.o + lim);

      const c = game.live;
      c.c = game.price;
      c.h = Math.max(c.h, game.price);
      c.l = Math.min(c.l, game.price);

      const vel = dt > 0 ? (game.price - prev) / dt : 0;
      const pTarget = clamp(vel / ((3 * A) / game.roundLen), -1, 1);
      game.pressure += (pTarget - game.pressure) * ease(5, dt);

      updateCommentaryLive();
      if (game.t >= game.roundLen) finishRound();
    } else {
      game.pressure += (0 - game.pressure) * ease(4, dt);
      if (game.phase === 'break') {
        game.breakT += dt;
        if (game.breakT >= BREAK_SECONDS) startRound();
      }
    }

    // Camera follows the line of scrimmage between rounds, stays put during a play.
    const camTarget = game.live ? game.live.o : game.price;
    game.cam += (camTarget - game.cam) * ease(3, dt);
    game.sep += ((game.phase === 'playing' ? 0 : 1) - game.sep) * ease(5, dt);

    // Chart y-range eases toward the data so it doesn't jitter.
    const all = allCandles();
    let lo = game.price, hi = game.price;
    for (const c of all) { lo = Math.min(lo, c.l); hi = Math.max(hi, c.h); }
    const span = Math.max(hi - lo, 3) * 1.18;
    const mid = (hi + lo) / 2;
    game.view.lo += (mid - span / 2 - game.view.lo) * ease(5, dt);
    game.view.hi += (mid + span / 2 - game.view.hi) * ease(5, dt);

    updateParticles(dt);
  }

  // ---------- Commentary / HUD ----------
  let lastCommentary = '';
  function setCommentary(html) {
    if (html !== lastCommentary) { ui.commentary.innerHTML = html; lastCommentary = html; }
  }

  function updateCommentaryLive() {
    const p = game.pressure;
    const c = game.live;
    let line;
    if (p > 0.45) line = '<b style="color:var(--bull)">Bulls are charging!</b> Buyers are lifting the price.';
    else if (p < -0.45) line = '<b style="color:var(--bear)">Bears are shoving back!</b> Sellers are knocking the price down.';
    else if (p > 0.15) line = 'Bulls inching forward. There is a little more buying than selling.';
    else if (p < -0.15) line = 'Bears grinding ahead. There is a little more selling than buying.';
    else line = 'Stalemate at the line, and neither side is giving ground.';
    const diff = c.c - c.o;
    const sofar = Math.abs(diff) < 0.02 ? 'Price is right at the open, so the candle is flat so far.'
      : diff > 0 ? `Price is <b>above</b> the open (${signed(diff)}), so the candle is green so far.`
      : `Price is <b>below</b> the open (${signed(diff)}), so the candle is red so far.`;
    setCommentary(`${line} ${sofar}`);
  }

  function syncControls() {
    const active = isActive();
    ui.len.disabled = active;
    ui.rounds.disabled = active;
    ui.play.textContent = game.phase === 'paused' ? 'Resume'
      : active ? 'Pause'
      : game.phase === 'done' ? 'Play again!' : 'Play!';
  }

  function updateHUD() {
    setText(ui.bullsScore, String(game.bulls));
    setText(ui.bearsScore, String(game.bears));
    setText(ui.roundLabel, `Round ${game.round} / ${game.totalRounds}`);
    let clock;
    if (game.phase === 'playing' || (game.phase === 'paused' && game.resumePhase === 'playing')) {
      const s = Math.ceil(game.roundLen - game.t - 1e-6);
      clock = `0:${String(Math.max(s, 0)).padStart(2, '0')}`;
    } else if (game.phase === 'paused') clock = 'PAUSED';
    else if (game.phase === 'break') clock = 'HUDDLE';
    else if (game.phase === 'done') clock = 'FINAL';
    else clock = `0:${String(game.roundLen).padStart(2, '0')}`;
    if (game.phase === 'paused' && game.resumePhase === 'playing') clock += ' ❚❚';
    setText(ui.clock, clock);
    setText(ui.price, fmt(game.price));

    const p = game.pressure;
    const w = Math.abs(p) * 50;
    ui.meterFill.style.width = w + '%';
    ui.meterFill.style.left = (p >= 0 ? 50 : 50 - w) + '%';
    ui.meterFill.style.background = p >= 0 ? C.bull : C.bear;
  }

  // ---------- Canvas setup ----------
  function makeSurface(canvas) {
    const s = { canvas, ctx: canvas.getContext('2d'), w: 0, h: 0 };
    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      const r = canvas.getBoundingClientRect();
      s.w = r.width; s.h = r.height;
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      s.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    new ResizeObserver(fit).observe(canvas);
    fit();
    return s;
  }
  const field = makeSurface($('field'));
  const chart = makeSurface($('chart'));

  // ---------- Field drawing ----------
  // The field is vertical: higher prices are up. Bears defend the top end zone and push down;
  // Bulls defend the bottom end zone and push up. An upright candle beside the field uses
  // the exact same price scale, so its wick lines up with the HIGH / LOW flags.
  function updateParticles(dt) {
    for (const p of particles) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
    }
    particles = particles.filter((p) => p.life > 0);
  }

  function drawField() {
    const { ctx, w, h } = field;
    if (!w || !h) return;
    ctx.clearRect(0, 0, w, h);

    // Horizontal layout: [field | candle gutter], centered.
    const gutter = 84;
    const fieldW = clamp(Math.min(w - gutter - 12, h * 0.72), 150, 520);
    const x0 = Math.max(4, (w - fieldW - gutter) / 2);
    const x1 = x0 + fieldW;
    const labelBand = 44;                 // price labels down the left edge of the field
    const PL = x0 + labelBand, PR = x1;   // play area, horizontally
    const pcx = (PL + PR) / 2;
    const candleX = x1 + gutter / 2;

    // Vertical layout: Bears end zone on top, Bulls end zone on the bottom.
    const ez = clamp(h * 0.07, 26, 44);
    const T = ez, B = h - ez, FH = B - T;
    const lo = game.cam - FIELD_HALF_RANGE, hi = game.cam + FIELD_HALF_RANGE;
    const py = (p) => B - ((p - lo) / (hi - lo)) * FH;
    const cpy = (p) => clamp(py(p), T, B);

    // Grass stripes, one per $1, so they scroll with the camera.
    for (let p = Math.floor(lo); p < hi; p++) {
      const yTop = Math.max(T, py(p + 1)), yBot = Math.min(B, py(p));
      if (yBot <= yTop) continue;
      ctx.fillStyle = (Math.abs(p) % 2 === 0) ? C.grassA : C.grassB;
      ctx.fillRect(x0, yTop, fieldW, yBot - yTop);
    }

    // End zones
    const ezFont = `800 ${clamp(ez * 0.5, 12, 20)}px system-ui, sans-serif`;
    ctx.fillStyle = C.bearDark; ctx.fillRect(x0, 0, fieldW, T);
    ctx.fillStyle = C.bullDark; ctx.fillRect(x0, B, fieldW, h - B);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = ezFont; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('BEARS', x0 + fieldW / 2, T / 2);
    ctx.fillText('BULLS', x0 + fieldW / 2, B + (h - B) / 2);

    // Yard lines ($1 apart) and hash marks ($0.20 apart)
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let p = Math.ceil(lo); p <= hi; p++) {
      const y = py(p);
      ctx.moveTo(PL, y); ctx.lineTo(PR, y);
    }
    ctx.moveTo(x0, T); ctx.lineTo(x1, T);
    ctx.moveTo(x0, B); ctx.lineTo(x1, B);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath();
    const pw = PR - PL;
    const hashXs = [PL + 4, PL + pw * 0.33, PL + pw * 0.67, PR - 10];
    for (let k = Math.ceil(lo * 5); k <= hi * 5; k++) {
      if (k % 5 === 0) continue;
      const y = py(k / 5);
      for (const x of hashXs) { ctx.moveTo(x, y); ctx.lineTo(x + 6, y); }
    }
    ctx.stroke();

    // Price labels down the left edge
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x0, T, labelBand, FH);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = '600 11px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let p = Math.ceil(lo); p <= hi; p++) {
      const y = py(p);
      if (y < T + 10 || y > B - 10) continue;
      ctx.fillText('$' + p, x0 + labelBand / 2, y);
    }

    // Direction hints
    ctx.font = '600 10px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.textAlign = 'right';
    ctx.fillText('▲ higher prices', PR - 6, T + 12);
    ctx.fillText('▼ lower prices', PR - 6, B - 12);

    const r = clamp(Math.min(pw * 0.042, FH * 0.03), 6, 13);
    const gap = r * 2.55;

    // Round markers: the current (or just-finished) candle drawn onto the field.
    const cur = game.live || (game.phase !== 'idle' ? game.candles[game.candles.length - 1] : null);
    if (cur) {
      const yo = cpy(cur.o), yh = cpy(cur.h), yl = cpy(cur.l), yc = cpy(cur.c);
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fillRect(PL, yh, pw, yl - yh);

      // Guide lines run from the field across to the candle.
      ctx.setLineDash([2, 4]); ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(229,231,235,0.35)';
      ctx.beginPath();
      for (const y of [yh, yl]) { ctx.moveTo(PR, y); ctx.lineTo(candleX - 12, y); }
      ctx.stroke();
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = C.gold; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(PL, yo); ctx.lineTo(candleX - 12, yo); ctx.stroke();
      ctx.setLineDash([]);
      drawFlag(ctx, PR - 26, yo, 'OPEN', C.gold, '#221a00');
      if (yo - yh > 2) drawFlag(ctx, PR - 70, yh, 'HIGH', C.bull, '#04210f');
      if (yl - yo > 2) drawFlag(ctx, PR - 70, yl, 'LOW', C.bear, '#2a0606');

      // Upright candle in the gutter, on the same price scale as the field.
      ctx.fillStyle = 'rgba(229,231,235,0.75)';
      ctx.font = '700 9px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('THIS ROUND', candleX, T - 18);
      ctx.fillText('AS A CANDLE', candleX, T - 7);
      const up = cur.c >= cur.o;
      const col = up ? C.bull : C.bear;
      ctx.strokeStyle = col; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(candleX, yh); ctx.lineTo(candleX, yl); ctx.stroke();
      const by0 = Math.min(yo, yc), bh = Math.max(Math.abs(yc - yo), 2);
      ctx.fillStyle = col;
      ctx.fillRect(candleX - 11, by0, 22, bh);
      if (cur === game.live) {
        ctx.fillStyle = C.gold;
        ctx.beginPath(); ctx.arc(candleX + 18, yc, 3, 0, Math.PI * 2); ctx.fill();
      }
    }

    // The scrum: Bulls below the ball pushing up, Bears above pushing down.
    const by = clamp(py(game.price), T + r * 2, B - r * 2);
    const p = game.pressure;
    const sep = game.sep * r * 1.6;
    const rows = [{ d: 1.15, n: 5 }, { d: 3.55, n: 4 }, { d: 6.1, n: 2 }];
    const players = [];
    for (const side of [1, -1]) {           // +1 = Bulls (below the ball), -1 = Bears (above)
      const winning = side === 1 ? Math.max(p, 0) : Math.max(-p, 0);
      const losing = side === 1 ? Math.max(-p, 0) : Math.max(p, 0);
      const squeeze = 1 - 0.18 * winning + 0.22 * losing;
      rows.forEach((row, ri) => {
        for (let i = 0; i < row.n; i++) {
          const id = (side + 2) * 20 + ri * 5 + i;
          const wob = 0.25 + Math.abs(p);
          const x = pcx + (i - (row.n - 1) / 2) * gap * (ri === 0 ? 1 : 1.15)
            + Math.cos(game.anim * 7 + id) * r * 0.1 * wob;
          const y = by + side * (row.d * r * (ri === 0 ? 1 : squeeze) + sep)
            + Math.sin(game.anim * 9 + id * 1.7) * r * 0.14 * wob;
          players.push({ x, y, side });
        }
      });
    }
    players.sort((a, b) => a.y - b.y);
    for (const pl of players) (pl.side === 1 ? drawBull : drawBear)(ctx, pl.x, pl.y, r, -pl.side);

    // Dust kicked up at the line (drifts away from the direction of the push)
    if (game.phase === 'playing' && Math.abs(p) > 0.25 && Math.random() < Math.abs(p) * 0.9) {
      particles.push({
        x: pcx + rand(-2.5, 2.5) * gap, y: by + rand(-r, r),
        vx: rand(-15, 15), vy: Math.sign(p) * rand(20, 60), life: 0.7, max: 0.7, s: rand(1.5, 3.5),
      });
    }
    for (const d of particles) {
      ctx.fillStyle = `rgba(222,200,160,${(d.life / d.max) * 0.6})`;
      ctx.beginPath(); ctx.arc(d.x, d.y, d.s, 0, Math.PI * 2); ctx.fill();
    }

    // Ball (= price), pointing up the field
    ctx.save();
    ctx.translate(pcx, by);
    ctx.fillStyle = '#8b4513';
    ctx.strokeStyle = '#3b1d06'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(0, 0, r * 0.52, r * 0.85, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(0, -r * 0.35); ctx.lineTo(0, r * 0.35);
    for (let k = -2; k <= 2; k++) { ctx.moveTo(-r * 0.13, k * r * 0.14); ctx.lineTo(r * 0.13, k * r * 0.14); }
    ctx.stroke();
    ctx.restore();

    // Push arrow beside the pile
    if (Math.abs(p) > 0.08 && game.phase !== 'idle') {
      const ax = Math.max(PL + 10, pcx - gap * 2.6 - r * 1.4);
      const len = -p * FH * 0.16;     // negative = up
      const col = p > 0 ? C.bull : C.bear;
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(ax, by); ctx.lineTo(ax, by + len); ctx.stroke();
      const dir = Math.sign(len);
      ctx.beginPath();
      ctx.moveTo(ax, by + len + dir * 10);
      ctx.lineTo(ax - 8, by + len - dir * 2);
      ctx.lineTo(ax + 8, by + len - dir * 2);
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1; ctx.lineCap = 'butt';
    }

    // Live price tag on the price axis, like a chart's last-price marker
    const tagY = clamp(py(game.price), T + 9, B - 9);
    ctx.font = '700 11px ui-monospace, Menlo, monospace';
    const tag = game.price.toFixed(2);
    ctx.fillStyle = '#04060c';
    roundRect(ctx, x0 + 1, tagY - 9, labelBand - 2, 18, 4); ctx.fill();
    ctx.strokeStyle = C.gold; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(tag, x0 + labelBand / 2, tagY);
  }

  function drawFlag(ctx, x, y, text, bg, fg) {
    ctx.font = '700 10px system-ui, sans-serif';
    const tw = ctx.measureText(text).width + 10;
    ctx.fillStyle = bg;
    roundRect(ctx, x - tw / 2, y - 8, tw, 16, 4); ctx.fill();
    ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + 0.5);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Players are drawn top-down; `face` is -1 to look up the field, +1 to look down it.
  function drawBull(ctx, x, y, r, face) {
    // horns sweep forward, toward the opponent
    ctx.strokeStyle = '#f5f0dc'; ctx.lineWidth = r * 0.24; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - r * 0.6, y + face * r * 0.5); ctx.quadraticCurveTo(x - r * 1.3, y + face * r * 0.6, x - r * 1.05, y + face * r * 1.3);
    ctx.moveTo(x + r * 0.6, y + face * r * 0.5); ctx.quadraticCurveTo(x + r * 1.3, y + face * r * 0.6, x + r * 1.05, y + face * r * 1.3);
    ctx.stroke(); ctx.lineCap = 'butt';
    // head
    ctx.fillStyle = C.bull; ctx.strokeStyle = C.bullDark; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // snout + eyes, facing the opponent
    ctx.fillStyle = C.bullLight;
    ctx.beginPath(); ctx.ellipse(x, y + face * r * 0.45, r * 0.42, r * 0.3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#0b1a10';
    ctx.beginPath();
    ctx.arc(x - r * 0.32, y + face * r * 0.02, r * 0.12, 0, Math.PI * 2);
    ctx.arc(x + r * 0.32, y + face * r * 0.02, r * 0.12, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawBear(ctx, x, y, r, face) {
    // ears on the back of the head
    ctx.fillStyle = C.bear; ctx.strokeStyle = C.bearDark; ctx.lineWidth = 1.5;
    for (const ex of [-0.65, 0.65]) {
      ctx.beginPath(); ctx.arc(x + ex * r, y - face * r * 0.72, r * 0.36, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    // head
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // snout + eyes + nose, facing the opponent
    ctx.fillStyle = C.bearLight;
    ctx.beginPath(); ctx.ellipse(x, y + face * r * 0.42, r * 0.4, r * 0.3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1f0606';
    ctx.beginPath();
    ctx.arc(x - r * 0.32, y + face * r * 0.0, r * 0.12, 0, Math.PI * 2);
    ctx.arc(x + r * 0.32, y + face * r * 0.0, r * 0.12, 0, Math.PI * 2);
    ctx.arc(x, y + face * r * 0.55, r * 0.1, 0, Math.PI * 2);
    ctx.fill();
  }

  // ---------- Chart drawing ----------
  const chartGeom = { padL: 12, padR: 66, padT: 18, padB: 30, slotW: 1 };

  function niceStep(raw) {
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / mag;
    return (n < 1.5 ? 1 : n < 3.5 ? 2.5 : n < 7.5 ? 5 : 10) * mag;
  }

  function focusIndex() {
    const all = allCandles();
    if (game.hover != null && all[game.hover]) return game.hover;
    return all.length ? all.length - 1 : null;
  }

  function drawChart(time) {
    const { ctx, w, h } = chart;
    if (!w || !h) return;
    ctx.clearRect(0, 0, w, h);
    const { padL, padR, padT, padB } = chartGeom;
    const pw = w - padL - padR, ph = h - padT - padB;
    const { lo, hi } = game.view;
    const y = (p) => padT + ((hi - p) / (hi - lo)) * ph;

    // Grid + price axis
    const step = niceStep((hi - lo) / 5);
    ctx.font = '11px ui-monospace, Menlo, monospace';
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    for (let p = Math.ceil(lo / step) * step; p <= hi; p += step) {
      const yy = Math.round(y(p)) + 0.5;
      ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(w - padR, yy); ctx.stroke();
      ctx.fillStyle = C.muted;
      ctx.fillText(fmt(p), w - padR + 8, yy);
    }

    const n = game.totalRounds;
    const slotW = pw / n;
    chartGeom.slotW = slotW;
    const cx = (i) => padL + slotW * (i + 0.5);
    const bw = clamp(slotW * 0.5, 6, 40);
    const all = allCandles();
    const focus = focusIndex();

    // Round labels
    ctx.textAlign = 'center'; ctx.font = '600 11px system-ui, sans-serif';
    for (let i = 0; i < n; i++) {
      const c = all[i];
      ctx.fillStyle = !c ? 'rgba(148,163,184,0.45)' : c === game.live ? C.gold : c.c >= c.o ? C.bull : C.bear;
      ctx.fillText('R' + (i + 1), cx(i), h - padB / 2);
    }

    if (focus != null) {
      ctx.fillStyle = 'rgba(148,163,184,0.08)';
      ctx.fillRect(padL + slotW * focus, padT - 8, slotW, ph + 16);
    }

    if (!all.length) {
      ctx.fillStyle = C.muted; ctx.font = '13px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('Each round becomes one candle here.', padL + pw / 2, padT + ph / 2 - 10);
      ctx.fillText('Press Play! to start.', padL + pw / 2, padT + ph / 2 + 10);
    }

    // Candles
    all.forEach((c, i) => {
      const up = c.c >= c.o;
      const col = up ? C.bull : C.bear;
      const x = cx(i);
      ctx.strokeStyle = col; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, y(c.h)); ctx.lineTo(x, y(c.l)); ctx.stroke();
      const top = y(Math.max(c.o, c.c)), bot = y(Math.min(c.o, c.c));
      const bh = Math.max(bot - top, 2);
      ctx.fillStyle = col;
      ctx.fillRect(x - bw / 2, top, bw, bh);
      if (c === game.live) {
        ctx.strokeStyle = `rgba(250,204,21,${0.5 + 0.4 * Math.sin(time * 5)})`;
        ctx.lineWidth = 2;
        ctx.strokeRect(x - bw / 2 - 3, y(c.h) - 3, bw + 6, y(c.l) - y(c.h) + 6);
      }
    });

    // Current price line
    if (game.phase !== 'idle') {
      const ref = game.live || all[all.length - 1];
      const col = ref && ref.c < ref.o ? C.bear : C.bull;
      const yy = y(game.price);
      ctx.setLineDash([4, 4]); ctx.strokeStyle = col; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(w - padR, yy); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = col;
      roundRect(ctx, w - padR + 2, yy - 9, padR - 4, 18, 4); ctx.fill();
      ctx.fillStyle = '#04060c'; ctx.font = '700 11px ui-monospace, Menlo, monospace';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(fmt(game.price), w - padR + 6, yy);
    }

    // OHLC callouts on the focused candle
    if (focus != null) {
      const c = all[focus];
      const up = c.c >= c.o;
      const items = [
        { p: c.h, t: 'High' },
        { p: up ? c.c : c.o, t: up ? 'Close' : 'Open' },
        { p: up ? c.o : c.c, t: up ? 'Open' : 'Close' },
        { p: c.l, t: 'Low' },
      ].map((it) => ({ ...it, y0: y(it.p), y: y(it.p) }));
      for (let i = 1; i < items.length; i++) items[i].y = Math.max(items[i].y, items[i - 1].y + 14);
      const x = cx(focus);
      const rightSide = x + bw / 2 + 56 < w - padR;
      const lx = rightSide ? x + bw / 2 + 12 : x - bw / 2 - 12;
      ctx.font = '600 10px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = rightSide ? 'left' : 'right';
      for (const it of items) {
        ctx.strokeStyle = 'rgba(229,231,235,0.5)'; ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(rightSide ? x + bw / 2 + 2 : x - bw / 2 - 2, it.y0);
        ctx.lineTo(rightSide ? lx - 3 : lx + 3, it.y);
        ctx.stroke();
        const tw = ctx.measureText(it.t).width + 8;
        ctx.fillStyle = 'rgba(4,6,12,0.85)';
        roundRect(ctx, rightSide ? lx - 2 : lx - tw + 2, it.y - 7, tw, 14, 3); ctx.fill();
        ctx.fillStyle = it.t === 'High' ? C.bull : it.t === 'Low' ? C.bear : C.text;
        ctx.fillText(it.t, rightSide ? lx + 2 : lx - 2, it.y);
      }
    }
  }

  // ---------- Anatomy card ----------
  let lastAnatomyAt = -1, lastAnatomyKey = '';
  function updateAnatomy(now) {
    const idx = focusIndex();
    const all = allCandles();
    const c = idx != null ? all[idx] : null;
    const isLive = c && c === game.live;
    const key = c ? `${idx}|${isLive}` : 'none';
    if (key === lastAnatomyKey && (!isLive || now - lastAnatomyAt < 0.12)) return;
    lastAnatomyKey = key; lastAnatomyAt = now;

    if (!c) {
      ui.anatomy.innerHTML = '<h3>Candle anatomy</h3>' +
        '<div class="anat">' + candleSvg({ o: 100.6, h: 101.6, l: 99.0, c: 101.2 }) +
        '<div><p class="story" style="margin-top:0">A candle sums up one round:</p><ul class="facts">' +
        '<li><b>Open</b>: price at kickoff</li><li><b>Close</b>: price at the whistle</li>' +
        '<li><b>High</b>: the furthest the Bulls pushed</li><li><b>Low</b>: the furthest the Bears pushed</li>' +
        '<li><span style="color:var(--bull)">Green</span> if Close &gt; Open, <span style="color:var(--bear)">red</span> if not</li></ul></div></div>';
      return;
    }
    const prev = all[idx - 1];
    const pat = isLive ? classify(c, prev) : c.pattern;
    const tag = isLive ? '<span class="tag live">LIVE · forming</span>' : `<span class="tag">Round ${c.round}</span>`;
    const eng = pat.engulfing
      ? `<span class="tag" style="color:${pat.engulfing === 'bull' ? C.bull : C.bear}" title="This body swallows the previous round's whole body">` +
        `+ ${pat.engulfing === 'bull' ? 'Bullish' : 'Bearish'} Engulfing</span>`
      : '';
    const stat = (label, value, note) => `<div><span>${label} <b>${value}</b></span><em>${note}</em></div>`;
    ui.anatomy.innerHTML =
      `<h3>Candle anatomy ${tag} ${eng}</h3>` +
      '<div class="anat">' + candleSvg(c) + '<div>' +
      `<div class="pattern-name ${pat.tone}">${isLive ? 'So far: ' : ''}${pat.name}</div>` +
      `<p class="story">${pat.story}</p>` +
      '<div class="stats">' +
      stat('Body', Math.abs(c.c - c.o).toFixed(2), `${c.c >= c.o ? 'Bulls' : 'Bears'} won by`) +
      stat('Upper wick', pat.upper.toFixed(2), 'Bull push that failed') +
      stat('Lower wick', pat.lower.toFixed(2), 'Bear push that failed') +
      '</div></div></div>';
  }

  function candleSvg(c) {
    const W = 150, H = 180, top = 8, bot = 172, cx = 24, bw = 24;
    const range = Math.max(c.h - c.l, 1e-6);
    const y = (p) => top + ((c.h - p) / range) * (bot - top);
    const up = c.c >= c.o;
    const col = up ? C.bull : C.bear;
    const bTop = y(Math.max(c.o, c.c)), bBot = y(Math.min(c.o, c.c));
    const labels = [
      { y0: y(c.h), t: `High ${fmt(c.h)}`, col: C.bull },
      { y0: bTop, t: `${up ? 'Close' : 'Open'} ${fmt(Math.max(c.o, c.c))}`, col: C.text },
      { y0: bBot, t: `${up ? 'Open' : 'Close'} ${fmt(Math.min(c.o, c.c))}`, col: C.text },
      { y0: y(c.l), t: `Low ${fmt(c.l)}`, col: C.bear },
    ];
    labels.forEach((l) => { l.y = l.y0; });
    for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + 15);
    const overflow = labels[labels.length - 1].y - bot;
    if (overflow > 0) labels.forEach((l) => { l.y -= overflow; });
    for (let i = labels.length - 2; i >= 0; i--) labels[i].y = Math.min(labels[i].y, labels[i + 1].y - 15);

    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Candle diagram">`;
    s += `<line x1="${cx}" y1="${y(c.h)}" x2="${cx}" y2="${y(c.l)}" stroke="${col}" stroke-width="2"/>`;
    s += `<rect x="${cx - bw / 2}" y="${bTop}" width="${bw}" height="${Math.max(bBot - bTop, 2)}" fill="${col}" rx="2"/>`;
    for (const l of labels) {
      s += `<line x1="${cx + bw / 2 + 2}" y1="${l.y0}" x2="${50}" y2="${l.y}" stroke="#64748b" stroke-width="1"/>`;
      s += `<text x="54" y="${l.y}" dominant-baseline="middle" font-size="11" font-family="ui-monospace, Menlo, monospace" fill="${l.col}">${l.t}</text>`;
    }
    return s + '</svg>';
  }

  // ---------- Hover tooltip ----------
  function showTip(e) {
    const r = chart.canvas.getBoundingClientRect();
    const x = e.clientX - r.left, yPos = e.clientY - r.top;
    const i = Math.floor((x - chartGeom.padL) / chartGeom.slotW);
    const all = allCandles();
    const c = all[i];
    if (!c || x > r.width - chartGeom.padR) { hideTip(); return; }
    game.hover = i;
    const pat = c === game.live ? classify(c, all[i - 1]) : c.pattern;
    const d = c.c - c.o;
    ui.tooltip.innerHTML = `<b style="color:${d >= 0 ? C.bull : C.bear}">Round ${c.round}${c === game.live ? ' (live)' : ''} · ${pat.name}</b>` +
      `<div class="row"><span>Open</span><span>${fmt(c.o)}</span></div>` +
      `<div class="row"><span>High</span><span>${fmt(c.h)}</span></div>` +
      `<div class="row"><span>Low</span><span>${fmt(c.l)}</span></div>` +
      `<div class="row"><span>Close</span><span>${fmt(c.c)}</span></div>` +
      `<div class="row"><span>Change</span><span>${signed(d)} (${pct(d, c.o)})</span></div>` +
      `<p>${pat.story}</p>` +
      (pat.engulfing
        ? `<p><b style="color:${pat.engulfing === 'bull' ? C.bull : C.bear}">+ ${pat.engulfing === 'bull' ? 'Bullish' : 'Bearish'} Engulfing</b>: ` +
          `this body swallows the previous round's whole body, so the ${pat.engulfing === 'bull' ? 'buyers' : 'sellers'} overpowered last round.</p>`
        : '');
    ui.tooltip.hidden = false;
    const tw = ui.tooltip.offsetWidth, th = ui.tooltip.offsetHeight;
    let left = x + 14, topPos = yPos + 14;
    if (left + tw > r.width - 4) left = x - tw - 14;
    if (topPos + th > r.height - 4) topPos = yPos - th - 14;
    ui.tooltip.style.left = Math.max(4, left) + 'px';
    ui.tooltip.style.top = Math.max(4, topPos) + 'px';
  }
  function hideTip() { game.hover = null; ui.tooltip.hidden = true; }
  $('chart').addEventListener('pointermove', showTip);
  $('chart').addEventListener('pointerdown', showTip);   // tap to inspect on touch screens
  $('chart').addEventListener('pointerleave', hideTip);

  // ---------- Controls ----------
  ui.len.addEventListener('input', () => {
    ui.lenOut.textContent = ui.len.value + 's';
    if (!isActive()) game.roundLen = +ui.len.value;
  });
  ui.rounds.addEventListener('input', () => {
    ui.roundsOut.textContent = ui.rounds.value;
    if (!isActive()) {
      if (game.phase === 'done') resetGame();
      game.totalRounds = +ui.rounds.value;
    }
  });
  ui.play.addEventListener('click', () => {
    if (game.phase === 'idle' || game.phase === 'done') startGame();
    else if (game.phase === 'paused') { game.phase = game.resumePhase; game.resumePhase = null; }
    else { game.resumePhase = game.phase; game.phase = 'paused'; }
    syncControls();
  });
  ui.reset.addEventListener('click', resetGame);

  // ---------- Main loop ----------
  let last = performance.now();
  function frame(now) {
    // Sub-step so round timing stays accurate even when frames are slow.
    let remaining = Math.min((now - last) / 1000, 1);
    last = now;
    while (remaining > 0) {
      const dt = Math.min(remaining, 1 / 30);
      update(dt);
      remaining -= dt;
    }
    drawField();
    drawChart(now / 1000);
    updateHUD();
    updateAnatomy(now / 1000);
    requestAnimationFrame(frame);
  }

  ui.lenOut.textContent = ui.len.value + 's';
  ui.roundsOut.textContent = ui.rounds.value;
  resetGame();
  requestAnimationFrame(frame);
})();
