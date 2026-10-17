'use strict';
/* ============================================================
   NEON ORBIT BREAKER
   - パドルが画面の縁を一周する新感覚ブロック崩し
   - Space: バレットタイム(時間減速)
   ============================================================ */

const CANVAS_W = 960;
const CANVAS_H = 680;
const WALL = 12;            // 内側に置く見えない壁の厚み
const PADDLE_H = 14;
const PADDLE_BASE_W = 130;
const PADDLE_MARGIN = 6;    // 縁からの距離
const BALL_R = 7;

const BLOCK = { cols: 12, rows: 6, top: 64, side: 36, w: 68, h: 24, gap: 5 };

// ---------- ユーティリティ ----------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;

// ---------- サウンド ----------
const Sound = {
  on: true, ctx: null,
  ensure() {
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { this.ctx = null; }
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },
  beep(freq, dur, type, vol) {
    if (!this.on || !this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(vol || 0.06, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.ctx.destination);
    o.start(t); o.stop(t + dur + 0.02);
  },
  hit()   { this.beep(rand(300, 360), 0.05, 'square'); },
  brick(f) { this.beep(f || rand(480, 640), 0.08, 'triangle', 0.09); },
  corner() { this.beep(660, 0.09, 'triangle', 0.09); setTimeout(() => this.beep(990, 0.07, 'triangle', 0.07), 40); },
  clang() { this.beep(1245, 0.08, 'square', 0.09); setTimeout(() => this.beep(830, 0.14, 'triangle', 0.1), 38); },
  fanfare() {
    const seq = [523, 659, 784, 1047];
    seq.forEach((f, i) => setTimeout(() => this.beep(f, 0.14, 'square', 0.1), i * 90));
  },
  metal() { this.beep(180, 0.08, 'sawtooth', 0.08); },
  paddle(){ this.beep(240, 0.06, 'square', 0.08); },
  boom()  { this.beep(90, 0.3, 'sawtooth', 0.12); },
  power() { this.beep(660, 0.1, 'sine', 0.1); setTimeout(() => this.beep(990, 0.12, 'sine', 0.1), 90); },
  lose()  { this.beep(140, 0.5, 'sawtooth', 0.12); },
};

// ---------- ゲーム状態 ----------
const G = {
  state: 'title',      // title | serve | play | over
  round: 1,
  score: 0,
  lives: 3,
  chain: 0, chainTimer: 0,
  timeScale: 1,        // バレットタイム用
  energy: 100,         // バレットタイム燃料
  shake: 0, hitstop: 0,
  flash: 0,
  time: 0,
  wideTimer: 0,
};

let paddle = { edge: 'bottom', t: 0.5, w: PADDLE_BASE_W, vx: 0 };
let balls = [];
let blocks = [];
let particles = [];
let drops = [];        // パワーアップ
let floats = [];       // 浮遊テキスト
let starfield = [];
let rings = [];        // 衝撃波リング
let cats = [];         // 謎の猫
let claps = [];        // 👏の雨
let banner = null;     // カオス告知テロップ {text, sub, life}
let aimLines = [];     // 反射時の結果ガイド線
let cornerGlow = [0, 0, 0, 0]; // 四隅反射台の発光

// 四隅の反射台(小さな角度台)
const CORNER_RADIUS = 68; // 有効半径

// ---------- カオスシステム ----------
const Chaos = {
  meter: 0,            // 0..100 満タンでイベント発火(理由は不明)
  active: new Map(),   // kind -> 残り時間(s)
  roulette: null,      // {phase: 'spin'|'result', timer, value, spinTime}
  scoreMult: 1,        // ルーレットによる一時倍率
  flip: 1,             // 酔い演出の向き
};

// ---------- 初期化 ----------
function makeBall(edge, t, speed) {
  const p = paddlePos(edge, t);
  const dir = edgeNormal(edge);
  const ang = Math.atan2(dir.y, dir.x) + rand(-0.5, 0.5);
  return {
    x: p.x, y: p.y,
    vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
    speed: speed, trail: [], stuck: null,
  };
}

function edgeNormal(edge) {
  switch (edge) {
    case 'top':    return { x: 0,  y: 1 };
    case 'bottom': return { x: 0,  y: -1 };
    case 'left':   return { x: 1,  y: 0 };
    case 'right':  return { x: -1, y: 0 };
  }
  return { x: 0, y: -1 };
}

// パドル中心座標(基準点=面の中心)
function paddlePos(edge, t) {
  const m = PADDLE_MARGIN + PADDLE_H / 2;
  switch (edge) {
    case 'top':    return { x: t * CANVAS_W, y: m };
    case 'bottom': return { x: t * CANVAS_W, y: CANVAS_H - m };
    case 'left':   return { x: m, y: t * CANVAS_H };
    case 'right':  return { x: CANVAS_W - m, y: t * CANVAS_H };
  }
  return { x: 0, y: 0 };
}

// ---------- ステージパターン(絵になる配置) ----------
const STAGE_PATTERNS = [
  { name: 'HEART', palette: ['#ff5d8f', '#ff85a2', '#ffd1dc', '#ff4d6d', '#ff85a2', '#ffd1dc'], rows: [
    '..XX....XX..',
    '.XXXX..XXXX.',
    'XXXXXXXXXXXX',
    'XXXXXXXXXXXX',
    '..XXXXXXXX..',
    '....XXXX....',
  ]},
  { name: 'STAR', palette: ['#fff176', '#ffd54f', '#ffb300', '#fff59d', '#ffca28', '#fff176'], rows: [
    '.....XX.....',
    '.....XX.....',
    '..XXXXXXXX..',
    '....XXXX....',
    '....XXXX....',
    '...X.XX.X...',
  ]},
  { name: 'SMILE', palette: ['#6bff8f', '#4fd2ff', '#ffe74c', '#ffb84f', '#b18cff', '#ff5d8f'], rows: [
    '..XX....XX..',
    '.XXXX..XXXX.',
    'XXXXXXXXXXXX',
    'X.X......X.X',
    'XX........XX',
    '.XXXXXXXXX..',
  ]},
  { name: 'MUSHROOM', palette: ['#ff5252', '#ff8a80', '#ffffff', '#ffd54f', '#f5c48c', '#e0b178'], rows: [
    '...XXXXXX...',
    '..XXXXXXXX..',
    '.XXXXXXXXXX.',
    'XXXXXXXXXXXX',
    '....XXXX....',
    '....XXXX....',
  ]},
  { name: 'JEWEL', palette: ['#4fd2ff', '#7df9ff', '#b18cff', '#80deea', '#4fd2ff', '#7df9ff'], rows: [
    '.....XX.....',
    '....XXXX....',
    '...XXXXXX...',
    '..XXXXXXXX..',
    '...XXXXXX...',
    '....XXXX....',
  ]},
  { name: 'CROWN', palette: ['#ffd54f', '#ffb300', '#ffab00', '#ff8f00', '#ffd54f', '#fff59d'], rows: [
    'X..X....X..X',
    'XX.XX..XX.XX',
    'XXXXXXXXXXXX',
    '.XXXXXXXXXX.',
    '..XXXXXXXX..',
    '...XXXXXX...',
  ]},
  { name: 'FORTRESS', palette: ['#b0bec5', '#90a4ae', '#78909c', '#b0bec5', '#90a4ae', '#78909c'], rows: [
    'III......III',
    'II........II',
    '....XXXX....',
    '...XXXXXX...',
    '..XXXXXXXX..',
    '..XX....XX..',
  ]},
];

function buildBlocks() {
  blocks = [];
  const pat = STAGE_PATTERNS[(G.round - 1) % STAGE_PATTERNS.length];
  G.stageName = pat.name;
  const { cols, rows, top, side, w, h, gap } = BLOCK;
  for (let r = 0; r < rows; r++) {
    const line = pat.rows[r] || '';
    for (let c = 0; c < cols; c++) {
      if (c >= line.length || (line[c] !== 'X' && line[c] !== 'I')) continue;
      const x = side + c * (w + gap);
      const y = top + r * (h + gap);
      let type = 'normal', hp = 1;
      const roll = Math.random();
      if (line[c] === 'I') { type = 'indestructible'; }
      else if (r < 2 && roll < 0.22 + G.round * 0.03) { type = 'metal'; hp = 3; }
      else if (roll < 0.10) { type = 'explosive'; }
      else if (r >= 2 && roll > 0.88) { type = 'drifter'; }
      blocks.push({
        x, y, w, h, type, hp,
        maxHp: hp, alive: true,
        phase: rand(0, TAU), flash: 0,
        baseY: y, drift: type === 'drifter' ? rand(10, 22) : 0,
        color: pat.palette[r % pat.palette.length],
      });
    }
  }
}

function startServe() {
  G.state = 'serve';
  balls = [makeBall(paddle.edge, paddle.t, 300)];
  balls[0].stuck = { edge: paddle.edge, t: paddle.t, off: 0 };
}

function startGame() {
  G.round = 1; G.score = 0; G.lives = 3; G.energy = 100; G.chain = 0;
  G.wideTimer = 0; G.fever = 0;
  paddle = { edge: 'bottom', t: 0.5, w: PADDLE_BASE_W, vx: 0 };
  buildBlocks();
  particles = []; drops = []; floats = [];
  rings = []; cats = []; claps = []; banner = null;
  Chaos.meter = 0; Chaos.active.clear(); Chaos.roulette = null; Chaos.scoreMult = 1;
  if (canvas) canvas.style.filter = '';
  startServe();
}

function nextRound() {
  G.round++;
  paddle.w = PADDLE_BASE_W;
  buildBlocks();
  startServe();
}

// ---------- 入力 ----------
const keys = {};
window.addEventListener('keydown', (e) => {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) e.preventDefault();
  keys[e.key.toLowerCase()] = true;
  Sound.ensure();
  if (e.key === 'm' || e.key === 'M') Sound.on = !Sound.on;
  if ((e.key === 'r' || e.key === 'R') && (G.state === 'play' || G.state === 'serve')) startGame();
  if (e.key === ' ' && G.state === 'title') startGame();
});
window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

function pointerAt(cx, cy) {
  const rect = canvas.getBoundingClientRect();
  const x = (cx - rect.left) * (CANVAS_W / rect.width);
  const y = (cy - rect.top) * (CANVAS_H / rect.height);
  // 最寄り辺を決める
  const dTop = y, dBottom = CANVAS_H - y, dLeft = x, dRight = CANVAS_W - x;
  const min = Math.min(dTop, dBottom, dLeft, dRight);
  let edge;
  if (min === dBottom) edge = 'bottom';
  else if (min === dTop) edge = 'top';
  else if (min === dLeft) edge = 'left';
  else edge = 'right';
  paddle.edge = edge;
  if (edge === 'top' || edge === 'bottom') paddle.t = clamp(x / CANVAS_W, 0, 1);
  else paddle.t = clamp(y / CANVAS_H, 0, 1);
}
canvas.addEventListener('pointermove', (e) => pointerAt(e.clientX, e.clientY));
canvas.addEventListener('pointerdown', (e) => {
  Sound.ensure();
  pointerAt(e.clientX, e.clientY);
  if (G.state === 'title') startGame();
  else if (G.state === 'serve' && balls[0] && balls[0].stuck) launchBall(balls[0]);
});

function launchBall(b) {
  const fromEdge = b.stuck ? b.stuck.edge : paddle.edge;
  b.stuck = null;
  G.state = 'play';
  const n = edgeNormal(fromEdge);
  const ang = Math.atan2(n.y, n.x) + rand(-0.4, 0.4);
  b.vx = Math.cos(ang) * b.speed;
  b.vy = Math.sin(ang) * b.speed;
}

// ---------- パドルとボール ----------
function paddleRect() {
  const p = paddlePos(paddle.edge, paddle.t);
  const w = paddle.w, h = PADDLE_H;
  if (paddle.edge === 'top')    return { x: p.x - w / 2, y: p.y - h / 2, w, h, edge: 'top' };
  if (paddle.edge === 'bottom') return { x: p.x - w / 2, y: p.y - h / 2, w, h, edge: 'bottom' };
  if (paddle.edge === 'left')   return { x: p.x - h / 2, y: p.y - w / 2, w: h, h: w, edge: 'left' };
  return { x: p.x - h / 2, y: p.y - w / 2, w: h, h: w, edge: 'right' };
}

function reflectOffPaddle(b) {
  const r = paddleRect();
  const n = edgeNormal(paddle.edge);
  // 打点オフセットによる角度制御(バットの端ほど大きく曲がる)
  let off;
  if (paddle.edge === 'top' || paddle.edge === 'bottom') off = (b.x - (r.x + r.w / 2)) / (r.w / 2);
  else off = (b.y - (r.y + r.h / 2)) / (r.w / 2);
  off = clamp(off, -1, 1);
  const nAng = Math.atan2(n.y, n.x);
  const ang = nAng + off * (Math.PI / 3);
  b.vx = Math.cos(ang) * b.speed;
  b.vy = Math.sin(ang) * b.speed;
  // 面の外へ押し出し
  const p = paddlePos(paddle.edge, paddle.t);
  const safe = PADDLE_MARGIN + PADDLE_H / 2 + BALL_R + 2;
  if (paddle.edge === 'bottom') b.y = CANVAS_H - safe;
  if (paddle.edge === 'top')    b.y = safe;
  if (paddle.edge === 'left')   b.x = safe;
  if (paddle.edge === 'right')  b.x = CANVAS_W - safe;
  // 反射後の飛び方向ガイド
  aimLines.push({ x: b.x, y: b.y, ang, life: 0.5, maxLife: 0.5, guide: false });
  G.chain = 0; // パドルで受けるなどしてコンボリセット
  Sound.paddle();
  addParticles(b.x, b.y, 6, '#7df9ff');
  addRing(b.x, b.y, '#7df9ff', 380);
}

// ---------- 四隅の反射台(どこでも打てる) ----------
function cornerBumper(b, dt) {
  const corners = [
    { x: WALL, y: WALL },
    { x: CANVAS_W - WALL, y: WALL },
    { x: WALL, y: CANVAS_H - WALL },
    { x: CANVAS_W - WALL, y: CANVAS_H - WALL },
  ];
  if ((b.cornerCool || 0) > 0) { b.cornerCool -= dt; return; }
  for (let i = 0; i < 4; i++) {
    const c = corners[i];
    const dx = b.x - c.x, dy = b.y - c.y;
    if (Math.hypot(dx, dy) > CORNER_RADIUS) continue;
    // 角から外へ出て行こうとしている(両軸とも外向き)とき反射
    const outX = dx * b.vx > 0;
    const outY = dy * b.vy > 0;
    if (outX && outY) {
      const inX = dx < 0 ? 1 : -1;
      const inY = dy < 0 ? 1 : -1;
      b.vx = inX * Math.abs(b.vx);
      b.vy = inY * Math.abs(b.vy);
      const ang = Math.atan2(b.vy, b.vx);
      aimLines.push({ x: b.x, y: b.y, ang, life: 0.5, maxLife: 0.5, guide: false });
      cornerGlow[i] = 1;
      b.cornerCool = 0.25;
      addParticles(b.x, b.y, 8, '#b18cff');
      addRing(b.x, b.y, '#b18cff', 340);
      Sound.corner();
      // 内側へ軽く押し出す
      b.x += inX * 3; b.y += inY * 3;
      break;
    }
  }
}

// ---------- ブロック処理 ----------
function damageBlock(bk, dmg, chainable) {
  if (bk.type === 'indestructible') { bounceInBlock(bk); return; } // クリア条件外・反射するだけ
  bk.hp -= dmg;
  bk.flash = 1;
  if (bk.hp <= 0) {
    bk.alive = false;
    if (chainable) { G.chain++; G.chainTimer = 2; }
    const base = { normal: 10, drifter: 20, metal: 30, explosive: 25 }[bk.type] || 10;
    const mult = 1 + Math.max(0, G.chain - 1) * 0.5;
    addScore(Math.round(base * mult), bk.x + bk.w / 2, bk.y + bk.h / 2, mult);
    addParticles(bk.x + bk.w / 2, bk.y + bk.h / 2, 14, blockColor(bk));
    addRing(bk.x + bk.w / 2, bk.y + bk.h / 2, blockColor(bk), 300 + G.chain * 18);
    Sound.brick(392 * Math.pow(1.0595, Math.min(24, G.chain)));
    Chaos.meter = Math.min(100, Chaos.meter + 3 + G.chain);
    G.shake = Math.min(8, G.shake + 2);
    G.hitstop = 0.024;
    if (Math.random() < 0.22) spawnDrop(bk.x + bk.w / 2, bk.y + bk.h / 2);
    if (bk.type === 'explosive') explode(bk);
  } else {
    Chaos.meter = Math.min(100, Chaos.meter + 1);
    Sound.metal();
    addParticles(bk.x + bk.w / 2, bk.y + bk.h / 2, 4, blockColor(bk));
  }
}

// ---------- 破壊不能ブロック: 反射するだけ ----------
function bounceInBlock(bk, b) {
  bk.flash = Math.max(bk.flash, 1);
  Sound.clang();
  addParticles(bk.x + bk.w / 2, bk.y + bk.h / 2, 5, '#cfd8dc', 120);
  addRing(bk.x + bk.w / 2, bk.y + bk.h / 2, '#cfd8dc', 260);
  G.shake = Math.max(G.shake, 2);
}

function explode(bk) {
  Sound.boom();
  G.shake = 12;
  G.flash = 0.35;
  const cx = bk.x + bk.w / 2, cy = bk.y + bk.h / 2;
  addParticles(cx, cy, 30, '#ffb347', 260);
  addRing(cx, cy, '#ffb347', 520);
  addRing(cx, cy, '#ff5d8f', 700);
  for (const o of blocks) {
    if (!o.alive || o === bk) continue;
    const ox = o.x + o.w / 2, oy = o.y + o.h / 2;
    if (Math.hypot(ox - cx, oy - cy) < 95) damageBlock(o, 1, true);
  }
}

function blockColor(bk) {
  if (bk.type === 'indestructible') return '#cfd8dc';
  if (bk.type === 'metal') return '#9fb4c7';
  if (bk.type === 'explosive') return '#ff7b4f';
  if (bk.type === 'drifter') return '#b18cff';
  if (bk.color) return bk.color;
  const hues = ['#ff5d8f', '#ffb84f', '#ffe74c', '#6bff8f', '#4fd2ff', '#b18cff'];
  const rows = BLOCK.rows;
  const idx = Math.floor(((bk.y - BLOCK.top) / ((BLOCK.h + BLOCK.gap) * rows)) * hues.length);
  return hues[clamp(idx, 0, hues.length - 1)];
}

function addScore(v, x, y, mult) {
  const m = (mult || 1) * Chaos.scoreMult;
  G.score += v;
  if (m > 1.05 && Math.random() < 0.5) floats.push({ x, y, text: 'x' + m.toFixed(1), life: 0.8, color: '#ffe74c' });
}

function addRing(x, y, color, spd) {
  rings.push({ x, y, r: 6, speed: spd || 420, life: 0.55, maxLife: 0.55, color: color || '#7df9ff' });
}

// ---------- カオスイベント(理由は不明) ----------
const CHAOS_EVENTS = [
  { kind: 'gravity',  title: '重力ドリンク配布中',    sub: '理由は不明だが無料',        dur: 6 },
  { kind: 'dizzy',    title: '三年寝太郎の呪い',      sub: '世界が少し酔っている',      dur: 5 },
  { kind: 'neko',     title: '猫が騙れました',        sub: '当たると撫でてやらない',    dur: 5 },
  { kind: 'clap',     title: '世界拍手会議',          sub: '👏はブロックを応援する',    dur: 4 },
  { kind: 'roulette', title: 'スコア乱数調整中',      sub: '倍率の根拠を問うてはならない', dur: 3 },
  { kind: 'rebell',   title: 'パドルの反乱',          sub: 'パドルは焼肉に行きたがっている', dur: 3 },
  { kind: 'purple',   title: '宇宙管理者が紫にした',  sub: '理由を問うてはならない',    dur: 5 },
];

function triggerChaos() {
  const ev = CHAOS_EVENTS[Math.floor(Math.random() * CHAOS_EVENTS.length)];
  Chaos.active.set(ev.kind, ev.dur);
  banner = { text: ev.title, sub: ev.sub, life: 2.6 };
  G.flash = 0.45; G.shake = 10;
  Sound.fanfare();
  if (ev.kind === 'neko') cats.push({ x: Math.random() < 0.5 ? -60 : CANVAS_W + 60, y: rand(290, 470), vx: (Math.random() < 0.5 ? 1 : -1) * rand(150, 260) });
  if (ev.kind === 'clap') Chaos.clapTimer = 0;
  if (ev.kind === 'roulette') Chaos.roulette = { phase: 'spin', timer: 3, value: 0 };
  if (ev.kind === 'purple') canvas.style.filter = 'hue-rotate(115deg) saturate(2.1) contrast(1.15)';
}

function updateChaos(dt) {
  // メーター満タンで発火(理由は不明)
  if (Chaos.meter >= 100 && G.state === 'play' && Chaos.active.size === 0 && !Chaos.roulette) {
    Chaos.meter = 0;
    triggerChaos();
  }

  // イベント寿命
  for (const [kind, t] of Array.from(Chaos.active)) {
    const nt = t - dt;
    if (nt <= 0) {
      Chaos.active.delete(kind);
      if (kind === 'purple') canvas.style.filter = '';
    } else Chaos.active.set(kind, nt);
  }
  if (Chaos.active.size === 0 && canvas.style.filter && !Chaos.active.has('purple')) canvas.style.filter = '';

  // 重力井戸: 画面中央へ吸われる(理由は不明)
  if (Chaos.active.has('gravity')) {
    for (const b of balls) {
      if (b.stuck) continue;
      const dx = CANVAS_W / 2 - b.x, dy = CANVAS_H / 2 - b.y;
      const d = Math.hypot(dx, dy) || 1;
      b.vx += dx / d * 330 * dt;
      b.vy += dy / d * 330 * dt;
      const s = Math.hypot(b.vx, b.vy), maxS = b.speed * 1.6;
      if (s > maxS) { b.vx *= maxS / s; b.vy *= maxS / s; }
    }
  }

  // 猫: 横切り、ボールに乱暴する
  for (let i = cats.length - 1; i >= 0; i--) {
    const c = cats[i];
    c.x += c.vx * dt;
    if (c.x < -90 || c.x > CANVAS_W + 90) { cats.splice(i, 1); continue; }
    for (const b of balls) {
      if (b.stuck) continue;
      if (Math.abs(b.x - c.x) < 36 && Math.abs(b.y - c.y) < 28) {
        const a = rand(0, TAU);
        b.vx = Math.cos(a) * b.speed; b.vy = Math.sin(a) * b.speed;
        addParticles(b.x, b.y, 10, '#ffd166');
        addRing(b.x, b.y, '#ffd166');
        Sound.beep(220, 0.12, 'square', 0.09);
      }
    }
  }

  // 👏の雨: ブロックを応援する(物理的に)
  if (Chaos.active.has('clap')) {
    Chaos.clapTimer -= dt;
    if (Chaos.clapTimer <= 0) {
      Chaos.clapTimer = 0.22;
      claps.push({ x: rand(50, CANVAS_W - 50), y: -30, vy: rand(240, 400), spin: rand(0, TAU) });
    }
  }
  for (let i = claps.length - 1; i >= 0; i--) {
    const cp = claps[i];
    cp.y += cp.vy * dt; cp.spin += dt * 9;
    if (cp.y > CANVAS_H + 40) { claps.splice(i, 1); continue; }
    for (const bk of blocks) {
      if (!bk.alive) continue;
      if (cp.x > bk.x - 6 && cp.x < bk.x + bk.w + 6 && cp.y > bk.y - 6 && cp.y < bk.y + bk.h + 6) {
        damageBlock(bk, 1, false);
        claps.splice(i, 1);
        break;
      }
    }
  }

  // ルーレット: ハズレあり(理由は不明)
  if (Chaos.roulette) {
    const rr = Chaos.roulette;
    if (rr.phase === 'spin') {
      rr.timer -= dt;
      if (rr.timer <= 0) {
        rr.phase = 'result'; rr.timer = 5;
        rr.value = [0.5, 1, 2, 3, 4, 6, 9][Math.floor(Math.random() * 7)];
        Chaos.scoreMult = rr.value;
        banner = { text: `得点倍率 ×${rr.value}!`, sub: '監査基準はありません', life: 2.4 };
        Sound.beep(rr.value >= 6 ? 880 : 200, 0.4, 'sawtooth', 0.12);
      }
    } else {
      rr.timer -= dt;
      if (rr.timer <= 0) { Chaos.scoreMult = 1; Chaos.roulette = null; }
    }
  }

  // パドルの反乱: 焼肉へ行きたがる
  if (Chaos.active.has('rebell')) {
    Chaos.rebelPh = (Chaos.rebelPh || 0) + dt * 6;
    paddle.t = clamp(paddle.t + Math.sin(Chaos.rebelPh) * dt * 0.65, 0, 1);
  }

  // 衝撃波リング
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i];
    r.r += r.speed * dt; r.life -= dt;
    if (r.life <= 0) rings.splice(i, 1);
  }

  // 反射ガイド線(glow)
  for (let i = aimLines.length - 1; i >= 0; i--) {
    aimLines[i].life -= dt;
    if (aimLines[i].life <= 0) aimLines.splice(i, 1);
  }
  for (let i = 0; i < 4; i++) cornerGlow[i] = Math.max(0, cornerGlow[i] - dt * 2.2);

  // FEVER値(コンボで発熱)
  const feverTarget = G.chain >= 8 ? 1 : (G.chain >= 5 ? 0.5 : 0);
  G.fever = (G.fever || 0) + (feverTarget - (G.fever || 0)) * Math.min(1, dt * 3);
}

// ---------- パーティクル ----------
function addParticles(x, y, n, color, spd) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU), s = rand(40, spd || 160);
    particles.push({
      x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      life: rand(0.3, 0.7), maxLife: 0.7, color, size: rand(1.5, 3.5),
    });
  }
}

// ---------- パワーアップ ----------
function spawnDrop(x, y) {
  const kinds = ['multi', 'wide', 'boom', 'life'];
  const kind = kinds[Math.floor(Math.random() * (G.lives >= 5 ? 3 : 4))];
  drops.push({ x, y, vy: 90, kind });
}

const DROP_STYLE = {
  multi: { c: '#4fd2ff', label: 'M' },
  wide:  { c: '#6bff8f', label: 'W' },
  boom:  { c: '#ff7b4f', label: 'B' },
  life:  { c: '#ff5d8f', label: '1UP' },
};

function applyDrop(kind) {
  Sound.power();
  if (kind === 'multi') {
    const src = balls.filter(b => !b.stuck)[0];
    if (src) {
      for (let i = 0; i < 2; i++) {
        const a = Math.atan2(src.vy, src.vx) + rand(-0.7, 0.7);
        balls.push({ x: src.x, y: src.y, vx: Math.cos(a) * src.speed, vy: Math.sin(a) * src.speed, speed: src.speed, trail: [], stuck: null });
      }
    }
  } else if (kind === 'wide') {
    G.wideTimer = 12;
    paddle.w = PADDLE_BASE_W * 1.6;
  } else if (kind === 'boom') {
    balls.forEach(b => { b.boomTimer = 8; });
  } else if (kind === 'life') {
    G.lives = Math.min(6, G.lives + 1);
  }
  floats.push({ x: paddlePos(paddle.edge, paddle.t).x, y: paddlePos(paddle.edge, paddle.t).y - 24, text: DROP_STYLE[kind].label, life: 1, color: DROP_STYLE[kind].c });
}

// ---------- 更新 ----------
function update(dt) {
  G.time += dt;

  // バレットタイム
  const wantSlow = (keys[' '] || keys['space']) && G.energy > 1 && (G.state === 'play' || G.state === 'serve');
  if (wantSlow) { G.timeScale += (0.3 - G.timeScale) * Math.min(1, dt * 8); G.energy = Math.max(0, G.energy - 42 * dt); }
  else { G.timeScale += (1 - G.timeScale) * Math.min(1, dt * 6); G.energy = Math.min(100, G.energy + 14 * dt); }

  const sdt = dt * G.timeScale;

  if (G.wideTimer > 0) {
    G.wideTimer -= dt;
    if (G.wideTimer <= 0) paddle.w = PADDLE_BASE_W;
  }

  // ヒットストップ
  if (G.hitstop > 0) { G.hitstop -= dt; return; }

  // コンボタイマー
  if (G.chainTimer > 0) { G.chainTimer -= dt; if (G.chainTimer <= 0) G.chain = 0; }

  // パドル キーボード補助
  const kspd = 1.1 * dt;
  if (keys['arrowleft'] || keys['a']) paddle.t = clamp(paddle.t - kspd, 0, 1);
  if (keys['arrowright'] || keys['d']) paddle.t = clamp(paddle.t + kspd, 0, 1);
  if (keys['arrowup'] || keys['w']) { if (paddle.edge === 'left' || paddle.edge === 'right') paddle.t = clamp(paddle.t - kspd, 0, 1); }
  if (keys['arrowdown'] || keys['s']) { if (paddle.edge === 'left' || paddle.edge === 'right') paddle.t = clamp(paddle.t + kspd, 0, 1); }
  if (keys['arrowup'] || keys['w']) { if (paddle.edge === 'top' || paddle.edge === 'bottom') paddle.edge = (paddle.t > 0.5) === (paddle.edge === 'bottom') ? 'left' : 'right'; }

  // ボール
  for (let i = balls.length - 1; i >= 0; i--) {
    const b = balls[i];
    if (b.stuck) {
      const p = paddlePos(paddle.edge, paddle.t);
      const n = edgeNormal(paddle.edge);
      const safe = PADDLE_MARGIN + PADDLE_H / 2 + BALL_R + 2;
      b.x = p.x + (n.x ? n.x * 0 : 0); b.y = p.y;
      if (paddle.edge === 'bottom') b.y = CANVAS_H - safe;
      if (paddle.edge === 'top')    b.y = safe;
      if (paddle.edge === 'left')   { b.x = safe; b.y = p.y; }
      if (paddle.edge === 'right')  { b.x = CANVAS_W - safe; b.y = p.y; }
      continue;
    }
    if (b.boomTimer > 0) b.boomTimer -= dt;

    // サブステップで高速貫通防止
    const steps = Math.ceil((Math.hypot(b.vx, b.vy) * sdt) / (BALL_R));
    const n = Math.max(1, steps);
    for (let s = 0; s < n; s++) stepBall(b, sdt / n);

    // トレイル
    b.trail.push({ x: b.x, y: b.y });
    if (b.trail.length > 14) b.trail.shift();

    if (b.y > CANVAS_H + 40 || b.y < -60 || b.x < -60 || b.x > CANVAS_W + 60) balls.splice(i, 1);
  }

  // 全ボール消失
  if (balls.length === 0 && (G.state === 'play' || G.state === 'serve')) {
    G.lives--;
    Sound.lose();
    if (G.lives <= 0) { G.state = 'over'; }
    else startServe();
  }

  // ブロック漂い
  for (const bk of blocks) {
    if (!bk.alive) continue;
    bk.flash = Math.max(0, bk.flash - dt * 4);
    if (bk.drift) bk.y = bk.baseY + Math.sin(G.time * 1.2 + bk.phase) * bk.drift;
  }

  // パーティクル
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= 0.96; p.vy *= 0.96;
    if (p.life <= 0) particles.splice(i, 1);
  }
  for (let i = floats.length - 1; i >= 0; i--) {
    const f = floats[i]; f.life -= dt; f.y -= 30 * dt;
    if (f.life <= 0) floats.splice(i, 1);
  }

  // ドロップ
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i];
    d.y += d.vy * sdt;
    if (d.y > CANVAS_H + 30) { drops.splice(i, 1); continue; }
    const r = paddleRect();
    if (d.x > r.x - 12 && d.x < r.x + r.w + 12 && d.y > r.y - 14 && d.y < r.y + r.h + 14) {
      applyDrop(d.kind); drops.splice(i, 1);
    }
  }

  // クリア判定(破壊不能ブロックは対象外)
  const targets = blocks.filter(b => b.type !== 'indestructible');
  if (targets.length && targets.every(b => !b.alive) && (G.state === 'play')) nextRound();

  // カオス(理由は不明)
  if (banner) { banner.life -= dt; if (banner.life <= 0) banner = null; }
  updateChaos(dt);

  G.shake = Math.max(0, G.shake - dt * 30);
  G.flash = Math.max(0, G.flash - dt * 2.5);
}

function stepBall(b, dt) {
  b.x += b.vx * dt;
  b.y += b.vy * dt;

  // 壁
  if (b.x < WALL + BALL_R) { b.x = WALL + BALL_R; b.vx = Math.abs(b.vx); wallFx(b); }
  if (b.x > CANVAS_W - WALL - BALL_R) { b.x = CANVAS_W - WALL - BALL_R; b.vx = -Math.abs(b.vx); wallFx(b); }
  if (b.y < WALL + BALL_R) { b.y = WALL + BALL_R; b.vy = Math.abs(b.vy); wallFx(b); }
  if (b.y > CANVAS_H - WALL - BALL_R) { b.y = CANVAS_H - WALL - BALL_R; b.vy = -Math.abs(b.vy); wallFx(b); }

  // 四隅の反射台
  cornerBumper(b, dt);

  // パドル(縁)
  const r = paddleRect();
  const inX = b.x + BALL_R > r.x && b.x - BALL_R < r.x + r.w;
  const inY = b.y + BALL_R > r.y && b.y - BALL_R < r.y + r.h;
  if (inX && inY) reflectOffPaddle(b);

  // ブロック
  for (const bk of blocks) {
    if (!bk.alive) continue;
    if (b.x + BALL_R > bk.x && b.x - BALL_R < bk.x + bk.w &&
        b.y + BALL_R > bk.y && b.y - BALL_R < bk.y + bk.h) {
      // 浅い方の軸で反射
      const overlapL = b.x + BALL_R - bk.x;
      const overlapR = bk.x + bk.w - (b.x - BALL_R);
      const overlapT = b.y + BALL_R - bk.y;
      const overlapB = bk.y + bk.h - (b.y - BALL_R);
      const m = Math.min(overlapL, overlapR, overlapT, overlapB);
      if (m === overlapL) { b.x = bk.x - BALL_R; b.vx = -Math.abs(b.vx); }
      else if (m === overlapR) { b.x = bk.x + bk.w + BALL_R; b.vx = Math.abs(b.vx); }
      else if (m === overlapT) { b.y = bk.y - BALL_R; b.vy = -Math.abs(b.vy); }
      else { b.y = bk.y + bk.h + BALL_R; b.vy = Math.abs(b.vy); }
      damageBlock(bk, b.boomTimer > 0 ? 2 : 1, true);
      if (b.boomTimer > 0 && bk.alive) explode(bk);
      break;
    }
  }
}

function wallFx(b) {
  addParticles(b.x, b.y, 3, '#7df9ff', 90);
  Sound.hit();
  if (G.state === 'serve' && balls.length && balls[0].stuck) {
    // 発射前は無視
  }
}

// ---------- 描画 ----------
function draw() {
  ctx.save();
  // 画面シェイク
  if (G.shake > 0) ctx.translate(rand(-G.shake, G.shake), rand(-G.shake, G.shake));
  // 酔い演出(三年寝太郎の呪い)
  if (Chaos.active.has('dizzy')) {
    ctx.translate(CANVAS_W / 2, CANVAS_H / 2);
    ctx.rotate(Math.sin(G.time * 1.4) * 0.06);
    ctx.scale(1 + Math.sin(G.time * 2.2) * 0.015, 1 - Math.sin(G.time * 2.2) * 0.015);
    ctx.translate(-CANVAS_W / 2, -CANVAS_H / 2);
  }

  // 背景
  const bg = ctx.createRadialGradient(CANVAS_W / 2, CANVAS_H / 2, 60, CANVAS_W / 2, CANVAS_H / 2, CANVAS_W * 0.75);
  bg.addColorStop(0, '#0d1030');
  bg.addColorStop(1, '#05060f');
  ctx.fillStyle = bg;
  ctx.fillRect(-180, -180, CANVAS_W + 360, CANVAS_H + 360);

  // 星
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  for (const s of starfield) {
    const tw = 0.4 + 0.6 * Math.abs(Math.sin(G.time * s.tw + s.ph));
    ctx.globalAlpha = tw * 0.6;
    ctx.fillRect(s.x, s.y, s.s, s.s);
  }
  ctx.globalAlpha = 1;

  // ネオングリッド(FEVERで発熱色)
  const gs = 60;
  const fh = (G.time * 90) % 360;
  ctx.globalAlpha = 0.09 + (G.fever || 0) * 0.12;
  ctx.strokeStyle = `hsl(${fh},100%,60%)`;
  ctx.lineWidth = 1;
  const off = (G.time * 24) % gs;
  for (let x = -gs + off; x < CANVAS_W + gs; x += gs) { ctx.beginPath(); ctx.moveTo(x, -30); ctx.lineTo(x, CANVAS_H + 30); ctx.stroke(); }
  for (let y = -gs + off; y < CANVAS_H + gs; y += gs) { ctx.beginPath(); ctx.moveTo(-30, y); ctx.lineTo(CANVAS_W + 30, y); ctx.stroke(); }
  ctx.globalAlpha = 1;

  // 重力井戸(理由は不明)
  if (Chaos.active.has('gravity')) {
    ctx.save();
    ctx.translate(CANVAS_W / 2, CANVAS_H / 2);
    ctx.rotate(G.time * 3);
    const g0 = ctx.createRadialGradient(0, 0, 4, 0, 0, 130);
    g0.addColorStop(0, 'rgba(125,249,255,0.9)');
    g0.addColorStop(0.4, 'rgba(177,140,255,0.35)');
    g0.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g0;
    ctx.beginPath(); ctx.arc(0, 0, 130, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(125,249,255,0.65)'; ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(0, 0, 42 + i * 30, i * 2.1, i * 2.1 + 2.4); ctx.stroke(); }
    ctx.restore();
  }

  // 枠
  ctx.strokeStyle = 'rgba(125,249,255,0.35)';
  ctx.lineWidth = 3;
  ctx.strokeRect(WALL, WALL, CANVAS_W - WALL * 2, CANVAS_H - WALL * 2);

  // ブロック
  for (const bk of blocks) {
    if (!bk.alive) continue;
    const c = blockColor(bk);
    ctx.save();
    ctx.shadowColor = c; ctx.shadowBlur = bk.flash > 0 ? 22 : 10;
    ctx.fillStyle = c;
    if (bk.type === 'indestructible') {
      // 鋼ブロック: 不透明・斜線ストライプ・リベット
      ctx.globalAlpha = 1;
      roundRect(bk.x, bk.y, bk.w, bk.h, 5); ctx.fill();
      ctx.save();
      roundRect(bk.x, bk.y, bk.w, bk.h, 5); ctx.clip();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 3;
      for (let s = -bk.h; s < bk.w + bk.h; s += 9) {
        ctx.beginPath();
        ctx.moveTo(bk.x + s, bk.y + bk.h + 2);
        ctx.lineTo(bk.x + s + bk.h + 4, bk.y - 2);
        ctx.stroke();
      }
      ctx.restore();
      ctx.strokeStyle = '#546e7a'; ctx.lineWidth = 3;
      roundRect(bk.x + 2, bk.y + 2, bk.w - 4, bk.h - 4, 4); ctx.stroke();
      ctx.fillStyle = '#eceff1';
      for (const [ox, oy] of [[7, 7], [bk.w - 7, 7], [7, bk.h - 7], [bk.w - 7, bk.h - 7]]) {
        ctx.beginPath(); ctx.arc(bk.x + ox, bk.y + oy, 2.4, 0, TAU); ctx.fill();
      }
    } else {
      ctx.globalAlpha = bk.type === 'metal' ? 0.35 + 0.2 * bk.hp : 0.85;
      roundRect(bk.x, bk.y, bk.w, bk.h, 5);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (bk.type === 'metal') {
        ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 2;
        roundRect(bk.x + 3, bk.y + 3, bk.w - 6, bk.h - 6, 4); ctx.stroke();
      }
      if (bk.type === 'explosive') {
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('✸', bk.x + bk.w / 2, bk.y + bk.h / 2 + 1);
      }
      if (bk.type === 'drifter') {
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.beginPath(); ctx.arc(bk.x + bk.w / 2, bk.y + bk.h / 2, 4, 0, TAU); ctx.fill();
      }
    }
    ctx.restore();
  }

  // ドロップ
  for (const d of drops) {
    const st = DROP_STYLE[d.kind];
    ctx.save();
    ctx.shadowColor = st.c; ctx.shadowBlur = 14;
    ctx.fillStyle = st.c;
    roundRect(d.x - 14, d.y - 9, 28, 18, 9); ctx.fill();
    ctx.fillStyle = '#05060f'; ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(st.label, d.x, d.y + 1);
    ctx.restore();
  }

  // パーティクル
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;

  // 衝撃波リング
  for (const r of rings) {
    ctx.globalAlpha = Math.max(0, r.life / r.maxLife) * 0.9;
    ctx.strokeStyle = r.color;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, TAU); ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // 謎の猫
  for (const c of cats) {
    const wob = Math.sin(G.time * 12) * 7;
    ctx.save();
    ctx.font = '30px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = '#ffd166'; ctx.shadowBlur = 14;
    ctx.fillStyle = '#ffd166';
    ctx.fillText('=^.^=', c.x, c.y + wob);
    ctx.restore();
  }

  // 👏の雨
  for (const cp of claps) {
    ctx.save();
    ctx.translate(cp.x, cp.y);
    ctx.rotate(Math.sin(cp.spin) * 0.6);
    ctx.font = '26px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = '#ffe74c'; ctx.shadowBlur = 12;
    ctx.fillText('👏', 0, 0);
    ctx.restore();
  }

  // ボール
  for (const b of balls) {
    // トレイル
    for (let i = 0; i < b.trail.length; i++) {
      const t = b.trail[i];
      ctx.globalAlpha = (i / b.trail.length) * 0.45;
      const col = b.boomTimer > 0 ? '#ff7b4f' : '#7df9ff';
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(t.x, t.y, BALL_R * (i / b.trail.length), 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.shadowColor = b.boomTimer > 0 ? '#ff7b4f' : '#ffffff';
    ctx.shadowBlur = 18;
    ctx.fillStyle = b.boomTimer > 0 ? '#ff7b4f' : '#ffffff';
    ctx.beginPath(); ctx.arc(b.x, b.y, BALL_R, 0, TAU); ctx.fill();
    ctx.restore();
  }

  // パドル(縁に沿った発光バー)
  const pr = paddleRect();
  ctx.save();
  ctx.shadowColor = '#7df9ff'; ctx.shadowBlur = 20;
  const pg = ctx.createLinearGradient(pr.x, pr.y, pr.x + pr.w, pr.y + pr.h);
  pg.addColorStop(0, '#7df9ff'); pg.addColorStop(1, '#b18cff');
  ctx.fillStyle = pg;
  roundRect(pr.x, pr.y, pr.w, pr.h, 7); ctx.fill();
  ctx.restore();

  // 四隅の反射台(パドルに準ずる角度台)
  drawCorners();

  // 反射予測・結果ガイド
  drawGuide();

  // 浮遊テキスト
  for (const f of floats) {
    ctx.globalAlpha = Math.min(1, f.life);
    ctx.fillStyle = f.color;
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;

  // カオス告示テロップ
  if (banner) {
    const a = Math.min(1, banner.life);
    const hue = (G.time * 200) % 360;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 44px monospace';
    ctx.shadowColor = `hsl(${hue},100%,60%)`; ctx.shadowBlur = 26;
    ctx.fillStyle = `hsl(${hue},100%,72%)`;
    ctx.fillText(banner.text, CANVAS_W / 2, 205);
    ctx.shadowBlur = 0;
    ctx.font = '15px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.78)';
    ctx.fillText(banner.sub, CANVAS_W / 2, 240);
    ctx.restore();
  }

  // 倍率ルーレット
  if (Chaos.roulette) {
    const rr = Chaos.roulette;
    const vals = [0.5, 9, 1, 6, 2, 4, 3];
    const label = rr.phase === 'spin'
      ? '×' + vals[Math.floor(G.time * 12) % vals.length]
      : '×' + rr.value;
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 70px monospace';
    ctx.globalAlpha = 0.92;
    ctx.shadowColor = rr.phase === 'spin' ? '#7df9ff' : '#ffe74c';
    ctx.shadowBlur = 30;
    ctx.fillStyle = rr.phase === 'spin' ? '#7df9ff' : '#ffe74c';
    ctx.fillText(label, CANVAS_W / 2, CANVAS_H / 2 + 40);
    ctx.restore();
  }

  // FEVERの縁(コンボ5+で発熱)
  if ((G.fever || 0) > 0.02) {
    const pers = (G.time * 260) % 360;
    const grd = ctx.createLinearGradient(0, 0, CANVAS_W, 0);
    grd.addColorStop(0, `hsla(${pers},100%,60%,${0.55 * G.fever})`);
    grd.addColorStop(0.5, `hsla(${(pers + 90) % 360},100%,60%,${0.55 * G.fever})`);
    grd.addColorStop(1, `hsla(${(pers + 180) % 360},100%,60%,${0.55 * G.fever})`);
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, CANVAS_W, 22);
    ctx.fillRect(0, CANVAS_H - 22, CANVAS_W, 22);
    const grv = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    grv.addColorStop(0, `hsla(${(pers + 60) % 360},100%,60%,${0.55 * G.fever})`);
    grv.addColorStop(1, `hsla(${(pers + 240) % 360},100%,60%,${0.55 * G.fever})`);
    ctx.fillStyle = grv;
    ctx.fillRect(0, 0, 22, CANVAS_H);
    ctx.fillRect(CANVAS_W - 22, 0, 22, CANVAS_H);
  }

  // フラッシュ
  if (G.flash > 0) {
    ctx.fillStyle = `rgba(255,200,120,${G.flash})`;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }

  // HUD
  drawHud();

  // 状態オーバーレイ
  if (G.state === 'title') overlay('NEON ORBIT BREAKER', 'マウスで縁を移動 / 端ほど角度が変わる / 四隅にも反射台', 'クリックまたは Space でスタート');
  if (G.state === 'serve' && balls[0] && balls[0].stuck) overlaySmall('クリックで発射 (Space: スロー)');
  if (G.state === 'over') overlay('GAME OVER', `SCORE ${G.score}`, 'R またはクリックでリスタート');

  ctx.restore();
}

function drawGuide() {
  // 反射後の飛び方向ガイド(実績線)
  for (const a of aimLines) {
    const al = Math.max(0, a.life / a.maxLife);
    const len = 64;
    ctx.save();
    ctx.globalAlpha = al * 0.8;
    ctx.strokeStyle = a.guide ? 'rgba(125,249,255,0.8)' : '#b18cff';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(a.x + Math.cos(a.ang) * len, a.y + Math.sin(a.ang) * len);
    ctx.stroke();
    ctx.restore();
  }
  // 接近時の予測反射ガイド
  for (const b of balls) {
    if (b.stuck) continue;
    const r = paddleRect();
    const pcx = r.x + r.w / 2, pcy = r.y + r.h / 2;
    const d = Math.hypot(b.x - pcx, b.y - pcy);
    if (d > 190) continue;
    const n = edgeNormal(paddle.edge);
    // 球拍側を向いて飛んでいるときだけ表示
    const toward = -(b.vx * n.x + b.vy * n.y);
    if (toward <= 20) continue;
    let off;
    if (paddle.edge === 'top' || paddle.edge === 'bottom') off = (b.x - pcx) / (r.w / 2);
    else off = (b.y - pcy) / (r.w / 2);
    off = clamp(off, -1, 1);
    const ang = Math.atan2(n.y, n.x) + off * (Math.PI / 3);
    ctx.save();
    ctx.globalAlpha = 0.65 * clamp(1 - d / 190, 0.2, 1);
    ctx.strokeStyle = '#7df9ff';
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 6]);
    ctx.beginPath();
    const sx = pcx + off * (r.w / 2) * (paddle.edge === 'left' || paddle.edge === 'right' ? 0 : 1);
    const sy = pcy + off * (r.w / 2) * (paddle.edge === 'left' || paddle.edge === 'right' ? 1 : 0);
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + Math.cos(ang) * 80, sy + Math.sin(ang) * 80);
    ctx.stroke();
    ctx.restore();
  }
  ctx.setLineDash([]);
}

function drawCorners() {
  const corners = [
    { x: WALL, y: WALL },
    { x: CANVAS_W - WALL, y: WALL },
    { x: WALL, y: CANVAS_H - WALL },
    { x: CANVAS_W - WALL, y: CANVAS_H - WALL },
  ];
  for (let i = 0; i < 4; i++) {
    const c = corners[i];
    const sx = c.x === WALL ? 1 : -1;
    const sy = c.y === WALL ? 1 : -1;
    const L = 34;
    ctx.save();
    ctx.globalAlpha = 0.55 + cornerGlow[i] * 0.45;
    ctx.strokeStyle = cornerGlow[i] > 0.02 ? '#ffd166' : '#b18cff';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = 12 + cornerGlow[i] * 16;
    ctx.beginPath();
    ctx.moveTo(c.x + sx * L, c.y);
    ctx.lineTo(c.x, c.y + sy * L);
    ctx.stroke();
    ctx.restore();
  }
}

function drawHud() {
  ctx.save();
  ctx.font = 'bold 16px monospace';
  ctx.textBaseline = 'middle';
  // スコア
  ctx.fillStyle = '#ffffff'; ctx.textAlign = 'left';
  ctx.fillText(`SCORE ${G.score}`, 20, 28);
  // ラウンド
  ctx.fillStyle = '#b18cff'; ctx.textAlign = 'center';
  ctx.fillText(`ROUND ${G.round} — ${G.stageName || ''}`, CANVAS_W / 2, 28);
  // ライフ
  ctx.textAlign = 'right'; ctx.fillStyle = '#ff5d8f';
  ctx.fillText('♥ '.repeat(G.lives).trim(), CANVAS_W - 20, 28);
  // コンボ
  if (G.chain >= 2) {
    ctx.textAlign = 'center';
    ctx.font = 'bold 30px monospace';
    ctx.fillStyle = `rgba(255,231,76,${clamp(G.chainTimer, 0, 1)})`;
    ctx.fillText(`${G.chain} CHAIN!`, CANVAS_W / 2, 130 + Math.sin(G.time * 10) * 3);
  }
  // バレットタイム燃料
  const bw = 220, bx = CANVAS_W / 2 - bw / 2, by = CANVAS_H - 34;
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  roundRect(bx, by, bw, 10, 5); ctx.fill();
  ctx.fillStyle = G.energy > 25 ? '#7df9ff' : '#ff5d8f';
  ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 10;
  roundRect(bx, by, bw * (G.energy / 100), 10, 5); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '11px monospace'; ctx.textAlign = 'center';
  ctx.fillText('BULLET TIME [SPACE]', CANVAS_W / 2, by + 24);

  // カオスメーター(溜まると理由不明の何かが起きる)
  const mw = 220, mx = CANVAS_W / 2 - mw / 2, my = CANVAS_H - 14;
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  roundRect(mx, my, mw, 7, 4); ctx.fill();
  const mh = (G.time * 200) % 360;
  ctx.fillStyle = `hsl(${mh},100%,60%)`;
  ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 10;
  roundRect(mx, my, mw * (Chaos.meter / 100), 7, 4); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.restore();
}

function overlay(title, sub, foot) {
  ctx.save();
  ctx.fillStyle = 'rgba(5,6,15,0.72)';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = '#7df9ff'; ctx.shadowBlur = 26;
  ctx.fillStyle = '#7df9ff';
  ctx.font = 'bold 52px monospace';
  ctx.fillText(title, CANVAS_W / 2, CANVAS_H / 2 - 60);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#dfe6ff'; ctx.font = '18px sans-serif';
  ctx.fillText(sub, CANVAS_W / 2, CANVAS_H / 2);
  ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '15px sans-serif';
  if (Math.sin(G.time * 4) > -0.3) ctx.fillText(foot, CANVAS_W / 2, CANVAS_H / 2 + 60);
  ctx.restore();
}

function overlaySmall(text) {
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = '16px sans-serif';
  ctx.fillText(text, CANVAS_W / 2, CANVAS_H - 90);
  ctx.restore();
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---------- メインループ ----------
let last = performance.now();
function loop(now) {
  let dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  if (G.state === 'play' || G.state === 'serve') update(dt);
  else { // title/over でも簡易演出
    G.time += dt;
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
    if (G.state === 'over' && (keys['r'] || keys['R'])) startGame();
  }
  draw();
  requestAnimationFrame(loop);
}

// クリックでoverからリスタート
canvas.addEventListener('click', () => { if (G.state === 'over') startGame(); });

// 初期化
for (let i = 0; i < 90; i++) {
  starfield.push({ x: rand(0, CANVAS_W), y: rand(0, CANVAS_H), s: rand(1, 2.4), tw: rand(0.5, 2), ph: rand(0, TAU) });
}
buildBlocks(); // タイトル背景用
requestAnimationFrame(loop);
