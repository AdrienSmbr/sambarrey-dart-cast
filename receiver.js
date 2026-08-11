/*
  Scoreboard distant de SambarreyDart.

  La tablette reste maîtresse du jeu : elle envoie un instantané complet de la
  partie à chaque changement, cette page ne fait que l'afficher. Aucun état de
  jeu n'est calculé ici, ce qui évite toute divergence entre les deux écrans.

  Protocole (canal `urn:x-cast:com.sambarrey.dart`) : voir docs/protocole-cast.md
*/

'use strict';

const NAMESPACE = 'urn:x-cast:com.sambarrey.dart';

const el = (id) => document.getElementById(id);

const dom = {
  idle: el('idle'),
  game: el('game'),
  matchTitle: el('matchTitle'),
  turnIndex: el('turnIndex'),
  turnBanner: el('turnBanner'),
  turnAvatar: el('turnAvatar'),
  turnName: el('turnName'),
  dartsStrip: el('dartsStrip'),
  players: el('players'),
  checkout: el('checkout'),
  bust: el('bust'),
  overlay: el('overlay'),
  overlayIcon: el('overlayIcon'),
  overlayTitle: el('overlayTitle'),
  overlayName: el('overlayName'),
  overlaySub: el('overlaySub'),
  sweep: el('sweep'),
  app: el('app'),
};

/** Dernier état reçu, pour ne réagir qu'aux vraies transitions. */
let previous = null;
let overlayTimer = null;

// --------------------------------------------------------------- RENDU

function initials(name) {
  return (name || '?').trim().charAt(0).toUpperCase() || '?';
}

function setPlayers(state) {
  const players = state.players || [];
  dom.players.dataset.count = players.length > 6 ? 'many' : String(players.length);

  // Réutilisation des cartes existantes plutôt qu'un remplacement complet :
  // recréer le DOM à chaque fléchette relancerait toutes les animations et
  // ferait clignoter l'écran.
  while (dom.players.children.length > players.length) {
    dom.players.removeChild(dom.players.lastChild);
  }
  while (dom.players.children.length < players.length) {
    dom.players.appendChild(buildCard());
  }

  players.forEach((player, index) => {
    updateCard(dom.players.children[index], player, state);
  });
}

function buildCard() {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <div class="flames hidden"></div>
    <div class="card-head">
      <div class="avatar"></div>
      <div style="min-width:0">
        <div class="name"></div>
        <div class="team-tag"></div>
      </div>
    </div>
    <div class="body"></div>
  `;
  return card;
}

function updateCard(card, player, state) {
  card.style.setProperty('--player-color', player.color || '#ffb300');
  card.classList.toggle('active', !!player.isActive);
  card.classList.toggle('eliminated', !!player.isEliminated);

  card.querySelector('.flames').classList.toggle('hidden', !player.isKiller);

  const avatar = card.querySelector('.avatar');
  avatar.style.background = player.color || '#ffb300';
  avatar.textContent = initials(player.name);

  card.querySelector('.name').textContent = player.name || '';

  const tag = card.querySelector('.team-tag');
  tag.textContent = player.teamLabel || '';
  tag.style.display = player.teamLabel ? '' : 'none';

  renderBody(card.querySelector('.body'), player, state);
}

function renderBody(body, player, state) {
  if (state.mode === 'cricket') {
    renderCricketBody(body, player, state);
    return;
  }

  if (state.mode === 'killer') {
    body.innerHTML = `
      <div class="sub">Chiffre ${player.targetNumber ?? '—'}</div>
      <div class="lives"></div>
    `;
    const lives = body.querySelector('.lives');
    if (player.isEliminated) {
      lives.innerHTML = '<span class="life">💀</span><span class="sub">éliminé</span>';
    } else if (state.isCompetitive) {
      lives.innerHTML = `<span class="life">❤️</span><span class="score" style="font-size:6vh">${player.lives ?? 0}</span>`;
    } else {
      const marks = player.touches ?? 0;
      lives.innerHTML = player.isKiller
        ? '<span class="life">🔥</span><span class="sub">KILLER</span>'
        : `<span class="score" style="font-size:6vh">${'|'.repeat(marks) || '–'}</span>`;
    }
    return;
  }

  // X01 : le score restant est l'information reine, tout le reste est secondaire.
  const score = ensureScoreNode(body);
  const next = String(player.score ?? 0);
  if (score.textContent !== next) {
    score.textContent = next;
    replayAnimation(score, 'bump');
  }
}

function ensureScoreNode(body) {
  let score = body.querySelector('.score');
  if (!score) {
    body.innerHTML = '';
    score = document.createElement('div');
    score.className = 'score';
    body.appendChild(score);
  }
  return score;
}

function renderCricketBody(body, player, state) {
  const targets = state.cricketTargets || [20, 19, 18, 17, 16, 15, 25];
  let wrap = body.querySelector('.marks');
  if (!wrap) {
    body.innerHTML = '<div class="marks"></div><div class="score" style="font-size:6vh"></div>';
    wrap = body.querySelector('.marks');
  }

  wrap.innerHTML = targets.map((target) => {
    const hits = (player.marks && player.marks[target]) || 0;
    const pips = [0, 1, 2].map((i) => `<span class="pip ${i < hits ? 'on' : ''}"></span>`).join('');
    return `<div class="mark-row ${hits >= 3 ? 'closed' : ''}">
        <span class="mark-label">${target === 25 ? 'BULL' : target}</span>
        <span class="mark-pips">${pips}</span>
      </div>`;
  }).join('');

  const score = body.querySelector('.score');
  const next = String(player.score ?? 0);
  if (score.textContent !== next) {
    score.textContent = next;
    replayAnimation(score, 'bump');
  }
}

function renderDarts(state) {
  const darts = state.currentDarts || [];
  dom.dartsStrip.innerHTML = darts.map((dart) => {
    const cls = dart.points === 0 ? 'miss' : (dart.points >= 40 ? 'big' : '');
    return `<span class="dart ${cls}">${dart.label}</span>`;
  }).join('');
}

function renderTurn(state) {
  const color = state.activePlayerColor || '#ffb300';
  dom.turnBanner.style.setProperty('--player-color', color);
  dom.turnAvatar.style.background = color;
  dom.turnAvatar.textContent = initials(state.activePlayerName);
  dom.turnName.textContent = state.activePlayerName || '—';
  dom.matchTitle.textContent = state.matchTitle || '';
  dom.turnIndex.textContent = state.turnIndex ? `Tour ${state.turnIndex}` : '';
}

function renderFooter(state) {
  const hasCheckout = !!state.checkout;
  dom.checkout.classList.toggle('hidden', !hasCheckout);
  if (hasCheckout) {
    dom.checkout.innerHTML = `<span class="label">Checkout</span><span>${state.checkout}</span>`;
  }

  const hasBust = !!state.bustMessage;
  dom.bust.classList.toggle('hidden', !hasBust);
  if (hasBust) dom.bust.textContent = state.bustMessage;
}

// ------------------------------------------------------------- EFFETS

function replayAnimation(node, className) {
  node.classList.remove(className);
  // Force le navigateur à recalculer le style, sinon retirer puis remettre la
  // classe dans le même tour ne relance pas l'animation.
  void node.offsetWidth;
  node.classList.add(className);
}

function playSweep() {
  replayAnimation(dom.sweep, 'run');
}

function quake() {
  replayAnimation(dom.app, 'quake');
}

function showOverlay({ icon, title, name, sub, color, duration = 3200 }) {
  clearTimeout(overlayTimer);
  dom.overlayIcon.textContent = icon;
  dom.overlayTitle.textContent = title;
  dom.overlayName.textContent = name || '';
  dom.overlaySub.textContent = sub || '';
  dom.overlay.style.setProperty('--overlay-color', color || '#ffb300');
  dom.overlay.classList.remove('hidden');
  replayAnimation(dom.overlay.querySelector('.overlay-inner'), 'pop');

  overlayTimer = setTimeout(() => dom.overlay.classList.add('hidden'), duration);
}

/** Compare l'état reçu au précédent pour déclencher les effets qui vont bien. */
function reactToChanges(state) {
  const before = previous;

  if (!before || before.activePlayerId !== state.activePlayerId) {
    playSweep();
    replayAnimation(dom.turnName, 'enter');
  }

  if (state.bustMessage && (!before || before.bustMessage !== state.bustMessage)) {
    quake();
  }

  const event = state.event;
  if (event && (!before || JSON.stringify(before.event) !== JSON.stringify(event))) {
    handleEvent(event);
  }
}

function handleEvent(event) {
  switch (event.kind) {
    case 'becameKiller':
      showOverlay({ icon: '🔥', title: 'Nouveau killer', name: event.player, color: '#ff6d00' });
      confetti({ colors: ['#ff6d00', '#ffb300', '#ff3d00'], count: 90, spread: 'up' });
      quake();
      break;

    case 'eliminated':
      showOverlay({ icon: '💀', title: 'Élimination', name: event.player, color: '#ff4d4d' });
      quake();
      break;

    case 'victory':
      showOverlay({
        icon: '🏆',
        title: 'Victoire',
        name: event.player,
        sub: event.subtitle || '',
        color: '#ffd54f',
        duration: 12000,
      });
      confetti({ count: 320, duration: 7000 });
      break;

    default:
      break;
  }
}

// ---------------------------------------------------- PARTICULES (canvas)

const canvas = el('fx');
const ctx = canvas.getContext('2d');
let particles = [];
let rafId = null;

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function confetti({ count = 200, colors = null, duration = 5000, spread = 'top' } = {}) {
  const palette = colors || ['#ffb300', '#ff4d4d', '#4dd0e1', '#81c784', '#ba68c8', '#fff'];
  const now = performance.now();

  for (let i = 0; i < count; i += 1) {
    const fromBottom = spread === 'up';
    particles.push({
      x: Math.random() * canvas.width,
      y: fromBottom ? canvas.height + 20 : -20 - Math.random() * canvas.height * 0.4,
      vx: (Math.random() - 0.5) * 3,
      vy: fromBottom ? -(6 + Math.random() * 5) : 2 + Math.random() * 4,
      size: 6 + Math.random() * 8,
      spin: (Math.random() - 0.5) * 0.3,
      angle: Math.random() * Math.PI,
      color: palette[(Math.random() * palette.length) | 0],
      dieAt: now + duration,
    });
  }

  if (!rafId) rafId = requestAnimationFrame(step);
}

function step(now) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  particles = particles.filter((p) => now < p.dieAt && p.y < canvas.height + 40);

  for (const p of particles) {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.12;            // gravité
    p.vx *= 0.995;
    p.angle += p.spin;

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
    ctx.restore();
  }

  if (particles.length > 0) {
    rafId = requestAnimationFrame(step);
  } else {
    // Plus rien à dessiner : on rend la main plutôt que de tourner à vide.
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    rafId = null;
  }
}

// --------------------------------------------------------------- ÉTAT

function render(state) {
  if (!state || !state.players || state.players.length === 0) {
    dom.idle.classList.remove('hidden');
    dom.game.classList.add('hidden');
    previous = null;
    return;
  }

  dom.idle.classList.add('hidden');
  dom.game.classList.remove('hidden');

  renderTurn(state);
  renderDarts(state);
  setPlayers(state);
  renderFooter(state);
  reactToChanges(state);

  previous = state;
}

function onMessage(payload) {
  if (!payload) return;
  if (payload.type === 'reset') {
    render(null);
    return;
  }
  render(payload);
}

// ---------------------------------------------------------------- CAST

function startCast() {
  const context = cast.framework.CastReceiverContext.getInstance();
  const options = new cast.framework.CastReceiverOptions();

  // Sans ça le Chromecast coupe la session au bout de quelques minutes faute de
  // lecture média : un tableau de scores ne « joue » rien, il serait éteint en
  // plein milieu d'une partie.
  options.disableIdleTimeout = true;
  options.maxInactivity = 3600;

  context.addCustomMessageListener(NAMESPACE, (event) => onMessage(event.data));
  context.start(options);
}

// ---------------------------------------------------------------- DÉMO

/**
 * Partie scriptée, jouée quand la page est ouverte dans un navigateur.
 *
 * Permet de valider tout le rendu et les effets sans Chromecast ni tablette,
 * et sert de documentation vivante du format de message attendu.
 */
function startDemo() {
  const players = [
    { id: 1, name: 'Adrien', color: '#7e57c2', score: 301 },
    { id: 2, name: 'Laura', color: '#ec407a', score: 301 },
    { id: 3, name: 'Stéphane', color: '#26a69a', score: 301 },
  ];

  let turn = 1;
  let activeIndex = 0;
  let darts = [];

  const snapshot = (extra = {}) => ({
    type: 'state',
    mode: 'x01',
    matchTitle: '301',
    turnIndex: turn,
    activePlayerId: players[activeIndex].id,
    activePlayerName: players[activeIndex].name,
    activePlayerColor: players[activeIndex].color,
    currentDarts: darts.slice(),
    players: players.map((p, i) => ({ ...p, isActive: i === activeIndex })),
    ...extra,
  });

  render(snapshot());

  const script = [
    () => { darts = [{ label: 'T20', points: 60 }]; players[0].score -= 60; render(snapshot()); },
    () => { darts.push({ label: '20', points: 20 }); players[0].score -= 20; render(snapshot()); },
    () => { darts.push({ label: 'RATÉ', points: 0 }); render(snapshot()); },
    () => { activeIndex = 1; darts = []; render(snapshot()); },
    () => { darts = [{ label: 'T19', points: 57 }]; players[1].score -= 57; render(snapshot()); },
    () => { darts.push({ label: 'BULL', points: 50 }); players[1].score -= 50; render(snapshot()); },
    () => { activeIndex = 2; darts = []; turn = 2; render(snapshot()); },
    () => { render(snapshot({ bustMessage: 'Bust : score dépassé !' })); },
    () => { activeIndex = 0; darts = []; render(snapshot({ checkout: 'T20 D20' })); },
    () => { render(snapshot({ event: { kind: 'becameKiller', player: 'Adrien' } })); },
    () => { render(snapshot({ event: { kind: 'eliminated', player: 'Stéphane' } })); },
    () => {
      players[0].score = 0;
      render(snapshot({ event: { kind: 'victory', player: 'Adrien', subtitle: 'Gloire au roi !' } }));
    },
  ];

  let stepIndex = 0;
  setInterval(() => {
    // Remise à zéro en début de cycle : sans ça la boucle continuerait à
    // décompter et afficherait des scores négatifs au bout de deux tours.
    if (stepIndex % script.length === 0) {
      players.forEach((p) => { p.score = 301; });
      turn = 1;
      activeIndex = 0;
      darts = [];
    }
    script[stepIndex % script.length]();
    stepIndex += 1;
  }, 2600);
}

// ------------------------------------------------------------ DÉMARRAGE

// Le SDK Cast se charge aussi dans un navigateur ordinaire : sa seule présence
// ne prouve donc pas qu'on tourne sur un Chromecast. `?demo=1` force la partie
// scriptée, ce qui permet de valider l'écran sans matériel.
const forceDemo = new URLSearchParams(location.search).has('demo');

if (!forceDemo && typeof cast !== 'undefined' && cast.framework) {
  try {
    startCast();
  } catch (error) {
    console.warn('Contexte Cast indisponible, bascule en démo', error);
    startDemo();
  }
} else {
  startDemo();
}
