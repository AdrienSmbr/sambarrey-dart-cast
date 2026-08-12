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

/** Une barre pleine = une touche sur son propre chiffre, en Killer classique. */
const TALLY_BAR = '<svg class="bar" viewBox="0 0 10 32" fill="currentColor"><rect x="1" y="1" width="8" height="30" rx="3"/></svg>';

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
  // Plusieurs façons de finir plutôt qu'une seule : la tablette en envoie
  // jusqu'à 3, la meilleure en tête.
  const options = Array.isArray(state.checkout) ? state.checkout : [];
  const hasCheckout = options.length > 0;
  dom.checkout.classList.toggle('hidden', !hasCheckout);
  if (hasCheckout) {
    const [first, ...rest] = options;
    const altHtml = rest.map((option) => `<span class="sep">ou</span><span class="value alt">${option}</span>`).join('');
    dom.checkout.innerHTML = `${ICONS.target}<span class="label">Checkout ${state.activePlayerRemainingScore ?? ''} :</span><span class="value">${first}</span>${altHtml}`;
  }

  const hasBust = !!state.bustMessage;
  dom.bust.classList.toggle('hidden', !hasBust);
  if (hasBust) dom.bust.innerHTML = `${ICONS.warning}<span>${state.bustMessage}</span>`;
}

// ------------------------------------------------------- GRILLE X01 / KILLER

function renderCardGrid(state) {
  const players = state.players || [];
  // Killer partage désormais exactement la même grille de cartes que le X01
  // (même form-factor pour tous les modes) : la bordure ne sert plus qu'à
  // dire "c'est son tour", pas à coder le statut killer/éliminé en plus.
  const count = players.length > 6 ? 'many' : String(players.length);
  const layoutKey = `cards:grid:${count}:${players.length}`;

  if (playersLayoutKey !== layoutKey) {
    dom.players.className = 'players';
    dom.players.dataset.count = count;
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
    <div class="card-head">
      <div class="avatar"></div>
      <div style="min-width:0">
        <div class="name"></div>
      </div>
    </div>
    <div class="members hidden"></div>
    <div class="card-center">
      <div class="score"></div>
      <div class="target-pill hidden">
        <span class="killer-target-label">Cible</span>
        <span class="killer-target-num"></span>
      </div>
    </div>
    <div class="foot"></div>
  `;
  return card;
}

function updateCard(card, player, state) {
  const isKiller = state.mode === 'killer';
  card.style.setProperty('--player-color', player.color || '#FF6D00');

  // La bordure colorée suit UNIQUEMENT le tour, comme au X01 — le statut
  // killer/éliminé se lit sur le badge, pas sur la bordure (sinon on ne sait
  // plus si la carte accentuée est "à qui le tour" ou "qui est le tueur").
  card.classList.toggle('active', !!player.isActive);
  card.classList.toggle('killer-status', isKiller && !!player.isKiller && !player.isEliminated);
  card.classList.toggle('eliminated-status', isKiller && !!player.isEliminated);

  // En duo la carte porte une équipe : pas d'avatar unique en tête, mais la
  // liste des coéquipiers dessous, celui qui lance étant mis en avant — c'est
  // la composition de TeamScoreCard côté app.
  const members = Array.isArray(player.members) ? player.members : null;
  card.classList.toggle('team-card', !!members);

  const avatar = card.querySelector('.avatar');
  avatar.style.display = members ? 'none' : '';
  if (!members) {
    avatar.style.background = player.color || '#FF6D00';
    avatar.textContent = initials(player.name);
  }

  card.querySelector('.name').textContent = player.name || '';

  // Une carte recyclée peut venir d'une configuration différente (une
  // équipe redevenue un joueur seul, par ex., si deux parties s'enchaînent
  // avec le même nombre de cartes) : on vide toujours le HTML plutôt que de
  // ne le faire que dans le cas "rempli", sinon le contenu masqué reste
  // périmé en mémoire au lieu d'être remplacé.
  const memberBox = card.querySelector('.members');
  memberBox.classList.toggle('hidden', !members);
  memberBox.innerHTML = members ? members.map((member) => `
      <span class="member${member.isThrowing ? ' throwing' : ''}">
        <span class="member-avatar" style="background:${member.color || '#FF6D00'}">${initials(member.name)}</span>
        <span class="member-name">${member.name || ''}</span>
      </span>
    `).join('') : '';

  const pill = card.querySelector('.target-pill');
  pill.classList.toggle('hidden', !isKiller);
  pill.querySelector('.killer-target-num').textContent = player.targetNumber ?? '—';

  const score = card.querySelector('.score');
  const next = String(player.score ?? 0);
  if (score.textContent !== next) {
    score.textContent = next;
    replayAnimation(score, 'bump');
  }
  // Au Killer le score numérique de la carte n'a pas de sens (c'est la cible
  // qui porte l'information au centre) : on masque la cellule au lieu
  // d'afficher 0.
  score.style.display = isKiller ? 'none' : '';

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
    badge.innerHTML = `${ICONS.fire}<span>KILLER</span>`;
    return;
  }

  // Trois jauges toujours visibles plutôt qu'un chiffre "X/3" : à distance
  // un nombre seul reste ambigu (2 sur combien ?), la vraie barre remplie
  // se lit d'un coup d'œil, façon jauge de vie.
  badge.className = 'status-badge touches';
  const touches = player.touches ?? 0;
  badge.innerHTML = `<span class="tally">${[0, 1, 2].map((i) =>
    `<span class="tally-bar${i < touches ? ' filled' : ''}">${TALLY_BAR}</span>`
  ).join('')}</span>`;
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
      <div class="row cricket-members hidden"></div>
      <div class="row">
        <span class="score"></span>
      </div>
    </div>
    ${targets.map(() => '<div class="cricket-cell"></div>').join('')}
  `;
  return col;
}

function updateCricketColumn(col, player, targets, state) {
  col.classList.toggle('active', !!player.isActive);

  // Même logique qu'en X01 duo : une colonne par équipe, les coéquipiers en
  // pastilles sous le nom plutôt qu'un avatar unique.
  const members = Array.isArray(player.members) ? player.members : null;

  const avatar = col.querySelector('.cricket-avatar');
  avatar.style.display = members ? 'none' : '';
  if (!members) {
    avatar.style.background = player.color || '#FF6D00';
    avatar.textContent = initials(player.name);
  }
  col.querySelector('.name').textContent = player.name || '';

  const memberBox = col.querySelector('.cricket-members');
  memberBox.classList.toggle('hidden', !members);
  if (members) {
    memberBox.innerHTML = members.map((member) => `
      <span class="member-avatar mini${member.isThrowing ? ' throwing' : ''}" style="background:${member.color || '#FF6D00'}">${initials(member.name)}</span>
    `).join('');
  }

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

/** Reproduit CricketMarkSymbol() : point / slash / X / rond vert coché. */
function cricketMarkSymbol(hits) {
  if (hits >= 3) return `<span class="mark-closed">${ICONS.check}</span>`;
  if (hits === 2) return '<span class="mark-x">X</span>';
  if (hits === 1) return '<span class="mark-slash">/</span>';
  return '<span class="mark-dot"></span>';
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

function showOverlay({ icon, title, name, sub, color, duration = 2800 }) {
  clearTimeout(overlayTimer);

  dom.overlayIcon.innerHTML = icon || '';
  dom.overlayIcon.classList.remove('hidden');

  dom.overlayTitle.textContent = title;
  dom.overlayName.textContent = name || '';
  dom.overlaySub.textContent = sub || '';
  dom.overlay.style.setProperty('--overlay-color', color || '#FF6D00');
  dom.overlay.classList.remove('hidden');
  replayAnimation(dom.overlay.querySelector('.overlay-inner'), 'pop');

  // Le plateau tremble tant que la carte reste affichée, exactement comme
  // shakeWhile() côté app — pas un simple aller-retour de 480ms.
  dom.game.classList.add('quaking');

  overlayTimer = setTimeout(() => {
    dom.overlay.classList.add('hidden');
    dom.game.classList.remove('quaking');
  }, duration);
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
      // showOverlay() se charge déjà de faire trembler le plateau tant que la
      // carte reste affichée, plus besoin du quake() ponctuel en plus.
      showOverlay({ icon: ICONS.fire, title: 'Nouveau killer', name: event.player, color: '#FF6D00' });
      confetti({ colors: ['#FF6D00', '#FFC107', '#FF1744'], count: 90, spread: 'up' });
      break;

    case 'eliminated':
      showOverlay({ icon: ICONS.eliminated, title: 'Élimination', name: event.player, color: '#FF1744' });
      break;

    case 'victory':
      showOverlay({
        icon: ICONS.trophy,
        title: 'Victoire',
        name: event.player,
        sub: event.subtitle || '',
        color: '#FFC107',
        duration: 3000,
      });
      confetti({ count: 320, duration: 3000 });
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

  // Table pleine : sert aux séquences duo et Killer compétitif, où l'enjeu est
  // justement de voir ce que donne l'écran quand on joue nombreux.
  const BIG = [
    { id: 1, name: 'Adrien', color: '#7e57c2' },
    { id: 2, name: 'Laura', color: '#ec407a' },
    { id: 3, name: 'Stéphane', color: '#26a69a' },
    { id: 4, name: 'Stéphanie', color: '#42a5f5' },
    { id: 5, name: 'Julien', color: '#ffa726' },
    { id: 6, name: 'Camille', color: '#ab47bc' },
    { id: 7, name: 'Nicolas', color: '#66bb6a' },
    { id: 8, name: 'Élodie', color: '#ef5350' },
    { id: 9, name: 'Thomas', color: '#5c6bc0' },
    { id: 10, name: 'Marine', color: '#26c6da' },
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
      () => { active = 0; darts = []; render(snap({ checkout: ['T20 D20', '20 T20 D10'] })); },
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

  // -------------------------------------------------- 501 DUO (8 joueurs)
  // Une carte par ÉQUIPE, pas par joueur : les coéquipiers partagent un seul
  // score, et seul celui qui a les fléchettes est mis en avant.
  {
    const roster = BIG.slice(0, 8);
    const teamOf = (index) => Math.floor(index / 2) + 1;
    const teams = [1, 2, 3, 4];
    const scores = { 1: 501, 2: 501, 3: 501, 4: 501 };
    let thrower = 0;
    let darts = [];

    const snap = (extra = {}) => {
      const active = teamOf(thrower);
      return {
        type: 'state', mode: 'x01', matchTitle: '501 duo', turnIndex: 1,
        // Le bandeau nomme la personne qui lance, la carte porte l'équipe.
        activePlayerId: roster[thrower].id,
        activePlayerName: roster[thrower].name,
        activePlayerColor: roster[thrower].color,
        activePlayerRemainingScore: scores[active],
        currentDarts: darts.slice(),
        players: teams.map((team) => ({
          id: -team,
          name: `Équipe ${team}`,
          color: '#FF6D00',
          isActive: team === active,
          score: scores[team],
          members: roster
            .filter((_, index) => teamOf(index) === team)
            .map((member) => ({
              id: member.id,
              name: member.name,
              color: member.color,
              isThrowing: member.id === roster[thrower].id,
            })),
        })),
        ...extra,
      };
    };

    script.push(
      () => { darts = [{ label: 'T20', points: 60 }]; scores[1] -= 60; render(snap()); },
      () => { darts.push({ label: 'T19', points: 57 }); scores[1] -= 57; render(snap()); },
      () => { thrower = 2; darts = []; render(snap()); },
      () => { darts = [{ label: 'BULL', points: 50 }]; scores[2] -= 50; render(snap()); },
      () => { thrower = 4; darts = []; render(snap()); },
      () => { darts = [{ label: 'D20', points: 40 }]; scores[3] -= 40; render(snap()); },
      // Au tour suivant c'est le COÉQUIPIER de l'équipe 1 qui lance : même
      // score, autre lanceur — c'est tout l'intérêt du duo.
      () => { thrower = 1; darts = []; render(snap()); },
      () => { darts = [{ label: 'T20', points: 60 }]; scores[1] -= 60; render(snap()); },
    );
  }

  // ------------------------------------- KILLER COMPÉTITIF (10 joueurs)
  // Ici pas de statut de tueur : chacun a des vies, et on joue jusqu'au
  // dernier debout. Le badge passe donc en cœurs.
  {
    const roster = BIG;
    const lives = {};
    roster.forEach((p, i) => { lives[p.id] = { targetNumber: (i * 2) + 1, touches: 5, isEliminated: false }; });
    let active = 0;

    const snap = (extra = {}) => ({
      type: 'state', mode: 'killer', matchTitle: 'Killer compétitif', turnIndex: 3,
      isCompetitive: true,
      activePlayerId: roster[active].id,
      activePlayerName: roster[active].name,
      activePlayerColor: roster[active].color,
      currentDarts: [],
      players: roster.map((p, i) => ({
        ...p,
        isActive: i === active,
        lives: lives[p.id].touches,
        ...lives[p.id],
      })),
      ...extra,
    });

    script.push(
      () => { lives[4].touches = 3; lives[7].touches = 2; render(snap()); },
      () => { active = 3; lives[9].touches = 1; render(snap()); },
      () => { active = 6; lives[9].touches = 0; lives[9].isEliminated = true; render(snap({ event: { kind: 'eliminated', player: 'Thomas' } })); },
      () => { active = 0; lives[8].touches = 1; render(snap()); },
      () => { lives[8].touches = 0; lives[8].isEliminated = true; render(snap({ event: { kind: 'eliminated', player: 'Élodie' } })); },
      () => { render(snap()); },
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
