'use strict';
/* ============================================================
   FUNNY SYSTEM for breakout.html — 妙に作り込まれた無駄機能
   既存ゲーム本体(:8)には触れない独立オーバーレイ実装。
   on/off: Nキー / LocalStorage / Debug: triggerFunnyEvent(id)
   ============================================================ */
(function () {
  const base = document.getElementById('game');
  if (!base) return;
  const W = base.width, H = base.height;
  const PADDLE_Y = H - 40;

  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[(Math.random() * arr.length) | 0];
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  function loadLS(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function saveLS(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function shakeScreen(mag, dur) { try { if (typeof shakeMain === 'function') shakeMain(mag, dur); else if (typeof shake === 'function') shake(mag, dur); } catch (e) {} }

  // ---------- 設定(Nで切替 / LocalStorage保存) ----------
  let funnyOn = loadLS('breakout_funny_v2', true) !== false;
  function toggleFunny(v) {
    funnyOn = v == null ? !funnyOn : v;
    saveLS('breakout_funny_v2', funnyOn);
    toast('変な演出: ' + (funnyOn ? 'ON' : 'OFF'), 2, 15);
  }
  addEventListener('keydown', (e) => { if (e.key === 'n' || e.key === 'N') toggleFunny(); });

  // ---------- オーバーレイcanvas ----------
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  cv.style.cssText = 'position:fixed;pointer-events:none;z-index:60;';
  document.body.appendChild(cv);
  const g = cv.getContext('2d');
  function fit() {
    const r = base.getBoundingClientRect();
    cv.style.left = r.left + 'px'; cv.style.top = r.top + 'px';
    cv.style.width = r.width + 'px'; cv.style.height = r.height + 'px';
  }
  addEventListener('resize', fit); fit();

  // ---------- 統計 ----------
  const S = {
    playTime: 0, paddleDist: 0,
    wallHits: { L: 0, R: 0, T: 0 },
    blockCollisions: 0, losses: 0, maxKmh: 0,
    dirAccumL: 0, dirAccumR: 0, dirReversals: 0,
    lossPositions: [],
  };
  {
    const d = loadLS('breakout_dirs_v2', { accumL: 0, accumR: 0 });
    S.dirAccumL = d.accumL || 0; S.dirAccumR = d.accumR || 0;
    const lp = loadLS('breakout_losspos_v2', []);
    if (Array.isArray(lp)) S.lossPositions = lp;
  }
  function kmhOf(b) { const sp = Math.hypot(b.vx, b.vy); return sp * 0.38; }

  // ---------- 実績 ----------
  const ACHS = [
    { id: 'right', t: '右へ', d: '右方向へ1000回入力した' },
    { id: 'left', t: '左へ', d: '左方向へ1000回入力した' },
    { id: 'idle5', t: '何もしない', d: 'ゲーム中5秒間操作しなかった' },
    { id: 'dontLearn', t: '学ばない', d: '似たような位置で3回ボールを落とした' },
    { id: 'wallLove', t: '壁が好き', d: '同じ壁に100回当てた' },
    { id: 'overtime', t: '残業', d: 'ボールを5分間落とさなかった' },
    { id: 'speedfreak', t: '速度狂', d: '一定以上の速度に到達' },
    { id: 'clear', t: '一応クリア', d: '普通にステージクリアした' },
    { id: 'zeroAccident', t: '事故ゼロ', d: '1ステージ中ボールを落とさなかった' },
    { id: 'paddleSpam', t: '何をしている', d: 'パドルを左右に高速で50往復した' },
  ];
  let unlocked = loadLS('breakout_ach_v2', []);
  if (!Array.isArray(unlocked)) unlocked = [];
  const badges = [];
  const Ach = {
    has: id => unlocked.includes(id),
    unlock(id) {
      if (unlocked.includes(id)) return;
      const a = ACHS.find(x => x.id === id); if (!a) return;
      unlocked.push(id); saveLS('breakout_ach_v2', unlocked);
      badges.push({ t: a.t, d: a.d, life: 4.2, max: 4.2 });
      toast('ACHIEVEMENT UNLOCKED: ' + a.t, 3.4, 13, '#ffe14a');
    },
  };

  // ---------- ゲーム状態スナップショット ----------
  const V = { state: 'ready', stage: 0, score: 0, lives: 3, blocks: [], balls: [], paddle: { x: 0, w: 110 }, combo: 0 };
  let prevAlive = null, prevBalls = null, prevPaddleX = null, prevDir = 1;
  let stageLosses = 0;

  // ---------- 表記コンテナ ----------
  let banner = null;
  const toasts = [];
  const ahs = [];       // あっ
  const floats = [];    // ASSET番号・除却 など
  let bubble = null;    // ボールの吹き出し {text, t, dur, ball}
  let crowd = null;
  let panic = null;
  let assets = null;
  let giant = null;
  let wiper = null, helmet = null, wrench = null;
  let results = null;   // 事故報告書/謎評価
  let tempPanel = null; // PADDLE TEMP
  let heat = 0, tempCd = 0;
  let faceT = 0, faceCd = 0;
  let bubbleCd = 12, randomEvTimer = rnd(14, 35), randomAssetTimer = rnd(70, 180);
  const cd = {};
  let lastPaddleHits = [];

  function toast(text, dur, size, color) { toasts.push({ text, t: 0, dur: dur || 2.6, size: size || 14, color: color || '#ffe14a' }); if (toasts.length > 4) toasts.shift(); }
  function bannerShow(text, sub, dur, size) { banner = { text, sub: sub || '', t: 0, dur: dur || 2.2, size: size || 26 }; }
  function openCd(key, secs) { if (cd[key] > 0) return false; cd[key] = secs; return true; }
  function tickCd(dt) { for (const k in cd) if (cd[k] > 0) cd[k] = Math.max(0, cd[k] - dt); }

  // ---------- 謎SE(ごく低確率) ----------
  function weirdSE() {
    try {
      if (typeof initAudio === 'function') initAudio();
      const A = (typeof actx !== 'undefined') ? actx : null;
      if (!A || A.state === 'closed') return;
      if (A.state === 'suspended') A.resume();
      const [f, d, t] = pick([[740, 0.05, 'sine'], [980, 0.04, 'triangle'], [520, 0.09, 'sine'], [1100, 0.03, 'sine'], [300, 0.12, 'sine']]);
      const o = A.createOscillator(), gn = A.createGain();
      o.type = t; o.frequency.value = f; gn.gain.value = 0.05;
      o.connect(gn); gn.connect(A.destination);
      const t0 = A.currentTime;
      o.start(t0); gn.gain.exponentialRampToValueAtTime(0.0001, t0 + d); o.stop(t0 + d + 0.02);
    } catch (e) {}
  }

  // ---------- 個別イベント ----------
  function maxBallKmh() { let m = 0; for (const b of V.balls) if (!b.stuck) m = Math.max(m, kmhOf(b)); return m; }

  function onPaddleHit(/* b */) {
    lastPaddleHits.push(performance.now());
    if (lastPaddleHits.length > 24) lastPaddleHits.shift();
    if (funnyOn && Math.random() < 0.006) weirdSE();
    if (funnyOn && Math.random() < 0.0012 && !giant && openCd('giant', 150)) runGiantBall();
    if (funnyOn && faceT <= 0 && faceCd <= 0 && lastPaddleHits.length >= 22 && Math.random() < 0.3) { faceT = 3.2; faceCd = 50; }
  }

  function runGiantBall() {
    let nb = null;
    for (const b of V.balls) if (!b.stuck && (!nb || b.y > nb.y)) nb = b;
    if (!nb) return;
    const cx = nb.x, cy = nb.y;
    giant = { t: 0, dur: 5, x: cx, y: cy, r: 52 };
    if (typeof explodeBlock === 'function' && V.blocks) {
      for (const bl of V.blocks.slice()) {
        if (bl.dead) continue;
        const bx = bl.x + bl.w / 2, by = bl.y + bl.h / 2;
        if (Math.hypot(bx - cx, by - cy) < 175) explodeBlock(bl);
      }
    }
    shakeScreen(7, 0.35);
    bannerShow('なんかでかい', '', 2, 32);
    toast('※規格外の顕揚が確認されました', 2.6, 11, '#9ecbff');
  }

  function onWallHit(side) { S.wallHits[side] = (S.wallHits[side] || 0) + 1; }

  const destroyLog = [];
  function onBlocksDestroyed(n) {
    if (n <= 0) return;
    S.blockCollisions += n;
    const now = performance.now();
    for (let i = 0; i < n; i++) destroyLog.push(now);
    while (destroyLog.length && destroyLog[0] < now - 2200) destroyLog.shift();
    if (funnyOn && destroyLog.length >= 10 && !crowd && openCd('crowd', 26)) {
      crowd = { t: 0, dur: destroyLog.length >= 20 ? 4.6 : 3.4, count: clamp(2 + (destroyLog.length / 5 | 0), 2, 14), big: destroyLog.length >= 20 };
      toast(crowd.big ? 'STANDING OVATION!' : '観客が見に来た', 1.8, 12, '#ffe14a');
    }
    if (assets) {
      for (const [bl, num] of Array.from(assets.map)) {
        if (bl.dead) {
          floats.push({ x: bl.x + bl.w / 2, y: bl.y + bl.h / 2, text: 'ASSET-' + ('0000' + num).slice(-4) + ' 除却', t: 0, dur: 1.6, color: '#cfd8dc', size: 11 });
          assets.map.delete(bl);
        }
      }
    }
  }

  function onBallLost() {
    S.losses++; stageLosses++;
    const x = Math.round(V.paddle.x + V.paddle.w / 2);
    S.lossPositions.push(x);
    while (S.lossPositions.length > 8) S.lossPositions.shift();
    saveLS('breakout_losspos_v2', S.lossPositions);
    const tail = S.lossPositions.slice(-3);
    if (tail.length === 3 && tail.every(v => Math.abs(v - tail[0]) < 120)) Ach.unlock('dontLearn');
  }

  function checkAch() {
    if (S.dirAccumL >= 1000) Ach.unlock('left');
    if (S.dirAccumR >= 1000) Ach.unlock('right');
    for (const k of ['L', 'R', 'T']) if (S.wallHits[k] >= 100) Ach.unlock('wallLove');
    if (S.maxKmh >= 200) Ach.unlock('speedfreak');
    if (S.playTime >= 300 && S.losses === 0) Ach.unlock('overtime');
    if (S.dirReversals >= 50) Ach.unlock('paddleSpam');
    if (idleTimer >= 5 && V.state === 'playing') Ach.unlock('idle5');
  }

  // ---------- 最後の1ブロック逃走 ----------
  function tickLastBlockPanic() {
    if (panic || giant || assets || V.state !== 'playing') return;
    const list = V.blocks.filter(b => !b.dead && b.kind !== 'steel' && b.kind !== 'steel4');
    if (list.length !== 1) return;
    if (cd['panic'] > 0) return;
    cd['panic'] = 8; // チェック間隔
    if (Math.random() > 0.25) return; // 発生率25%
    const bl = list[0];
    panic = { bl, x0: bl.x, t: 0, dur: 14, vx: (Math.random() < 0.5 ? -1 : 1) * rnd(70, 120), stopT: 0 };
    bannerShow('LAST BLOCK PANIC', '', 1.6, 24);
  }
  function updatePanic(dt) {
    panic.t += dt;
    const bl = panic.bl;
    const f = panic.t < panic.dur * 0.6 ? 1 : 0.35;
    if (panic.stopT > 0) panic.stopT -= dt;
    else {
      bl.x += panic.vx * f * dt;
      if (Math.random() < dt * 0.5) panic.vx *= -1;
      if (Math.random() < dt * 0.2) panic.stopT = rnd(0.4, 1.1);
      let nb = null, nd = 1e9;
      for (const b of V.balls) {
        if (b.stuck) continue;
        const d = Math.hypot(b.x - (bl.x + bl.w / 2), b.y - (bl.y + bl.h / 2));
        if (d < nd) { nd = d; nb = b; }
      }
      if (nb) bl.x += Math.sign(bl.x + bl.w / 2 - nb.x) * 95 * f * dt;
    }
    bl.x = clamp(bl.x, 4, W - bl.w - 4);
    if (panic.t >= panic.dur || bl.dead) { bl.x = panic.x0; panic = null; }
  }

  // ---------- 資産棚卸し ----------
  function startAssetAudit() {
    assets = { map: new Map(), t: 0, dur: 12, num: (Math.random() * 8000 | 0) + 101 };
    for (const bl of V.blocks) { if (!bl.dead) assets.map.set(bl, assets.num++); }
    bannerShow('資産棚卸し実施中', '', 2.2, 22);
    toast('※ゲームには一切関係ありません', 2, 10, '#9ecbff');
  }

  // ---------- 事故報告書+謎評価 ----------
  const CAUSES = ['パドルの位置不足', '操作者の判断遅延', 'ボールの自由落下', '予測不能な反射', '左右確認不足', 'よそ見の可能性', '技術的には正常動作'];
  const FIXES = ['ちゃんと受け止める', '次回は頑張る', 'パドルを適切に配置する', '気合で対応する', '同様事故の再発防止に努める', '特に対策なし'];
  const GRADES = ['操作安定性', '安全意識', '設備保全', 'ボール待遇', '経営効率', 'なんとなく'];
  const COMMENTS = ['全体として問題ありません。', 'ボールへの配慮が不足しています。', 'パドルの高速移動が確認されました。', '今後も安全運転をお願いします。', '本日もご苦労様でした。', '設備側の問題として扱います。'];
  function showResults(mode) {
    const grades = GRADES.map(k => ({ k, g: pick(['A', 'B', 'C', 'D', 'E', 'S']) }));
    grades[(Math.random() * grades.length) | 0].g = 'A+';
    const t = S.playTime | 0;
    const wsum = S.wallHits.L + S.wallHits.R;
    const stats = [
      '本日のボール労働時間: ' + String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'),
      '総衝突回数: ' + S.blockCollisions + '回',
      'パドル走行距離: ' + (S.paddleDist / 2800).toFixed(2) + ' km',
      '壁への衝突回数: ' + (S.wallHits.L + S.wallHits.R + S.wallHits.T) + '回',
      '左壁利用率: ' + (wsum ? (S.wallHits.L / wsum * 100).toFixed(1) : '50.0') + '%',
      '最高ボール速度: ' + Math.round(S.maxKmh) + ' km/h',
      '操作方向変更回数: ' + S.dirReversals + '回',
    ];
    const noise = [
      '本日のパドル機嫌: 良好', '労災発生件数: ' + (1 + (Math.random() * 3 | 0)) + '件',
      'ボール満足度: ' + (20 + (Math.random() * 70 | 0)) + '%', '設備稼働率: 99.8%',
      '安全確認: 未実施', 'コピー機: 動いていません',
    ].sort(() => Math.random() - 0.5).slice(0, 2 + (Math.random() * 2 | 0));
    results = {
      mode, t: 0,
      rows: [
        ['発生時刻', new Date().toTimeString().slice(0, 8)],
        ['事故種別', '球体落下'],
        ['発生場所', 'プレイフィールド下部'],
        ['原因', pick(CAUSES)],
        ['被害', 'ボール 1個'],
        ['再発防止策', pick(FIXES)],
      ],
      grades, comment: pick(COMMENTS), stats, noise,
    };
  }

  // ---------- ランダムイベント(何も起きないもの多数) ----------
  const RANDOM_EVENTS = [
    () => bannerShow('本日安全デー', '', 1.8, 20),
    () => bannerShow('異常なし', '', 1.6, 20),
    () => bannerShow('検査終了', '', 1.6, 20),
    () => { wrench = { t: 0, dur: 1.1 }; bannerShow('ボール点検中', '', 1, 18); },
    () => { wiper = { t: 0, dur: 1.4 }; bannerShow('定期清掃', '', 1, 18); },
    () => { bannerShow('MAINTENANCE', '', 0.32, 30); },
    () => { helmet = { side: Math.random() < 0.5 ? 'L' : 'R', t: 0, dur: 3 }; bannerShow('現場確認', '', 1.2, 18); },
  ];

  // ---------- 更新 ----------
  let idleTimer = 0;
  function onUpdate(dt) {
    dt = clamp(dt, 0.001, 0.033);
    // ゲーム状態の実体参照(window.__dbgのgetter経由)
    const dbg = window.__dbg;
    if (dbg) {
      V.state = dbg.state; V.stage = dbg.stage;
      V.blocks = dbg.blocks; V.balls = dbg.balls;
      V.paddle = dbg.paddle;
    }
    tickCd(dt);
    if (V.state === 'playing') { S.playTime += dt; idleTimer += dt; } else idleTimer = 0;
    if (faceT > 0) faceT -= dt;
    if (faceCd > 0) faceCd -= dt;
    if (bubbleCd > 0) bubbleCd -= dt;
    if (tempCd > 0) tempCd -= dt;
    if (giant) { giant.t += dt; if (giant.t >= giant.dur) giant = null; }
    if (crowd) { crowd.t += dt; if (crowd.t >= crowd.dur) crowd = null; }
    if (assets) { assets.t += dt; if (assets.t >= assets.dur) assets = null; }
    if (wiper) { wiper.t += dt; if (wiper.t >= wiper.dur) wiper = null; }
    if (helmet) { helmet.t += dt; if (helmet.t >= helmet.dur) helmet = null; }
    if (wrench) { wrench.t += dt; if (wrench.t >= wrench.dur) wrench = null; }
    if (tempPanel) { tempPanel.t += dt; if (tempPanel.t >= tempPanel.dur) tempPanel = null; }
    if (bubble) { bubble.t += dt; if (bubble.t >= bubble.dur) bubble = null; }
    if (bubble) { if (bubble.follow && !bubble.follow.stuck) { bubble.x = bubble.follow.x; bubble.y = bubble.follow.y - 24; } }
    if (banner) { banner.t += dt; if (banner.t >= banner.dur) banner = null; }
    for (let i = toasts.length - 1; i >= 0; i--) { toasts[i].t += dt; if (toasts[i].t > toasts[i].dur) toasts.splice(i, 1); }
    for (let i = ahs.length - 1; i >= 0; i--) { ahs[i].t += dt; if (ahs[i].t > 0.6) ahs.splice(i, 1); }
    for (let i = floats.length - 1; i >= 0; i--) { const f = floats[i]; f.t += dt; f.y -= 18 * dt; if (f.t > f.dur) floats.splice(i, 1); }
    for (let i = badges.length - 1; i >= 0; i--) { badges[i].life -= dt; if (badges[i].life <= 0) badges.splice(i, 1); }
    if (results) results.t += dt;

    if (V.state !== 'playing') { prevAlive = null; prevBalls = null; prevPaddleX = null; return; }

    // パドル走行距離・方向転換・摩擦発熱(スナップショット差分)
    if (V.paddle) {
      const px = V.paddle.x;
      if (prevPaddleX != null) {
        const dx = px - prevPaddleX;
        const adx = Math.abs(dx);
        S.paddleDist += adx;
        const dir = Math.sign(dx);
        if (dir !== 0 && dir !== prevDir) { S.dirReversals++; prevDir = dir; }
        if (dir > 0) S.dirAccumR += adx; else if (dir < 0) S.dirAccumL += adx;
        // 摩擦発熱: 高速往復で蓄積
        heat = Math.max(0, heat - dt * 40);
        if (adx > 2) heat += adx * 0.55;
        if (heat > 130 && tempCd <= 0) {
          tempCd = 9;
          tempPanel = { t: 0, dur: 2, kind: 'temp', lines: ['PADDLE TEMP ' + (110 + Math.round(rnd(10, 40))) + '°C', '※冷却は当てにしないでください'] };
        }
        if ((S.dirAccumR + S.dirAccumL) % 40 < 1) saveDirStatsDebounce();
      }
      prevPaddleX = px;
    }

    // ブロック減少→観客/資産/逃げるブロック
    const alive = V.blocks.reduce((a, b) => a + (b.dead ? 0 : 1), 0);
    if (prevAlive != null && alive < prevAlive) onBlocksDestroyed(prevAlive - alive);
    if (prevAlive != null && alive === prevAlive) S.blockCollisions += 0;
    prevAlive = alive;

    // ボール落下はFB.onBallLostフックで検知(二重検知防止)

    // 速度記録&速度違反
    const kmh = maxBallKmh();
    if (kmh > S.maxKmh) S.maxKmh = kmh;
    if (funnyOn && cd['speed'] <= 0 && kmh >= 150 && Math.random() < 0.4) {
      const limit = 120 + ((Math.random() * 3 | 0) * 20);
      const fine = (Math.random() * 8 + 1 | 0) * 50;
      openCd('speed', 30);
      tempPanel = {
        t: 0, dur: 2.8, kind: 'speed',
        lines: ['BALL SPEED LIMIT EXCEEDED', '現在速度: ' + Math.round(kmh) + ' km/h', '制限速度: ' + limit + ' km/h', '反則金: ' + fine + ' POINT', '※実際には徴収されません'],
      };
    }

    // 「あっ」: まさに届かない
    if (funnyOn && cd['ah'] <= 0) {
      for (const b of V.balls) {
        if (b.stuck || b.vy <= 0) continue;
        const outOfReach = b.x < V.paddle.x - 6 || b.x > V.paddle.x + V.paddle.w + 6;
        if (outOfReach && b.y > PADDLE_Y - 46 && b.y < PADDLE_Y + 8) {
          if (openCd('ah', 3.5)) {
            ahs.push({ x: b.x, y: Math.min(b.y, PADDLE_Y - 30), t: 0 });
            break;
          }
        }
      }
    }

    // 吹き出し(労働環境)
    if (funnyOn && V.state === 'playing' && S.playTime > 40 && bubbleCd <= 0 && V.balls.length) {
      const nb = V.balls.find(b => !b.stuck);
      if (nb && Math.random() < 0.35) {
        bubbleCd = rnd(45, 90);
        bubble = { text: pick(['まだやるの?', 'きゅうけいは?', 'かえりたい', '今日長くない?', 'もう100回くらいぶつかってる', '有給ください']), t: 0, dur: 2.2, follow: nb, x: nb.x, y: nb.y - 24 };
      } else bubbleCd = 15;
    }

    if (funnyOn) {
      tickLastBlockPanic();
      if (panic) updatePanic(dt);
      // ランダムイベント
      randomEvTimer -= dt;
      if (randomEvTimer <= 0) {
        randomEvTimer = rnd(32, 60);
        if (!results && !assets && !giant && !panic) pick(RANDOM_EVENTS)();
      }
      // 資産棚卸し(低確率/定時間)
      if (!assets && randomAssetTimer <= 0) {
        randomAssetTimer = rnd(120, 260);
        if (V.blocks.length > 6 && !giant && !panic) startAssetAudit();
      }
      randomAssetTimer -= dt;
    }

    checkAch();
  }
  function saveDirStatsDebounce() { if (saveT > performance.now()) return; saveT = performance.now() + 3000; saveLS('breakout_dirs_v2', { accumL: S.dirAccumL, accumR: S.dirAccumR }); }
  let saveT = 0;

  // ---------- 公開フック本体 ----------
  function onStageClear() {
    Ach.unlock('clear');
    if (stageLosses === 0) Ach.unlock('zeroAccident');
    stageLosses = 0;
  }
  function onGameOver() { stageLosses = 0; if (funnyOn) showResults('lose'); }
  function onWin() { if (funnyOn) showResults('win'); }
  function onReset() { results = null; panic = null; assets = null; giant = null; bubble = null; stageLosses = 0; }
  function spawnCrowdForced() { crowd = { t: 0, dur: 4, count: 8, big: true }; }

  // ---------- 描画 ----------
  function rr(x, y, w, h, r, fill) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); if (fill) { g.fillStyle = fill; g.fill(); } }
  function line(x, y, w, text, size, color, bold) {
    g.font = (bold ? 'bold ' : '') + (size || 13) + 'px sans-serif';
    g.fillStyle = color || '#fff'; g.textBaseline = 'top'; g.textAlign = 'left';
    g.fillText(text, x, y);
    return size || 13;
  }

  function draw() {
    g.clearRect(0, 0, W, H);
    const t = performance.now() / 1000;

    if (!funnyOn) {
      g.globalAlpha = 0.5;
      g.font = '11px sans-serif'; g.fillStyle = '#9ecbff'; g.textAlign = 'right'; g.textBaseline = 'top';
      g.fillText('N: 変な演出 OFF', W - 10, H - 18);
      g.globalAlpha = 1;
      drawBadges();
      return;
    }

    // あっ
    for (const a of ahs) {
      const k = 1 - a.t / 0.6;
      g.globalAlpha = clamp(k, 0, 1);
      g.font = 'bold 30px sans-serif'; g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.shadowColor = '#000'; g.shadowBlur = 6;
      g.fillText('あっ', a.x, a.y);
      g.shadowBlur = 0; g.globalAlpha = 1;
    }
    g.textAlign = 'left';

    // ボールの吹き出し
    if (bubble) {
      const a = clamp(1 - bubble.t / bubble.dur, 0, 1);
      const w = 12 + bubble.text.length * 11;
      g.globalAlpha = 0.92 * a;
      rr(bubble.x - w / 2, bubble.y - 16, w, 22, 8, 'rgba(255,255,255,0.92)');
      g.beginPath(); g.moveTo(bubble.x - 4, bubble.y + 6); g.lineTo(bubble.x + 4, bubble.y + 6); g.lineTo(bubble.x, bubble.y + 11); g.closePath();
      g.fillStyle = 'rgba(255,255,255,0.92)'; g.fill();
      g.fillStyle = '#101820'; g.font = '11px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(bubble.text, bubble.x, bubble.y - 5);
      g.globalAlpha = 1; g.textAlign = 'left';
    }

    // ボールの顔
    if (faceT > 0) {
      for (const b of V.balls) {
        if (b.stuck) continue;
        g.font = 'bold 10px sans-serif'; g.textAlign = 'center'; g.fillStyle = '#101820';
        g.fillText('・ω・', b.x, b.y - 1);
      }
      g.textAlign = 'left';
    }

    // 資産番号
    if (assets) {
      g.font = '9px monospace'; g.textAlign = 'center'; g.fillStyle = 'rgba(255,255,255,0.75)';
      for (const [bl, num] of assets.map) {
        if (bl.dead) continue;
        g.fillText('ASSET-' + ('0000' + num).slice(-4), bl.x + bl.w / 2, bl.y + bl.h / 2 - 4);
      }
      g.textAlign = 'left';
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(0, 10, W, 20);
      g.fillStyle = '#ffe14a'; g.font = 'bold 12px sans-serif'; g.textAlign = 'center';
      g.fillText('資産棚卸し実施中', W / 2, 16); g.textAlign = 'left'; g.fillStyle = '#fff';
    }

    // 観客
    if (crowd) {
      g.textAlign = 'center'; g.font = '13px sans-serif';
      for (let i = 0; i < crowd.count; i++) {
        const x = 30 + i * 26 + rnd(-1, 1);
        const jump = Math.abs(Math.sin(t * (6 + i) + i)) * (crowd.big ? 10 : 5);
        g.fillText(crowd.big && i % 3 === 0 ? '🙌' : '👏', x, H - 22 - jump);
      }
      if (crowd.big) { g.fillStyle = '#ffe14a'; g.font = 'bold 13px sans-serif'; g.fillText('👏👏👏', W / 2, H - 60 + Math.sin(t * 8) * 4); }
      g.textAlign = 'left';
    }

    // 定期清掃(ワイパー)
    if (wiper) {
      const k = wiper.t / wiper.dur;
      const x = k * (W + 240) - 120;
      g.save();
      g.globalAlpha = 0.5;
      rr(x, H * 0.45, 200, 10, 5, 'rgba(154,205,255,0.7)');
      g.font = '20px sans-serif'; g.fillText('🧽', x + 90, H * 0.45 - 22);
      g.restore();
    }
    // 現場確認(ヘルメット)
    if (helmet) {
      const side = helmet.side === 'L' ? -1 : 1;
      const x = side === -1 ? 8 - 26 + Math.min(1, helmet.t * 2) * 16 : W - 8 + 26 - Math.min(1, helmet.t * 2) * 16;
      g.font = '22px sans-serif'; g.fillText('👷', x, PADDLE_Y - 60);
    }
    // ボール点検中(レンチ)
    if (wrench) {
      for (const b of V.balls) {
        if (b.stuck) continue;
        g.font = '16px sans-serif'; g.fillText('🔧', b.x + 10, b.y - 10);
      }
    }

    // 巨大ボール
    if (giant) {
      const k = giant.t / giant.dur;
      const scale = 1 + 3.4 * Math.sin(Math.min(1, k * 3) * Math.PI / 2) * (1 - k * 0.3);
      g.save();
      g.globalAlpha = 0.85 * (1 - Math.pow(k, 2));
      g.beginPath(); g.arc(giant.x, giant.y, 7 * scale, 0, Math.PI * 2);
      g.fillStyle = 'rgba(180,225,255,0.75)'; g.fill();
      g.strokeStyle = '#b4e1ff'; g.lineWidth = 2; g.stroke();
      g.restore();
    }

    // バナー(中央上)
    if (banner) {
      const a = clamp(1 - Math.pow(banner.t / banner.dur, 3), 0, 1);
      g.globalAlpha = a;
      g.font = 'bold ' + banner.size + 'px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'top';
      g.shadowColor = '#000'; g.shadowBlur = 8;
      g.fillStyle = '#ffe14a';
      g.fillText(banner.text, W / 2, 124);
      if (banner.sub) { g.font = '12px sans-serif'; g.fillStyle = '#fff'; g.fillText(banner.sub, W / 2, 124 + banner.size + 6); }
      g.shadowBlur = 0; g.globalAlpha = 1; g.textAlign = 'left'; g.textBaseline = 'top';
    }

    // 小さな浮遊テキスト
    for (const f of floats) {
      const a = clamp(1 - f.t / f.dur, 0, 1);
      g.globalAlpha = a; g.font = f.size + 'px monospace'; g.fillStyle = f.color; g.textAlign = 'center';
      g.fillText(f.text, f.x, f.y);
    }
    g.globalAlpha = 1; g.textAlign = 'left';

    // トースト(右上)
    let ty = 12;
    g.textBaseline = 'top';
    for (const s of toasts) {
      const a = clamp(Math.min(s.t / 0.2, (s.dur - s.t) / 0.4), 0, 1);
      g.globalAlpha = a;
      g.font = 'bold ' + s.size + 'px sans-serif'; g.textAlign = 'right';
      g.shadowColor = '#000'; g.shadowBlur = 5;
      g.fillStyle = s.color;
      g.fillText(s.text, W - 12, ty);
      g.shadowBlur = 0;
      ty += s.size + 8;
    }
    g.globalAlpha = 1; g.textAlign = 'left';

    // PADDLE TEMP / SPEED の枠(中央上寄り)
    if (tempPanel) {
      const a = clamp(Math.min(tempPanel.t / 0.15, (tempPanel.dur - tempPanel.t) / 0.4), 0, 1);
      const w = 260, h = tempPanel.lines.length * 17 + 16;
      const x = W / 2 - w / 2, y = 168;
      g.globalAlpha = 0.88 * a;
      rr(x, y, w, h, 10, 'rgba(8,14,30,0.92)');
      g.strokeStyle = tempPanel.kind === 'speed' ? '#ff9f45' : '#ff5252';
      g.lineWidth = 2; g.stroke();
      let yy = y + 8;
      tempPanel.lines.forEach((txt, i) => {
        g.font = (i === 0 ? 'bold 14px' : '12px') + ' sans-serif';
        g.fillStyle = i === 0 ? (tempPanel.kind === 'speed' ? '#ff9f45' : '#ff5252') : '#cfe3ff';
        g.textAlign = 'center';
        g.fillText(txt, W / 2, yy);
        yy += 17;
      });
      g.globalAlpha = 1; g.textAlign = 'left';
    }

    drawResults();
    drawBadges();
    requestAnimationFrame(draw);
  }

  function drawResults() {
    if (!results) return;
    const panW = 430, panH = results.mode === 'lose' ? 330 : 300;
    const x = W / 2 - panW / 2, y = H / 2 - panH / 2 - 10;
    g.globalAlpha = 0.94;
    rr(x, y, panW, panH, 12, 'rgba(10,16,32,0.95)');
    g.strokeStyle = results.mode === 'lose' ? '#ff5d5d' : '#8bf05a'; g.lineWidth = 2; g.stroke();
    g.globalAlpha = 1;
    // タイトル
    g.font = 'bold 20px sans-serif'; g.fillStyle = results.mode === 'lose' ? '#ff5d5d' : '#8bf05a'; g.textAlign = 'center'; g.textBaseline = 'top';
    g.fillText(results.mode === 'lose' ? '事故報告書' : '労務評価書', W / 2, y + 10);
    g.textAlign = 'left';
    let yy = y + 40;
    if (results.mode === 'lose') {
      for (const [k, v] of results.rows) {
        g.font = '12px sans-serif'; g.fillStyle = '#8ea6c8'; g.fillText(k + ':', x + 16, yy);
        g.fillStyle = '#e6f0ff'; g.fillText(v, x + 120, yy);
        yy += 19;
      }
      yy += 8;
    }
    // 謎評価
    g.font = 'bold 13px sans-serif'; g.fillStyle = '#ffe14a'; g.fillText('謎評価', x + 16, yy);
    yy += 18;
    let gx = x + 16;
    for (const gr of results.grades) {
      g.font = '11px sans-serif'; g.fillStyle = '#cfe3ff';
      g.fillText(gr.k, gx, yy);
      g.font = 'bold 13px sans-serif'; g.fillStyle = '#8bf05a';
      g.fillText(gr.g, gx, yy + 13);
      gx += 68;
      if (gx > x + panW - 70) { gx = x + 16; yy += 30; }
    }
    yy += 34;
    // 総評
    g.font = '12px sans-serif'; g.fillStyle = '#e6f0ff';
    g.fillText(results.comment, x + 16, yy);
    yy += 22;
    // 無意味統計(先頭3行)
    for (let i = 0; i < Math.min(4, results.stats.length); i++) {
      g.font = '10px monospace'; g.fillStyle = '#9ecbff';
      g.fillText(results.stats[i], x + 16, yy); yy += 13;
    }
    for (const n of results.noise.slice(0, 2)) {
      g.font = '10px monospace'; g.fillStyle = '#7d8ea8';
      g.fillText(n, x + 16, yy); yy += 13;
    }
    g.font = '11px sans-serif'; g.fillStyle = '#8ea6c8'; g.textAlign = 'center';
    g.fillText('「再発防止して再開」: Enter / Space / クリック', W / 2, y + panH - 18);
    g.textAlign = 'left';
  }

  function drawBadges() {
    let y = H - 30;
    for (const b of badges) {
      const a = clamp(b.life / 0.6, 0, 1);
      g.globalAlpha = a;
      g.font = 'bold 10px monospace'; g.fillStyle = '#ffe14a'; g.textAlign = 'left';
      g.fillText('ACHIEVEMENT UNLOCKED', 12, y - 12);
      g.font = 'bold 12px sans-serif'; g.fillStyle = '#fff';
      g.fillText('「' + b.t + '」 ' + b.d, 12, y);
      g.globalAlpha = 1;
      y -= 40;
    }
    g.textAlign = 'left';
  }

  requestAnimationFrame(draw);

  // 公開
  window.FB = {
    onUpdate, onPaddleHit, onWallHit, onStageClear, onGameOver, onWin, onReset,
    onBlocksDestroyed, onBallLost,
    trigger(id) {
      const map = {
        speedViolation: () => { openCd('speed', 0); const kmh = Math.max(maxBallKmh(), 284); tempPanel = { t: 0, dur: 2.8, kind: 'speed', lines: ['BALL SPEED LIMIT EXCEEDED', '現在速度: ' + Math.round(kmh) + ' km/h', '制限速度: ' + 120 + ' km/h', '反則金: ' + (Math.random() * 7 + 1 | 0) * 50 + ' POINT', '※実際には徴収されません'] }; },
        lastBlockPanic: () => tickLastBlockPanic(),
        giantBall: () => runGiantBall(),
        assetAudit: () => startAssetAudit(),
        crowd: () => spawnCrowdForced(),
        ballBubble: () => { const nb = V.balls.find(b => !b.stuck); if (nb) bubble = { text: 'きゅうけいは?', t: 0, dur: 2.2, x: nb.x, y: nb.y - 24, follow: nb }; },
        randomEvent: () => pick(RANDOM_EVENTS)(),
        report: () => { showResults('lose'); },
        ah: () => { const nb = V.balls.find(b => !b.stuck); ahs.push({ x: nb ? nb.x : W / 2, y: PADDLE_Y - 40, t: 0 }); },
        paddleTemp: () => { heat = 0; tempPanel = { t: 0, dur: 2, kind: 'temp', lines: ['PADDLE TEMP 132°C', '※冷却は当てにしないでください'] }; },
        face: () => { faceT = 4; },
      };
      if (map[id]) map[id]();
    },
    debugState() {
      return {
        on: funnyOn, state: V.state, banner: banner && banner.text, toasts: toasts.map(t => t.text),
        results: !!results, panic: !!panic, assets: !!assets, giant: !!giant, crowd: !!crowd,
        temp: tempPanel && tempPanel.lines[0], bubble: bubble && bubble.text, ahs: ahs.length, face: faceT > 0,
        ach: unlocked, heat: Math.round(heat), maxKmh: Math.round(S.maxKmh),
      };
    },
  };
  window.triggerFunnyEvent = id => window.FB.trigger(id);
})();
