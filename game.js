/* 对半分 —— 竖屏上下分屏对抗，纯前端，无外部依赖 */
(function () {
  'use strict';

  var WIN_SCORE = 7;

  var stageEl = document.getElementById('stage');
  var canvas = document.getElementById('field');
  var ctx = canvas.getContext('2d');
  var hudTop = document.getElementById('hudTop');
  var hudBot = document.getElementById('hudBottom');
  var scoreTopEl = document.getElementById('scoreTop');
  var scoreBotEl = document.getElementById('scoreBot');
  var toastEl = document.getElementById('toast');
  var flashEl = document.getElementById('flash');
  var overlayEl = document.getElementById('overlay');
  var ovKicker = document.getElementById('ovKicker');
  var ovTitle = document.getElementById('ovTitle');
  var ovSub = document.getElementById('ovSub');
  var ovHint = document.getElementById('ovHint');
  var ovActs = document.getElementById('ovActs');
  var ovFoot = document.getElementById('ovFoot');
  var bootEl = document.getElementById('boot');

  var W = 0;
  var H = 0;
  var DPR = 1;

  var state = 'menu';
  var mode = 'duo';
  var scoreTop = 0;
  var scoreBot = 0;

  var geo = {
    padH: 10, padW: 100, padInset: 40,
    ballR: 9, baseSpeed: 480, maxSpeed: 1100
  };

  var pads = {
    top: { x: 0, y: 0, w: 100, h: 10, pointer: null, glow: 0 },
    bot: { x: 0, y: 0, w: 100, h: 10, pointer: null, glow: 0 }
  };

  var ball = {
    x: 0, y: 0, prevY: 0, vx: 0, vy: 0, r: 9, speed: 0,
    trail: []
  };

  var particles = [];
  var rally = 0;
  var keys = { botL: false, botR: false, topL: false, topR: false };
  var KEYMAP = {
    ArrowLeft: 'botL', ArrowRight: 'botR',
    a: 'topL', d: 'topR', A: 'topL', D: 'topR'
  };
  var ai = { err: 0, timer: 0, speed: 0 };
  var serveTimer = 0;
  var serveDir = 1;
  var lastTime = 0;
  var acc = 0;
  var dirty = true;
  var rafId = 0;
  var pausedFrom = null;
  var audio = null;
  var soundOn = true;

  var STEP = 1 / 120;

  function $(id) { return document.getElementById(id); }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function rand(a, b) { return a + Math.random() * (b - a); }

  /* ---------------- 尺寸 ---------------- */

  function layout() {
    var rect = canvas.getBoundingClientRect();
    W = Math.max(200, Math.round(rect.width));
    H = Math.max(240, Math.round(rect.height));
    DPR = clamp(window.devicePixelRatio || 1, 1, 2.5);
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    geo.padH = clamp(H * 0.016, 7, 13);
    geo.padW = clamp(W * 0.24, 54, 150);
    geo.padInset = clamp(H * 0.088, 42, 88);
    geo.ballR = clamp(W * 0.023, 6, 12);
    geo.baseSpeed = H * 0.60;
    geo.maxSpeed = geo.baseSpeed * 2.3;

    pads.top.w = pads.bot.w = geo.padW;
    pads.top.h = pads.bot.h = geo.padH;
    pads.top.y = geo.padInset;
    pads.bot.y = H - geo.padInset;

    pads.top.x = clamp(pads.top.x || W / 2, geo.padW / 2, W - geo.padW / 2);
    pads.bot.x = clamp(pads.bot.x || W / 2, geo.padW / 2, W - geo.padW / 2);

    ball.r = geo.ballR;
    ball.x = clamp(ball.x || W / 2, ball.r, W - ball.r);
    ball.y = clamp(ball.y || H / 2, ball.r, H - ball.r);
    ai.speed = W * 0.92;
    dirty = true;
  }

  /* ---------------- 音效 ---------------- */

  function ensureAudio() {
    if (!soundOn) { return null; }
    try {
      if (!audio) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) { return null; }
        audio = new AC();
      }
      if (audio.state === 'suspended' && audio.resume) { audio.resume(); }
      return audio;
    } catch (e) { return null; }
  }

  function tone(freq, dur, type, vol, slideTo) {
    var ac = ensureAudio();
    if (!ac) { return; }
    try {
      var t0 = ac.currentTime;
      var osc = ac.createOscillator();
      var gain = ac.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      if (slideTo) { osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur); }
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(vol || 0.08, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    } catch (e) { /* 音频失败不影响玩法 */ }
  }

  /* ---------------- 粒子 ---------------- */

  function burst(x, y, color, count, power) {
    for (var i = 0; i < count; i++) {
      var a = rand(0, Math.PI * 2);
      var s = rand(power * 0.3, power);
      particles.push({
        x: x, y: y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 0,
        max: rand(0.25, 0.55),
        size: rand(1.2, 3),
        color: color
      });
    }
  }

  function stepParticles(dt) {
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.life += dt;
      if (p.life >= p.max) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.92;
      p.vy *= 0.92;
    }
  }

  /* ---------------- 回合 ---------------- */

  function serve(dir) {
    ball.x = W / 2;
    ball.y = H / 2;
    ball.prevY = ball.y;
    ball.speed = geo.baseSpeed;
    var ang = rand(-0.28, 0.28);
    ball.vx = Math.sin(ang) * ball.speed;
    ball.vy = Math.cos(ang) * ball.speed * dir;
    ball.trail.length = 0;
    state = 'serve';
    serveTimer = 0.75;
    serveDir = dir;
    rally = 0;
  }

  function newMatch(keepMode) {
    scoreTop = 0;
    scoreBot = 0;
    updateScore();
    particles.length = 0;
    pads.top.x = W / 2;
    pads.bot.x = W / 2;
    pads.top.glow = pads.bot.glow = 0;
    ai.err = 0;
    ai.timer = 0;
    hideOverlay();
    serve(Math.random() < 0.5 ? -1 : 1);
    tone(520, 0.10, 'triangle', 0.05, 660);
  }

  function scorePoint(who) {
    if (who === 'top') { scoreTop++; } else { scoreBot++; }
    updateScore();
    popHud(who);
    ball.trail.length = 0;

    var color = who === 'top' ? '#45d9c8' : '#ff7a5c';
    burst(ball.x, clamp(ball.y, 8, H - 8), color, 22, 260);
    flashEl.style.transition = 'none';
    flashEl.style.opacity = '0.16';
    void flashEl.offsetWidth;
    flashEl.style.transition = 'opacity 0.28s ease-out';
    flashEl.style.opacity = '0';

    tone(who === 'top' ? 300 : 260, 0.16, 'square', 0.07, 180);

    if (scoreTop >= WIN_SCORE || scoreBot >= WIN_SCORE) {
      state = 'over';
      showResult();
      return;
    }

    toast(who === 'top' ? '上方得分' : (mode === 'solo' ? 'AI 得分' : '下方得分'));
    rally = 0;
    state = 'serve';
    serveTimer = 0.85;
    serveDir = who === 'top' ? 1 : -1;
    ball.vx = 0;
    ball.vy = 0;
    ball.x = W / 2;
    ball.y = H / 2;
    ball.prevY = ball.y;
  }

  function popHud(who) {
    var el = who === 'top' ? hudTop : hudBot;
    el.classList.add('pop');
    window.setTimeout(function () { el.classList.remove('pop'); }, 260);
  }

  function updateScore() {
    scoreTopEl.textContent = String(scoreTop);
    scoreBotEl.textContent = String(scoreBot);
  }

  /* ---------------- 物理 ---------------- */

  function overlapX(pad) {
    return Math.abs(ball.x - pad.x) <= pad.w / 2 + ball.r;
  }

  function bounce(pad, up, color) {
    var hit = clamp((ball.x - pad.x) / (pad.w / 2), -1, 1);
    var ang = hit * 0.85;
    ball.speed = Math.min(ball.speed * 1.035, geo.maxSpeed);
    rally++;
    if (rally === 5 || rally === 10 || rally === 15 || rally === 20) {
      ball.speed = Math.min(ball.speed * 1.16, geo.maxSpeed);
      tone(900, 0.12, 'triangle', 0.05, 1240);
    }
    ball.vx = Math.sin(ang) * ball.speed;
    ball.vy = (up ? -1 : 1) * Math.cos(ang) * ball.speed;
    ball.y = up ? pad.y - pad.h / 2 - ball.r - 0.5 : pad.y + pad.h / 2 + ball.r + 0.5;
    ball.prevY = ball.y;
    pad.glow = 1;
    burst(ball.x, ball.y, color, 7, 150);
    tone(560 + Math.abs(hit) * 180, 0.07, 'square', 0.055, 720);
  }

  function stepBall(dt) {
    ball.prevY = ball.y;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    if (ball.x - ball.r < 0) {
      ball.x = ball.r;
      ball.vx = Math.abs(ball.vx);
      tone(340, 0.05, 'sine', 0.04);
      burst(0, ball.y, '#9fb4bf', 4, 90);
    } else if (ball.x + ball.r > W) {
      ball.x = W - ball.r;
      ball.vx = -Math.abs(ball.vx);
      tone(340, 0.05, 'sine', 0.04);
      burst(W, ball.y, '#9fb4bf', 4, 90);
    }

    // 下方挡板：球向下运动且越过挡板上沿
    var bot = pads.bot;
    if (ball.vy > 0 && overlapX(bot) &&
        ball.prevY + ball.r <= bot.y - bot.h / 2 &&
        ball.y + ball.r >= bot.y - bot.h / 2) {
      bounce(bot, true, '#ff7a5c');
    }

    // 上方挡板：球向上运动且越过挡板下沿
    var top = pads.top;
    if (ball.vy < 0 && overlapX(top) &&
        ball.prevY - ball.r >= top.y + top.h / 2 &&
        ball.y - ball.r <= top.y + top.h / 2) {
      bounce(top, false, '#45d9c8');
    }

    if (ball.y - ball.r > H) { scorePoint('top'); return; }
    if (ball.y + ball.r < 0) { scorePoint('bot'); return; }

    ball.trail.push({ x: ball.x, y: ball.y });
    if (ball.trail.length > 9) { ball.trail.shift(); }
  }

  function stepAI(dt) {
    if (mode !== 'solo' || state !== 'playing') { return; }
    var p = pads.top;
    ai.timer -= dt;
    if (ai.timer <= 0) {
      ai.timer = rand(0.35, 0.7);
      ai.err = rand(-1, 1) * W * 0.055;
    }
    var aim;
    if (ball.vy < 0) {
      aim = ball.x + ai.err;
    } else {
      aim = W / 2 + (ball.x - W / 2) * 0.45 + ai.err * 0.4;
    }
    aim = clamp(aim, p.w / 2, W - p.w / 2);
    var move = clamp(aim - p.x, -ai.speed * dt, ai.speed * dt);
    p.x = clamp(p.x + move, p.w / 2, W - p.w / 2);
  }

  function stepKeys(dt) {
    if (!keys.botL && !keys.botR && !keys.topL && !keys.topR) { return; }
    var v = W * 1.15 * dt;
    if (mode !== 'solo') {
      if (keys.topL) { pads.top.x = clamp(pads.top.x - v, pads.top.w / 2, W - pads.top.w / 2); }
      if (keys.topR) { pads.top.x = clamp(pads.top.x + v, pads.top.w / 2, W - pads.top.w / 2); }
    }
    if (keys.botL) { pads.bot.x = clamp(pads.bot.x - v, pads.bot.w / 2, W - pads.bot.w / 2); }
    if (keys.botR) { pads.bot.x = clamp(pads.bot.x + v, pads.bot.w / 2, W - pads.bot.w / 2); }
  }

  function update(dt) {
    if (state === 'serve') {
      serveTimer -= dt;
      if (serveTimer <= 0) {
        state = 'playing';
        ball.speed = geo.baseSpeed;
        var ang = rand(-0.3, 0.3);
        ball.vx = Math.sin(ang) * ball.speed;
        ball.vy = Math.cos(ang) * ball.speed * serveDir;
      }
    } else if (state === 'playing') {
      stepBall(dt);
      if (state === 'playing') { stepAI(dt); }
    }

    stepKeys(dt);
    pads.top.glow = Math.max(0, pads.top.glow - dt * 4);
    pads.bot.glow = Math.max(0, pads.bot.glow - dt * 4);
  }

  /* ---------------- 绘制 ---------------- */

  function rr(x, y, w, h, r) {
    var rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(x, y, w, h, rad);
    } else {
      ctx.moveTo(x + rad, y);
      ctx.lineTo(x + w - rad, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
      ctx.lineTo(x + w, y + h - rad);
      ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
      ctx.lineTo(x + rad, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
      ctx.lineTo(x, y + rad);
      ctx.quadraticCurveTo(x, y, x + rad, y);
      ctx.closePath();
    }
  }

  function draw() {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#101820');
    g.addColorStop(0.5, '#0c1015');
    g.addColorStop(1, '#101820');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // 两端领地色
    var gt = ctx.createLinearGradient(0, 0, 0, H * 0.26);
    gt.addColorStop(0, 'rgba(69, 217, 200, 0.16)');
    gt.addColorStop(1, 'rgba(69, 217, 200, 0)');
    ctx.fillStyle = gt;
    ctx.fillRect(0, 0, W, H * 0.26);

    var gb = ctx.createLinearGradient(0, H, 0, H * 0.74);
    gb.addColorStop(0, 'rgba(255, 122, 92, 0.16)');
    gb.addColorStop(1, 'rgba(255, 122, 92, 0)');
    ctx.fillStyle = gb;
    ctx.fillRect(0, H * 0.74, W, H * 0.26);

    // 中线
    ctx.save();
    ctx.strokeStyle = 'rgba(233, 244, 248, 0.13)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([7, 9]);
    ctx.beginPath();
    ctx.moveTo(0, H / 2);
    ctx.lineTo(W, H / 2);
    ctx.stroke();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(W / 2, H / 2, Math.min(W, H) * 0.075, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(233, 244, 248, 0.09)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 对拉拍数
    if (rally >= 3) {
      ctx.save();
      ctx.globalAlpha = 0.20;
      ctx.fillStyle = '#e8f4f8';
      ctx.font = '700 ' + Math.round(H * 0.05) + 'px -apple-system, "PingFang SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(rally), W / 2, H / 2);
      ctx.restore();
    }

    // 球拖尾
    for (var i = 0; i < ball.trail.length; i++) {
      var t = ball.trail[i];
      var k = (i + 1) / ball.trail.length;
      ctx.beginPath();
      ctx.arc(t.x, t.y, ball.r * (0.35 + k * 0.55), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(240, 250, 255, ' + (k * 0.16).toFixed(3) + ')';
      ctx.fill();
    }

    drawPaddle(pads.top, '#45d9c8');
    drawPaddle(pads.bot, '#ff7a5c');

    // 球
    ctx.save();
    ctx.shadowColor = 'rgba(220, 245, 255, 0.9)';
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fillStyle = '#f2fbff';
    ctx.fill();
    ctx.restore();

    if (state === 'serve') {
      var pulse = 1 + Math.sin(Date.now() / 140) * 0.25;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.r * 2.6 * pulse, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(242, 251, 255, 0.18)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // 粒子
    for (var j = 0; j < particles.length; j++) {
      var p = particles[j];
      var a = 1 - p.life / p.max;
      ctx.globalAlpha = a * 0.85;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawPaddle(pad, color) {
    var x = pad.x - pad.w / 2;
    var y = pad.y - pad.h / 2;
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 12 + pad.glow * 22;
    ctx.fillStyle = color;
    rr(x, y, pad.w, pad.h, pad.h / 2);
    ctx.fill();
    if (pad.glow > 0) {
      ctx.globalAlpha = pad.glow * 0.5;
      ctx.fillStyle = '#ffffff';
      rr(x, y, pad.w, pad.h, pad.h / 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /* ---------------- 主循环 ---------------- */

  function frame(now) {
    rafId = window.requestAnimationFrame(frame);
    if (!lastTime) { lastTime = now; return; }
    var dt = (now - lastTime) / 1000;
    lastTime = now;
    if (dt > 0.25) { dt = 0.25; }
    var active = (state === 'playing' || state === 'serve');
    if (active) {
      acc += dt;
      var guard = 0;
      while (acc >= STEP && guard < 8) { update(STEP); acc -= STEP; guard++; }
      if (guard >= 8) { acc = 0; }
    } else {
      acc = 0;
    }
    stepParticles(dt);
    if (active || particles.length > 0 || dirty) {
      draw();
      dirty = false;
    }
  }

  /* ---------------- 输入 ---------------- */

  function padAt(clientY, rect) {
    return (clientY - rect.top) < H / 2 ? 'top' : 'bot';
  }

  function bindInput() {
    canvas.addEventListener('pointerdown', function (e) {
      if (state !== 'playing' && state !== 'serve') { return; }
      var rect = canvas.getBoundingClientRect();
      var side = padAt(e.clientY, rect);
      if (mode === 'solo' && side === 'top') { return; }
      var pad = pads[side];
      if (pad.pointer !== null) { return; }
      var x = e.clientX - rect.left;
      pad.pointer = e.pointerId;
      pad.x = clamp(x, pad.w / 2, W - pad.w / 2);
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      if (e.cancelable) { e.preventDefault(); }
    }, { passive: false });

    canvas.addEventListener('pointermove', function (e) {
      var rect = canvas.getBoundingClientRect();
      var x = e.clientX - rect.left;
      if (pads.top.pointer === e.pointerId) {
        pads.top.x = clamp(x, pads.top.w / 2, W - pads.top.w / 2);
      } else if (pads.bot.pointer === e.pointerId) {
        pads.bot.x = clamp(x, pads.bot.w / 2, W - pads.bot.w / 2);
      }
      if (e.cancelable) { e.preventDefault(); }
    }, { passive: false });

    function release(e) {
      if (pads.top.pointer === e.pointerId) { pads.top.pointer = null; }
      if (pads.bot.pointer === e.pointerId) { pads.bot.pointer = null; }
    }
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);

    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    document.addEventListener('keydown', function (e) {
      var k = KEYMAP[e.key];
      if (k) {
        keys[k] = true;
        if (e.cancelable) { e.preventDefault(); }
        return;
      }
      if (e.key === 'Escape' && (state === 'playing' || state === 'serve')) {
        pause();
      }
    });

    document.addEventListener('keyup', function (e) {
      var k = KEYMAP[e.key];
      if (k) { keys[k] = false; }
    });

    window.addEventListener('blur', function () {
      keys.botL = keys.botR = keys.topL = keys.topR = false;
    });
  }

  /* ---------------- 界面 ---------------- */

  function setLabels() {
    var top = hudTop.querySelector('.who');
    var bot = hudBot.querySelector('.who');
    if (top) { top.textContent = mode === 'solo' ? 'AI' : '上方'; }
    if (bot) { bot.textContent = mode === 'solo' ? '你' : '下方'; }
  }

  function hideOverlay() {
    overlayEl.hidden = true;
    dirty = true;
  }

  function showOverlay(cfg) {
    ovKicker.textContent = cfg.kicker || '';
    ovTitle.textContent = cfg.title || '';
    ovSub.textContent = cfg.sub || '';
    ovSub.className = 'sub' + (cfg.strong ? ' strong' : '');
    ovHint.textContent = cfg.hint || '';
    ovHint.hidden = !cfg.hint;
    ovFoot.textContent = cfg.foot || '';
    ovFoot.hidden = !cfg.foot;
    ovActs.innerHTML = '';
    (cfg.buttons || []).forEach(function (b) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn' + (b.primary ? ' primary' : '') + (b.ghost ? ' ghost' : '');
      btn.textContent = b.label;
      btn.addEventListener('click', b.onClick);
      ovActs.appendChild(btn);
    });
    overlayEl.hidden = false;
    dirty = true;
  }

  function toast(text) {
    toastEl.textContent = text;
    toastEl.classList.add('show');
    window.clearTimeout(toast._t);
    toast._t = window.setTimeout(function () {
      toastEl.classList.remove('show');
    }, 900);
  }

  function showMenu() {
    state = 'menu';
    setLabels();
    var wide = false;
    try { wide = window.matchMedia('(min-width: 760px)').matches; } catch (e) {}
    showOverlay({
      kicker: '两个人，一台手机',
      title: '对半分',
      sub: '各守一端，把球打过对方底线',
      hint: wide
        ? '键盘 ← → 控制下方，A D 控制上方'
        : '手机平放桌面，两人分持上下两端；一人玩时由 AI 守上方',
      foot: '先到 ' + WIN_SCORE + ' 分',
      buttons: [
        { label: '两个人玩', primary: true, onClick: function () { start('duo'); } },
        { label: '一个人玩', ghost: true, onClick: function () { start('solo'); } }
      ]
    });
  }

  function start(m) {
    mode = m;
    ensureAudio();
    newMatch();
  }

  function showResult() {
    var topWin = scoreTop > scoreBot;
    var title;
    if (mode === 'solo') {
      title = topWin ? 'AI 赢了' : '你赢了';
    } else {
      title = topWin ? '上方胜' : '下方胜';
    }
    tone(topWin ? 660 : 440, 0.18, 'triangle', 0.08, topWin ? 880 : 330);
    showOverlay({
      kicker: WIN_SCORE + ' 分制',
      title: title,
      sub: scoreTop + ' : ' + scoreBot,
      strong: true,
      hint: mode === 'solo' ? '再来一局，或者换个人试试' : '换边再来一局',
      foot: '',
      buttons: [
        { label: '再来一局', primary: true, onClick: function () { start(mode); } },
        { label: '回到开始', ghost: true, onClick: function () { showMenu(); } }
      ]
    });
  }

  function pause() {
    if (state !== 'playing' && state !== 'serve') { return; }
    pausedFrom = state;
    state = 'paused';
    lastTime = 0;
    acc = 0;
    showOverlay({
      kicker: '暂停',
      title: '已暂停',
      sub: '回来接着打',
      hint: '',
      foot: '',
      buttons: [{ label: '继续', primary: true, onClick: resume }]
    });
  }

  function resume() {
    if (state !== 'paused') { return; }
    state = pausedFrom || 'serve';
    pausedFrom = null;
    lastTime = 0;
    acc = 0;
    hideOverlay();
    draw();
  }

  function bindLifecycle() {
    document.addEventListener('visibilitychange', function () {
      try {
        if (document.hidden) {
          if (audio && audio.state === 'running' && audio.suspend) { audio.suspend(); }
          if (state === 'playing' || state === 'serve') { pause(); }
        } else {
          lastTime = 0;
          acc = 0;
          if (audio && soundOn && audio.state === 'suspended' && audio.resume) { audio.resume(); }
        }
      } catch (e) {}
    });
  }

  function bindResize() {
    var pending = false;
    function schedule() {
      if (pending) { return; }
      pending = true;
      window.requestAnimationFrame(function () {
        pending = false;
        layout();
        draw();
      });
    }
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', function () {
      window.setTimeout(schedule, 120);
    });
    if (window.visualViewport && window.visualViewport.addEventListener) {
      window.visualViewport.addEventListener('resize', schedule);
    }
    if (window.ResizeObserver) {
      try { new ResizeObserver(schedule).observe(stageEl); } catch (e) {}
    }
  }

  /* ---------------- 启动 ---------------- */

  function hideBoot() {
    bootEl.classList.add('gone');
    window.setTimeout(function () {
      if (bootEl.parentNode) { bootEl.parentNode.removeChild(bootEl); }
    }, 260);
  }

  function failBoot(message) {
    bootEl.className = 'boot error';
    bootEl.textContent = '加载失败：' + message + ' 请刷新页面重试。';
  }

  function init() {
    if (!ctx) { throw new Error('浏览器不支持画布'); }
    layout();
    bindInput();
    bindLifecycle();
    bindResize();
    updateScore();
    setLabels();
    showMenu();
    ball.x = W / 2;
    ball.y = H / 2;
    draw();
    rafId = window.requestAnimationFrame(frame);
    hideBoot();
  }

  function boot() {
    try {
      init();
    } catch (err) {
      failBoot(err && err.message ? err.message : '未知错误');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
