/*
  Scoreboard distant de SambarreyDart.

  La tablette reste maîtresse du jeu : elle envoie un instantané complet de la
  partie à chaque changement, cette page ne fait que l'afficher. Aucun état de
  jeu n'est calculé ici, ce qui évite toute divergence entre les deux écrans.

  Le rendu reprend délibérément la grammaire visuelle des composables Compose
  de l'app (couleurs, rayons, badges) plutôt qu'une interprétation libre : la
  télé doit se sentir comme le même produit que la tablette.

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
  overlayLottie: el('overlayLottie'),
  overlayIcon: el('overlayIcon'),
  overlayTitle: el('overlayTitle'),
  overlayName: el('overlayName'),
  overlaySub: el('overlaySub'),
  sweep: el('sweep'),
  app: el('app'),
};

/** Icônes en ligne : mêmes glyphes que les `Icon()` Compose, en SVG minimal. */
const ICONS = {
  heart: '<svg class="icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-6.7-4.35-9.33-8.2C.9 10.02 1.4 6.6 4.1 5.1c2.1-1.17 4.53-.6 5.9 1.2.3.4.8 1 .8 1s.5-.6.8-1c1.37-1.8 3.8-2.37 5.9-1.2 2.7 1.5 3.2 4.92 1.43 7.7C18.7 16.65 12 21 12 21z"/></svg>',
  warning: '<svg class="icon" viewBox="0 0 24 24"><path fill="currentColor" d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>',
  check: '<svg class="icon" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 20.6 7.4 19.2 6z"/></svg>',
  eliminated: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><line x1="5.5" y1="5.5" x2="18.5" y2="18.5"/></svg>',
  target: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/></svg>',
  // Reprend Icons.Default.LocalFireDepartment (badge "isKiller" côté app).
  fire: '<svg class="icon" viewBox="0 0 24 24" fill="currentColor"><path d="M13.5 2c1 3-1 4.5-2.5 6C9 9.9 8 11.7 8 14a5.5 5.5 0 0 0 5.7 5.5c-.6-.7-1-1.5-1-2.5 0-1.3.9-2.1 1.9-3 .8-.7 1.65-1.45 2-2.5.7 1 1.2 2.1 1.2 3.5 0 2.5-1.9 4.5-4.3 5-1.9.4-3.9-.2-5.3-1.6C6.7 16.9 6 15.1 6 13.2 6 9.6 8.3 7 10.3 5 11.6 3.7 12.7 2.9 13.5 2z"/></svg>',
  // Reprend Icons.Default.EmojiEvents (icône victoire).
  trophy: '<svg class="icon" viewBox="0 0 24 24" fill="currentColor"><path d="M19 5h-2V3H7v2H5a2 2 0 0 0-2 2v1a4 4 0 0 0 4 4c.5 1.9 2 3.4 4 3.85V18H8v2h8v-2h-3v-2.15c2-.45 3.5-1.95 4-3.85a4 4 0 0 0 4-4V7a2 2 0 0 0-2-2zM5 8V7h2v2.8A2 2 0 0 1 5 8zm14 0a2 2 0 0 1-2 1.8V7h2v1z"/></svg>',
};

/** Animations plein écran « nouveau killer » / « élimination », reprises telles
 *  quelles de app/src/main/res/raw (KillerScoreboard.kt tire au hasard dans la
 *  même liste à chaque déclenchement). */
const KILLER_LOTTIES = ['assets/lottie/dragon_fire.lottie', 'assets/lottie/fire_card.lottie'];
const ELIMINATED_LOTTIES = ['assets/lottie/dead_emoji.lottie', 'assets/lottie/mediation_skull.lottie', 'assets/lottie/rip_dead.lottie'];
const pickRandom = (arr) => arr[(Math.random() * arr.length) | 0];

/** Ordre standard des cibles Cricket, repris si l'app ne le précise pas. */
const DEFAULT_CRICKET_TARGETS = [20, 19, 18, 17, 16, 15, 25];

/** Dernier état reçu, pour ne réagir qu'aux vraies transitions. */
let previous = null;
let overlayTimer = null;
/** Signature de la dernière structure DOM construite pour #players, pour ne
 *  reconstruire les nœuds que quand c'est réellement nécessaire. */
let playersLayoutKey = null;

// --------------------------------------------------------------- RENDU

function initials(name) {
  return (name || '?').trim().charAt(0).toUpperCase() || '?';
}

function renderTurn(state) {
  const color = state.activePlayerColor || '#FF6D00';
  dom.turnAvatar.style.background = color;
  dom.turnAvatar.textContent = initials(state.activePlayerName);
  dom.turnName.textContent = state.activePlayerName || '—';
  dom.matchTitle.textContent = state.matchTitle || '';
  dom.turnIndex.textContent = state.turnIndex ? `Tour ${state.turnIndex}` : '';
}

function renderDarts(state) {
  const darts = state.currentDarts || [];
  dom.dartsStrip.innerHTML = darts.map((dart) => {
    const cls = dart.points === 0 ? 'miss' : (dart.points >= 40 ? 'big' : '');
    return `<span class="dart ${cls}">${dart.label}</span>`;
  }).join('');
}

function renderFooter(state) {
  const hasCheckout = !!state.checkout;
  dom.checkout.classList.toggle('hidden', !hasCheckout);
  if (hasCheckout) {
    dom.checkout.innerHTML = `${ICONS.target}<span class="label">Checkout ${state.activePlayerRemainingScore ?? ''} :</span><span class="value">${state.checkout}</span>`;
  }

  const hasBust = !!state.bustMessage;
  dom.bust.classList.toggle('hidden', !hasBust);
  if (hasBust) dom.bust.innerHTML = `${ICONS.warning}<span>${state.bustMessage}</span>`;
}

// ------------------------------------------------------- GRILLE X01 / KILLER

function renderCardGrid(state) {
  const players = state.players || [];
  const isKiller = state.mode === 'killer';
  // Killer : côté app c'est une liste de lignes compactes (une Row par joueur),
  // pas une grille de cartes carrées — les faire vivre dans la même grille que
  // le 301 les étirait sur toute la hauteur de la colonne pour rien.
  const layoutKey = isKiller ? `cards:killer:${players.length}` : `cards:${players.length > 6 ? 'many' : players.length}`;

  if (playersLayoutKey !== layoutKey) {
    dom.players.className = isKiller ? 'players killer-list' : 'players';
    if (isKiller) {
      delete dom.players.dataset.count;
    } else {
      dom.players.dataset.count = players.length > 6 ? 'many' : String(players.length);
    }
    dom.players.innerHTML = '';
    players.forEach(() => dom.players.appendChild(buildCard()));
    playersLayoutKey = layoutKey;
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
        <div class="target-pill hidden"></div>
      </div>
    </div>
    <div class="foot" style="display:flex; align-items:flex-end; justify-content:space-between; gap:1vw;">
      <div class="score"></div>
    </div>
  `;
  return card;
}

function updateCard(card, player, state) {
  const isKiller = state.mode === 'killer';
  card.style.setProperty('--player-color', player.color || '#FF6D00');

  // Côté app la carte Killer est une seule ligne (pas de score séparé) : on
  // retrouve cette proportion plutôt que de garder une carte aussi haute que
  // celles du 301 avec une ligne de score vide en dessous.
  card.classList.toggle('mode-killer', isKiller);

  // En X01/duo l'accent suit le tour ; au Killer le statut (killer/éliminé)
  // reste affiché même hors tour, exactement comme côté app.
  card.classList.toggle('active', !!player.isActive && !isKiller);
  card.classList.toggle('killer-status', isKiller && !!player.isKiller && !player.isEliminated);
  card.classList.toggle('eliminated-status', isKiller && !!player.isEliminated);
  if (isKiller && player.isActive && !player.isKiller && !player.isEliminated) {
    card.classList.add('active');
  }

  card.querySelector('.flames').classList.toggle('hidden', !(isKiller && player.isKiller && !player.isEliminated));

  const avatar = card.querySelector('.avatar');
  avatar.style.background = player.color || '#FF6D00';
  avatar.textContent = initials(player.name);

  card.querySelector('.name').textContent = player.name || '';

  const tag = card.querySelector('.team-tag');
  tag.textContent = player.teamLabel || '';
  tag.style.display = player.teamLabel ? '' : 'none';

  const pill = card.querySelector('.target-pill');
  if (isKiller) {
    pill.innerHTML = `<span class="killer-target-label">Cible</span><span class="killer-target-num">${player.targetNumber ?? '—'}</span>`;
    pill.classList.remove('hidden');
  } else {
    pill.classList.add('hidden');
  }

  const foot = card.querySelector('.foot');
  let badge = foot.querySelector('.status-badge');

  if (isKiller) {
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'status-badge';
      foot.appendChild(badge);
    }
    renderKillerBadge(badge, player, state);
  } else if (badge) {
    badge.remove();
  }

  const score = foot.querySelector('.score');
  const next = String(player.score ?? 0);
  if (score.textContent !== next) {
    score.textContent = next;
    replayAnimation(score, 'bump');
  }
  // Au Killer le score numérique de la carte n'a pas de sens (c'est le badge
  // qui porte l'information) : on masque la cellule plutôt que d'afficher 0.
  score.style.display = isKiller ? 'none' : '';
}

/** Reproduit KillerStatusBadge() : 4 variantes exactement comme côté app. */
function renderKillerBadge(badge, player, state) {
  if (player.isEliminated) {
    badge.className = 'status-badge eliminated';
    badge.innerHTML = `${ICONS.eliminated}<span>ÉLIMINÉ</span>`;
    return;
  }

  if (state.isCompetitive) {
    badge.className = 'status-badge lives';
    badge.innerHTML = `${ICONS.heart}<span>${player.lives ?? 0}</span>`;
    return;
  }

  if (player.isKiller) {
    badge.className = 'status-badge killer';
    badge.innerHTML = `${ICONS.fire}<span>|||  KILLER</span>`;
    return;
  }

  badge.className = 'status-badge touches';
  const bars = { 0: '-', 1: '|', 2: '| |' }[player.touches] ?? '| | |';
  badge.innerHTML = `<span>${bars}</span>`;
}

// --------------------------------------------------------------- CRICKET

function renderCricketBoard(state) {
  const players = state.players || [];
  const targets = state.cricketTargets && state.cricketTargets.length
    ? state.cricketTargets
    : DEFAULT_CRICKET_TARGETS;
  const layoutKey = `cricket:${players.map((p) => p.id).join(',')}`;

  if (playersLayoutKey !== layoutKey) {
    dom.players.className = 'players cricket-board';
    delete dom.players.dataset.count;
    dom.players.innerHTML = '';
    dom.players.appendChild(buildCricketTargetColumn(targets));
    players.forEach(() => dom.players.appendChild(buildCricketPlayerColumn(targets)));
    playersLayoutKey = layoutKey;
  }

  const columns = dom.players.querySelectorAll('.cricket-player-col');
  players.forEach((player, index) => {
    updateCricketColumn(columns[index], player, targets, state);
  });
}

function buildCricketTargetColumn(targets) {
  const col = document.createElement('div');
  col.className = 'cricket-col cricket-target-col';
  col.innerHTML = `
    <div class="cricket-target-head">
      <div class="big">CIBLE</div>
    </div>
    ${targets.map((t) => `<div class="cricket-target-cell">${t === 25 ? 'BULL' : t}</div>`).join('')}
  `;
  return col;
}

function buildCricketPlayerColumn(targets) {
  const col = document.createElement('div');
  col.className = 'cricket-col cricket-player-col';
  col.innerHTML = `
    <div class="cricket-head">
      <div class="row">
        <div class="cricket-avatar"></div>
        <div class="name"></div>
      </div>
      <div class="row">
        <span class="team-tag"></span>
        <span class="score"></span>
      </div>
    </div>
    ${targets.map(() => '<div class="cricket-cell"></div>').join('')}
  `;
  return col;
}

function updateCricketColumn(col, player, targets, state) {
  col.classList.toggle('active', !!player.isActive);

  const avatar = col.querySelector('.cricket-avatar');
  avatar.style.background = player.color || '#FF6D00';
  avatar.textContent = initials(player.name);
  col.querySelector('.name').textContent = player.name || '';

  const tag = col.querySelector('.team-tag');
  tag.textContent = player.teamLabel ? player.teamLabel.replace('Équipe', 'É') : '';

  const score = col.querySelector('.cricket-head .score');
  const next = String(player.score ?? 0);
  if (score.textContent !== next) {
    score.textContent = next;
    replayAnimation(score, 'bump');
  }

  const cells = col.querySelectorAll('.cricket-cell');
  targets.forEach((target, i) => {
    const hits = (player.marks && player.marks[target]) || 0;
    cells[i].innerHTML = cricketMarkSymbol(hits);
  });
}

/** Reproduit CricketMarkSymbol() : point / slash / X / pilule FERMÉ verte. */
function cricketMarkSymbol(hits) {
  if (hits >= 3) return `<span class="mark-closed">${ICONS.check}FERMÉ</span>`;
  if (hits === 2) return '<span class="mark-x">X</span>';
  if (hits === 1) return '<span class="mark-slash">/</span>';
  return '<span class="mark-dot">•</span>';
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

function showOverlay({ lottie, icon, title, name, sub, color, duration = 3200 }) {
  clearTimeout(overlayTimer);

  if (lottie) {
    dom.overlayLottie.setAttribute('src', lottie);
    dom.overlayLottie.classList.remove('hidden');
    dom.overlayIcon.classList.add('hidden');
  } else {
    dom.overlayLottie.classList.add('hidden');
    dom.overlayLottie.removeAttribute('src');
    dom.overlayIcon.innerHTML = icon || '';
    dom.overlayIcon.classList.remove('hidden');
  }

  dom.overlayTitle.textContent = title;
  dom.overlayName.textContent = name || '';
  dom.overlaySub.textContent = sub || '';
  dom.overlay.style.setProperty('--overlay-color', color || '#FF6D00');
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
      showOverlay({ lottie: pickRandom(KILLER_LOTTIES), title: 'Nouveau killer', name: event.player, color: '#FF6D00' });
      confetti({ colors: ['#FF6D00', '#FFC107', '#FF1744'], count: 90, spread: 'up' });
      quake();
      break;

    case 'eliminated':
      showOverlay({ lottie: pickRandom(ELIMINATED_LOTTIES), title: 'Élimination', name: event.player, color: '#FF1744' });
      quake();
      break;

    case 'victory':
      showOverlay({
        icon: ICONS.trophy,
        title: 'Victoire',
        name: event.player,
        sub: event.subtitle || '',
        color: '#FFC107',
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
  const palette = colors || ['#FF6D00', '#00C853', '#2979FF', '#FFC107', '#FF1744', '#fff'];
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
    playersLayoutKey = null;
    return;
  }

  dom.idle.classList.add('hidden');
  dom.game.classList.remove('hidden');

  renderTurn(state);
  renderDarts(state);

  if (state.mode === 'cricket') {
    renderCricketBoard(state);
  } else {
    renderCardGrid(state);
  }

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
 * Passe par les 3 jeux (301, Cricket, Killer) et par les 3 événements plein
 * écran, pour valider tout le rendu sans Chromecast ni tablette.
 */
function startDemo() {
  const P = [
    { id: 1, name: 'Adrien', color: '#7e57c2' },
    { id: 2, name: 'Laura', color: '#ec407a' },
    { id: 3, name: 'Stéphane', color: '#26a69a' },
  ];

  // Reconstruit tout l'état à chaque tour de boucle : les fermetures ci-dessous
  // capturent des scores mutables, qui dériveraient indéfiniment (score négatif
  // au bout de quelques tours) sans repartir d'un état neuf.
  function buildScript() {
  const script = [];

  // ------------------------------------------------------------- 301
  {
    let scores = { 1: 301, 2: 301, 3: 301 };
    let active = 0;
    let darts = [];
    let turn = 1;
    const snap = (extra = {}) => ({
      type: 'state', mode: 'x01', matchTitle: '301', turnIndex: turn,
      activePlayerId: P[active].id, activePlayerName: P[active].name,
      activePlayerColor: P[active].color, activePlayerRemainingScore: scores[P[active].id],
      currentDarts: darts.slice(),
      players: P.map((p, i) => ({ ...p, isActive: i === active, score: scores[p.id] })),
      ...extra,
    });
    script.push(
      () => { darts = [{ label: 'T20', points: 60 }]; scores[1] -= 60; render(snap()); },
      () => { darts.push({ label: '20', points: 20 }); scores[1] -= 20; render(snap()); },
      () => { darts.push({ label: 'RATÉ', points: 0 }); render(snap()); },
      () => { active = 1; darts = []; render(snap()); },
      () => { darts = [{ label: 'T19', points: 57 }]; scores[2] -= 57; render(snap()); },
      () => { darts.push({ label: 'BULL', points: 50 }); scores[2] -= 50; render(snap()); },
      () => { active = 2; darts = []; turn = 2; render(snap()); },
      () => { render(snap({ bustMessage: 'Bust : score dépassé !' })); },
      () => { active = 0; darts = []; render(snap({ checkout: 'T20 D20' })); },
    );
  }

  // ---------------------------------------------------------- CRICKET
  {
    const targets = [20, 19, 18, 17, 16, 15, 25];
    let marks = { 1: {}, 2: {}, 3: {} };
    let scores = { 1: 0, 2: 0, 3: 0 };
    let active = 0;
    const snap = (extra = {}) => ({
      type: 'state', mode: 'cricket', matchTitle: 'Cricket', turnIndex: 1,
      cricketTargets: targets,
      activePlayerId: P[active].id, activePlayerName: P[active].name,
      activePlayerColor: P[active].color, currentDarts: [],
      players: P.map((p, i) => ({ ...p, isActive: i === active, score: scores[p.id], marks: marks[p.id] })),
      ...extra,
    });
    script.push(
      () => { marks[1][20] = 1; render(snap()); },
      () => { marks[1][20] = 2; render(snap()); },
      () => { marks[1][20] = 3; render(snap()); },
      () => { active = 1; render(snap()); },
      () => { marks[2][19] = 1; marks[2][25] = 1; render(snap()); },
      () => { active = 2; render(snap()); },
      () => { marks[3][20] = 3; scores[3] += 20; render(snap()); },
    );
  }

  // ----------------------------------------------------------- KILLER
  {
    let active = 0;
    const killerState = {
      1: { targetNumber: 7, touches: 0, isKiller: false, isEliminated: false },
      2: { targetNumber: 14, touches: 0, isKiller: false, isEliminated: false },
      3: { targetNumber: 3, touches: 0, isKiller: false, isEliminated: false },
    };
    const snap = (extra = {}) => ({
      type: 'state', mode: 'killer', matchTitle: 'Killer', turnIndex: 1, isCompetitive: false,
      activePlayerId: P[active].id, activePlayerName: P[active].name,
      activePlayerColor: P[active].color, currentDarts: [],
      players: P.map((p, i) => ({ ...p, isActive: i === active, ...killerState[p.id] })),
      ...extra,
    });
    script.push(
      () => { killerState[1].touches = 2; render(snap()); },
      () => { killerState[1].touches = 3; killerState[1].isKiller = true; render(snap({ event: { kind: 'becameKiller', player: 'Adrien' } })); },
      () => { active = 1; render(snap()); },
      () => { killerState[3].isEliminated = true; render(snap({ event: { kind: 'eliminated', player: 'Stéphane' } })); },
      () => { render(snap({ event: { kind: 'victory', player: 'Adrien', subtitle: 'Gloire au roi !' } })); },
    );
  }

    return script;
  }

  let script = buildScript();
  let stepIndex = 0;
  const runStep = () => {
    if (stepIndex > 0 && stepIndex % script.length === 0) script = buildScript();
    script[stepIndex % script.length]();
    stepIndex += 1;
  };
  runStep();
  setInterval(runStep, 2600);
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
