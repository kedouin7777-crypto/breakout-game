'use strict';
/* ============================================================
   FUNNY SYSTEM for NEON ORBIT BREAKER（旧版 正と版・非侵入オーバーレイ）
   game.jsは改変せずグローバル状態を読むだけ。NキーでON/OFF。
   演出: 速度違反 / 「あっ」 / 事故報告書 / 資産棚卸し / 救済ブラックホール
   ============================================================ */
(function () {
  const base = document.getElementById('game');
  if (!base) return;
  const W = base.width, H = base.height;
  const EDGE_M = 12, BALL_R = 7, FIELD_CY = 240;

  function loadLS(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function saveLS(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const pick = arr => arr[(Math.random() * arr.length) | 0];

  let funnyOn = loadLS('orbit_funny_v1', true) !== false;
  function toggleFunny(v) {
    funnyOn = v == null ? !funnyOn : v;
    saveLS('orbit_funny_v1', funnyOn);
    toast('変な演出: ' + (funnyOn ? 'ON' : 'OFF'), 2, 15);
  }
  addEventListener('keydown', e => { if (e.key === 'n' || e.key === 'N') toggleFunny(); });

  // ---------- オーバーレイcanvas ----------
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  cv.style.cssText = 'position:fixed;pointer-events:none;z-index:60;';
  document.body.appendChild(cv);
  const g = cv.getContext('2d');
  function fit() { const r = base.getBoundingClientRect(); cv.style.left = r.left + 'px'; cv.style.top = r.top + 'px'; cv.style.width = r.width + 'px'; cv.style.height = r.height + 'px'; }
  addEventListener('resize', fit); fit();

  // ---------- 共有表示 ----------
  let banner = null;
  const toasts = [];
  let tempPanel = null;
  let report = null;   // 事故報告書
  let audit = null;    // 資産棚卸し
  const ahs = [];      // 「あっ」
  const floats = [];
  let vortex = null;   // 救済ブラックホール {t,dur,x,y,ball,fired}

  let speedCdUntil = 0, ahCdUntil = 0, auditCdUntil = 0, rescueCdUntil = 0;

  function toast(text, dur, size, color) { toasts.push({ text, t: 0, dur: dur || 2.6, size: size || 14, color: color || '#ffe14a' }); if (toasts.length > 4) toasts.shift(); }
  function bannerShow(text, sub, dur, size) { banner = { text, sub: sub || '', t: 0, dur: dur || 2.2, size: size || 26 }; }

  // ---------- 統計 ----------
  const S = { playTime: 0, losses: 0, maxKmh: 0 };
  let prevBalls = null;
  let lastBallPos = null;
  let lastBlockTouch = performance.now();

  // ---------- ゲーム状態(旧版グローバルの参照) ----------
  function snap() {
    try {
      const s = { G: G, balls: balls, blocks: blocks, paddle: paddle };
      if (!s.G || !Array.isArray(s.balls) || !Array.isArray(s.blocks) || !s.paddle) return null;
      return s;
    } catch (e) { return null; }
  }

  // ---------- イベント実装 ----------
  const kmhOf = b => Math.hypot(b.vx, b.vy) * 0.42;

  function onBallLost(pos) {
    S.losses++;
    if (funnyOn) showReport(pos);
  }

  function showReport(pos) {
    const FIXES = ['縁に気をつけて受け止める', '次回は頑張る', 'パドルを適切な縁に配置する', '気合で対応する', '同様事故の再発防止に努める', '特に対策なし'];
    const spots = ['上縁付近', '下縁付近', '左縁付近', '右縁付近'];
    let edge = '未記録';
    if (pos) {
      const cands = [
        ['上縁付近', Math.abs(pos.y - EDGE_M)],
        ['下縁付近', Math.abs(pos.y - (H - EDGE_M))],
        ['左縁付近', Math.abs(pos.x - EDGE_M)],
        ['右縁付近', Math.abs(pos.x - (W - EDGE_M))],
      ];
      cands.sort((a, b) => a[1] - b[1]);
      if (cands[0][1] < 60) edge = cands[0][0];
    }
    const t = new Date();
    const hh = ('0' + t.getHours()).slice(-2), mm = ('0' + t.getMinutes()).slice(-2), ss = ('0' + t.getSeconds()).slice(-2);
    report = {
      t: 0, dur: 4.6,
      lines: [
        '■ 事故報告書', '',
        '事故種別', '球体脱落',
        '発生時刻', hh + ':' + mm + ':' + ss,
        '今回の脱落回数', S.losses + ' 回目',
        '推定地点', edge,
        '対策', pick(FIXES), '',
        '※当報告書は提出対象外です',
      ],
    };
  }

  function runAudit() {
    try {
      const alive = (blocks || []).filter(b => b.alive && b.type !== 'indestructible');
      if (alive.length === 0) { toast('棚卸し対象がありません', 2, 13, '#9ecbff'); return; }
      const target = alive[(Math.random() * alive.length) | 0];
      audit = { t: 0, dur: 4, bl: target, num: 1000 + (Math.random() * 8999 | 0) };
      bannerShow('資産棚卸し実施中', '※ゲームには一切関係ありません', 2.6, 22);
      toast('※新ブロック帳票の標準を生成中…', 2.4, 11, '#9ecbff');
    } catch (e) {}
  }

  function rescueVortex() {
    const s = snap(); if (!s) return false;
    const nb = s.balls.find(b => !b.stuck);
    if (!nb) return false;
    const sp = Math.hypot(nb.vx, nb.vy) || 1;
    const x = clamp(nb.x + nb.vx / sp * 130, 60, W - 60);
    const y = clamp(nb.y + nb.vy / sp * 130, 60, H - 60);
    vortex = { t: 0, dur: 2, x, y, ball: nb, fired: false };
    bannerShow('ESCAPE SUPPORT', '', 1.6, 22);
    toast('10秒以上ブロックに触れていないため救済ブラックホールを配置しました', 3, 12, '#c77dff');
    return true;
  }

  // ---------- 更新 ----------
  let last = performance.now();
  function tick() {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.033);
    last = now;
    const s = snap();

    // 表示の寿命管理
    if (banner) { banner.t += dt; if (banner.t >= banner.dur) banner = null; }
    for (let i = toasts.length - 1; i >= 0; i--) { toasts[i].t += dt; if (toasts[i].t > toasts[i].dur) toasts.splice(i, 1); }
    for (let i = ahs.length - 1; i >= 0; i--) { ahs[i].t += dt; if (ahs[i].t > 0.8) ahs.splice(i, 1); }
    for (let i = floats.length - 1; i >= 0; i--) { const f = floats[i]; f.t += dt; f.y -= 18 * dt; if (f.t > f.dur) floats.splice(i, 1); }
    if (tempPanel) { tempPanel.t += dt; if (tempPanel.t >= tempPanel.dur) tempPanel = null; }
    if (report) { report.t += dt; if (report.t >= report.dur) report = null; }
    if (audit) { audit.t += dt; if (audit.t >= audit.dur) audit = null; }

    if (s) {
      // ボール消失(事故)検知
      if (prevBalls != null && s.balls.length === 0 && prevBalls > 0 && lastBallPos) {
        const pos = lastBallPos; lastBallPos = null;
        onBallLost(pos);
      }
      prevBalls = s.balls.length;
      const flying = s.balls.find(b => !b.stuck);
      if (flying) {
        lastBallPos = { x: flying.x, y: flying.y };
        updateEvents(dt, s, flying, now);
      }
    }

    draw();
    requestAnimationFrame(tick);
  }

  function updateEvents(dt, s, nb, now) {
    const playing = s.G.state === 'play';
    if (playing) S.playTime += dt;

    // 速度記録&速度違反
    const kmh = kmhOf(nb);
    if (kmh > S.maxKmh) S.maxKmh = kmh;
    if (funnyOn && playing && now >= speedCdUntil && kmh >= 150) {
      const limit = 120 + ((Math.random() * 3 | 0) * 20);
      const fine = (Math.random() * 8 + 1 | 0) * 50;
      speedCdUntil = now + 30000;
      tempPanel = { t: 0, dur: 2.8, lines: ['BALL SPEED LIMIT EXCEEDED', '現在速度: ' + Math.round(kmh) + ' km/h', '制限速度: ' + limit + ' km/h', '反則金: ' + fine + ' POINT', '※実際には徴収されません'] };
    }

    // 「あっ」: 縁から落ちようとしてボール近くにパドルがいない
    if (funnyOn && playing && now >= ahCdUntil) {
      const nearEdge = Math.abs(nb.x - EDGE_M) < 22 || Math.abs(nb.x - (W - EDGE_M)) < 22 ||
                       Math.abs(nb.y - EDGE_M) < 22 || Math.abs(nb.y - (H - EDGE_M)) < 22;
      if (nearEdge) {
        let pd = Infinity;
        try {
          const p = s.paddle, pp = paddlePos(p.edge, p.t);
          pd = Math.hypot(pp.x - nb.x, pp.y - nb.y);
        } catch (e) {}
        if (pd > 190) {
          ahCdUntil = now + 3500;
          ahs.push({ x: nb.x, y: nb.y - 26, t: 0 });
        }
      }
    }

    // 資産棚卸し(プレイ90秒以降、低確率)
    if (funnyOn && playing && S.playTime > 90 && now >= auditCdUntil && Math.random() < dt * 0.05) {
      auditCdUntil = now + 90000;
      runAudit();
    }

    // 停滞救済: 10秒以上ブロック無接触
    if (playing) {
      let touched = false;
      for (const bl of s.blocks) {
        if (!bl.alive) continue;
        if (nb.x + BALL_R > bl.x - 3 && nb.x - BALL_R < bl.x + bl.w + 3 &&
            nb.y + BALL_R > bl.y - 3 && nb.y - BALL_R < bl.y + bl.h + 3) { touched = true; break; }
      }
      if (touched) lastBlockTouch = now;
      if (funnyOn && now - lastBlockTouch >= 10000 && now >= rescueCdUntil && !vortex) {
        if (rescueVortex()) { rescueCdUntil = now + 35000; lastBlockTouch = now; }
      }
    }

    // 救済ブラックホール進行(時間の0.55で方向転換=再放出)
    if (vortex) {
      vortex.t += dt;
      if (vortex.t >= vortex.dur * 0.55 && !vortex.fired) {
        vortex.fired = true;
        const nb0 = vortex.ball;
        if (nb0 && !nb0.stuck) {
          const dx = W / 2 - nb0.x, dy = FIELD_CY - nb0.y;
          const dd = Math.hypot(dx, dy) || 1;
          const sp0 = Math.hypot(nb0.vx, nb0.vy) || 1;
          const spN = Math.max(sp0, 330);
          nb0.vx = dx / dd * spN; nb0.vy = dy / dd * spN;
          nb0.trail.length = 0;
        }
        floats.push({ x: vortex.x, y: vortex.y - 22, text: '再放出', t: 0, dur: 1.2, color: '#c77dff', size: 13 });
      }
      if (vortex.t >= vortex.dur) vortex = null;
    }
  }

  // ---------- 描画 ----------
  function draw() {
    g.clearRect(0, 0, W, H);
    if (!funnyOn) return;

    // 救済ブラックホール(踊る渦)
    if (vortex) {
      const f = vortex.t;
      const alpha = Math.min(1, f * 3) * (vortex.t < vortex.dur - 0.4 ? 1 : (vortex.dur - vortex.t) / 0.4);
      g.save();
      g.globalAlpha = 0.85 * Math.max(0, alpha);
      const grad = g.createRadialGradient(vortex.x, vortex.y, 2, vortex.x, vortex.y, 58);
      grad.addColorStop(0, '#1a0a2e');
      grad.addColorStop(0.35, '#3a1466');
      grad.addColorStop(1, 'rgba(199,125,255,0)');
      g.fillStyle = grad;
      g.beginPath(); g.arc(vortex.x, vortex.y, 58, 0, 7); g.fill();
      g.strokeStyle = '#c77dff'; g.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const r = 14 + i * 14 - (f * 26 % 14);
        const a0 = f * 5 + i * 2;
        g.beginPath();
        g.arc(vortex.x, vortex.y, Math.max(2, r), a0, a0 + 3.1);
        g.stroke();
      }
      g.fillStyle = '#f3d3ff';
      g.beginPath(); g.arc(vortex.x, vortex.y, 5, 0, 7); g.fill();
      g.restore();
      g.fillStyle = 'rgba(199,125,255,0.9)';
      g.font = '11px sans-serif';
      g.textAlign = 'center';
      g.fillText('救済ブラックホール', vortex.x, vortex.y - 66);
    }

    // 「あっ」
    g.textAlign = 'center';
    for (const a of ahs) {
      const k = a.t / 0.8;
      g.globalAlpha = 1 - k;
      g.fillStyle = '#ffe14a';
      g.font = (13 + k * 6 | 0) + 'px sans-serif';
      g.fillText('あっ', a.x, a.y - k * 12);
      g.globalAlpha = 1;
    }

    // 浮遊テキスト
    for (const f of floats) {
      g.globalAlpha = 1 - f.t / f.dur;
      g.fillStyle = f.color;
      g.font = (f.size || 12) + 'px sans-serif';
      g.fillText(f.text, f.x, f.y);
      g.globalAlpha = 1;
    }

    // バナー
    if (banner) {
      const k = banner.t / banner.dur;
      g.globalAlpha = Math.min(1, k * 8) * Math.min(1, (1 - k) * 8 + 0.2);
      g.fillStyle = 'rgba(10,8,26,0.82)';
      const bw = Math.max(300, banner.text.length * banner.size * 1.05);
      g.fillRect(W / 2 - bw / 2, H * 0.24, bw, banner.size + 26);
      g.fillStyle = '#ffe14a';
      g.font = 'bold ' + banner.size + 'px sans-serif';
      g.fillText(banner.text, W / 2, H * 0.24 + banner.size + 6);
      if (banner.sub) {
        g.fillStyle = '#9ecbff';
        g.font = '12px sans-serif';
        g.fillText(banner.sub, W / 2, H * 0.24 + banner.size + 22);
      }
      g.globalAlpha = 1;
    }

    // トースト
    toasts.forEach((t, i) => {
      const k = t.t / t.dur;
      const a = Math.min(1, k * 6) * Math.min(1, (1 - k) * 6);
      g.globalAlpha = Math.max(0, a);
      g.font = t.size + 'px sans-serif';
      g.fillStyle = t.color;
      g.textAlign = 'right';
      g.fillText(t.text, W - 14, H - 12 - (toasts.length - 1 - i) * 18);
      g.globalAlpha = 1;
    });
    g.textAlign = 'center';

    // 速度違反パネル
    if (tempPanel) {
      const k = tempPanel.t / tempPanel.dur;
      const a = Math.min(1, k * 8) * Math.min(1, (1 - k) * 8);
      g.globalAlpha = Math.max(0, a);
      const x = 12, y = 52;
      g.fillStyle = 'rgba(58,16,16,0.92)';
      g.strokeStyle = '#ff8080';
      g.fillRect(x, y, 220, 76);
      g.strokeRect(x + 0.5, y + 0.5, 220, 76);
      g.fillStyle = '#ffb8b8';
      g.font = 'bold 13px sans-serif';
      g.textAlign = 'left';
      g.fillText(tempPanel.lines[0], x + 10, y + 18);
      g.font = '11px monospace';
      g.fillText(tempPanel.lines.slice(1).join('\n'), x + 10, y + 34);
      g.globalAlpha = 1;
      g.textAlign = 'center';
    }

    // 資産棚卸し
    if (audit && audit.bl && audit.bl.alive) {
      const bl = audit.bl;
      const k = audit.t / audit.dur;
      g.globalAlpha = Math.max(0, Math.min(1, k * 8) * Math.min(1, (1 - k) * 8));
      g.strokeStyle = '#ffe14a';
      g.lineWidth = 1.5;
      const spr = 6 + Math.sin(audit.t * 9) * 3;
      g.strokeRect(bl.x - spr, bl.y - spr, bl.w + spr * 2, bl.h + spr * 2);
      g.fillStyle = '#1c1230';
      g.fillRect(bl.x + bl.w + 6, bl.y, 118, 30);
      g.fillStyle = '#ffe14a';
      g.font = '11px monospace';
      g.textAlign = 'left';
      g.fillText('資産番号 ' + audit.num, bl.x + bl.w + 12, bl.y + 13);
      g.fillText('照合中… 保留', bl.x + bl.w + 12, bl.y + 26);
      g.globalAlpha = 1;
      g.textAlign = 'center';
    }

    // 事故報告書
    if (report) {
      const k = report.t / report.dur;
      const a = Math.min(1, k * 8) * Math.min(1, (1 - k) * 12);
      g.globalAlpha = Math.max(0, a);
      const rx = W / 2 - 150, ry = H * 0.16, rw = 300, rh = 248;
      g.fillStyle = '#141024';
      g.strokeStyle = '#8fa7ff';
      g.fillRect(rx, ry, rw, rh);
      g.strokeRect(rx + 0.5, ry + 0.5, rw, rh);
      g.textAlign = 'left';
      for (let i = 0; i < report.lines.length; i++) {
        const line = report.lines[i];
        if (!line) continue;
        const isHead = i === 0;
        const isKey = i % 2 === 1 && i > 2;
        const yy = ry + 24 + i * 17;
        if (isHead) { g.fillStyle = '#8fa7ff'; g.font = 'bold 15px sans-serif'; g.fillText(line, rx + 18, yy); }
        else if (isKey) { g.fillStyle = '#8fa7ff'; g.font = '11px monospace'; g.fillText(line, rx + 18, yy); }
      }
      // 値
      g.fillStyle = '#dfe6ff';
      g.font = '12px monospace';
      for (let i = 3; i < report.lines.length; i += 2) {
        g.fillText(report.lines[i + 1] || '', rx + 130, ry + 24 + i * 17);
      }
      g.globalAlpha = 1;
      g.textAlign = 'center';
    }
  }

  // ---------- 公開 ----------
  function state() {
    return {
      on: funnyOn, state: (snap() && snap().G) ? snap().G.state : '?',
      losses: S.losses, maxKmh: Math.round(S.maxKmh),
      banner: banner && banner.text, toasts: toasts.map(t => t.text),
      report: !!report, audit: !!audit, vortex: !!vortex, ahs: ahs.length,
      rescue: { age: Math.round(performance.now() - lastBlockTouch), cd: Math.max(0, Math.round((rescueCdUntil - performance.now()) / 100) / 10) },
    };
  }
  window.OB = {
    trigger(id) {
      const map = {
        report: () => { if (lastBallPos) showReport(lastBallPos); else { showReport(null); } },
        ah: () => { const s = snap(); const nb = s && s.balls.find(b => !b.stuck); if (nb) ahs.push({ x: nb.x, y: nb.y - 26, t: 0 }); },
        audit: () => { auditCdUntil = 0; runAudit(); },
        speedViolation: () => { const s = snap(); const nb = s && s.balls.find(b => !b.stuck); if (nb) tempPanel = { t: 0, dur: 2.8, lines: ['BALL SPEED LIMIT EXCEEDED', '現在速度: ' + Math.round(kmhOf(nb)) + ' km/h', '制限速度: 120 km/h', '反則金: 150 POINT', '※実際には徴収されません'] }; },
        rescueBh: () => { lastBlockTouch = performance.now() - 20000; },
        toggle: () => toggleFunny(),
      };
      if (map[id]) map[id]();
    },
    debugState: state,
  };
  window.triggerFunnyEvent = id => window.OB.trigger(id);
  window.FB = { debugState: state, trigger: id => window.OB.trigger(id) };

  tick();
})();
