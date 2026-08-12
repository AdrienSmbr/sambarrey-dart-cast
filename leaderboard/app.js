/*
  Classement SambarreyDart, lu en direct depuis Firestore.

  Page statique volontairement passive : aucun état de jeu n'est calculé ici,
  la tablette écrit un seul document ("leaderboard/current") à la fin de
  chaque partie, cette page ne fait que l'afficher. `onSnapshot` la tient à
  jour toute seule sans qu'il faille recharger — pratique si la page reste
  ouverte pendant qu'une autre manche se joue à la maison.
*/

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js';
import { getFirestore, doc, onSnapshot } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

/** Reprend les icônes Material de Podium.kt (EmojiEvents/WorkspacePremium/
 *  MilitaryTech) en SVG minimal — pas d'emoji dans cette page, comme dans
 *  l'app et le receiver Chromecast. */
const ICONS = {
  gold: '<svg class="medal-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M19 5h-2V3H7v2H5a2 2 0 0 0-2 2v1a4 4 0 0 0 4 4c.5 1.9 2 3.4 4 3.85V18H8v2h8v-2h-3v-2.15c2-.45 3.5-1.95 4-3.85a4 4 0 0 0 4-4V7a2 2 0 0 0-2-2zM5 8V7h2v2.8A2 2 0 0 1 5 8zm14 0a2 2 0 0 1-2 1.8V7h2v1z"/></svg>',
  silver: '<svg class="medal-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2 4 6v6c0 5 3.4 8.7 8 10 4.6-1.3 8-5 8-10V6l-8-4zm0 4.3 4.5 2.3v3.2c0 3.1-1.9 5.6-4.5 6.6-2.6-1-4.5-3.5-4.5-6.6V8.6L12 6.3z"/></svg>',
  bronze: '<svg class="medal-icon" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="15" r="6"/><path d="M9 3h6l-2.2 6.5a6.4 6.4 0 0 0-1.6 0L9 3z"/></svg>',
};

const el = (id) => document.getElementById(id);
const dom = {
  loading: el('loading'),
  empty: el('empty'),
  board: el('board'),
  podium: el('podium'),
  jokeLine: el('jokeLine'),
  rest: el('rest'),
  updatedAt: el('updatedAt'),
  welcome: el('welcome'),
  welcomeClose: el('welcomeClose'),
  tabPodium: el('tabPodium'),
  tabByMode: el('tabByMode'),
  podiumView: el('podiumView'),
  modeView: el('modeView'),
  modeList: el('modeList'),
};

/** Reprend les 2 vues de LeaderboardScreen.kt (Podium / Détail par mode) : le
 *  podium met en scène le trio de tête, l'autre onglet liste tout le monde
 *  avec sa répartition de victoires par jeu — pour que chacun se retrouve,
 *  pas seulement le trio de tête. */
let activeTab = 'podium';
let lastPlayers = [];

function selectTab(tab) {
  activeTab = tab;
  dom.tabPodium.classList.toggle('active', tab === 'podium');
  dom.tabPodium.setAttribute('aria-selected', String(tab === 'podium'));
  dom.tabByMode.classList.toggle('active', tab === 'byMode');
  dom.tabByMode.setAttribute('aria-selected', String(tab === 'byMode'));
  dom.podiumView.classList.toggle('hidden', tab !== 'podium');
  dom.modeView.classList.toggle('hidden', tab !== 'byMode');
}

dom.tabPodium.addEventListener('click', () => selectTab('podium'));
dom.tabByMode.addEventListener('click', () => selectTab('byMode'));

/** Joué une fois par visite, à la première réception d'un classement réel. */
let welcomeShown = false;

function showWelcome() {
  if (welcomeShown) return;
  welcomeShown = true;
  dom.welcome.classList.remove('hidden');
}

function hideWelcome() {
  dom.welcome.classList.add('hidden');
}

dom.welcomeClose.addEventListener('click', hideWelcome);
dom.welcome.addEventListener('click', (e) => {
  if (e.target === dom.welcome) hideWelcome();
});

function initials(name) {
  return (name || '?').trim().charAt(0).toUpperCase() || '?';
}

function showState(state) {
  dom.loading.classList.toggle('hidden', state !== 'loading');
  dom.empty.classList.toggle('hidden', state !== 'empty');
  dom.board.classList.toggle('hidden', state !== 'board');
}

function medalAvatar(player, sizeClassParent) {
  const wrap = document.createElement('div');
  wrap.className = 'medal-avatar';
  wrap.innerHTML = `
    <div class="medal-ring">
      <div class="avatar" style="background:${player.avatarColorHex || '#FF6D00'}">${initials(player.name)}</div>
    </div>
    <div class="medal-pill">${sizeClassParent === 'champion' ? '1er' : sizeClassParent === 'silver' ? '2e' : '3e'}</div>
  `;
  return wrap;
}

function renderChampion(player) {
  const frame = document.createElement('div');
  frame.className = 'champion-frame';
  frame.innerHTML = `
    <div class="champion-card">
      <div class="champion-avatar-slot"></div>
      <div class="champion-body">
        <div class="champion-kicker">${ICONS.gold}CHAMPION</div>
        <div class="champion-name">${player.name}</div>
        <div class="chips">
          <span class="chip" style="--chip-color:#F2B705"><span class="value">${player.firstPlaces}</span><span class="label">victoires</span></span>
          <span class="chip" style="--chip-color:#F2B705"><span class="value">${player.podiumFinishes}</span><span class="label">podiums</span></span>
          <span class="chip" style="--chip-color:#F2B705"><span class="value">${Math.round(player.winRatio)}%</span><span class="label">réussite</span></span>
        </div>
      </div>
    </div>
  `;
  frame.querySelector('.champion-avatar-slot').replaceWith(medalAvatar(player, 'champion'));
  return frame;
}

function renderRunnerUp(player, rank) {
  const medalClass = rank === 2 ? 'silver' : 'bronze';
  const icon = rank === 2 ? ICONS.silver : ICONS.bronze;
  const label = rank === 2 ? '2E' : '3E';
  const card = document.createElement('div');
  card.className = `runner-card ${medalClass}`;
  card.innerHTML = `
    <div class="runner-avatar-slot"></div>
    <div class="runner-body">
      <div class="runner-kicker">${icon}${label}</div>
      <div class="runner-name">${player.name}</div>
      <div class="runner-sub">${player.firstPlaces} victoires · ${player.gamesPlayed} parties</div>
    </div>
  `;
  card.querySelector('.runner-avatar-slot').replaceWith(medalAvatar(player, medalClass));
  return card;
}

function renderRestRow(player, position) {
  const row = document.createElement('div');
  row.className = 'rest-row';
  row.innerHTML = `
    <div class="rest-position">${position}</div>
    <div class="rest-avatar" style="background:${player.avatarColorHex || '#FF6D00'}">${initials(player.name)}</div>
    <div class="rest-name">${player.name}</div>
    <div class="rest-sub">${player.firstPlaces} v. · ${player.gamesPlayed} parties</div>
  `;
  return row;
}

/** Une pastille "N" + son libellé, sur le modèle des chips du podium. */
function modeChip(value, label) {
  return `<span class="mode-chip"><span class="value">${value}</span><span class="label">${label}</span></span>`;
}

function renderModeRow(player) {
  const row = document.createElement('div');
  row.className = 'mode-row';
  row.innerHTML = `
    <div class="mode-row-avatar" style="background:${player.avatarColorHex || '#FF6D00'}">${initials(player.name)}</div>
    <div class="mode-row-name">${player.name}</div>
    <div class="mode-row-chips">
      ${modeChip(player.x01Wins ?? 0, '301')}
      ${modeChip(player.cricketWins ?? 0, 'Cricket')}
      ${modeChip(player.killerWins ?? 0, 'Killer')}
      ${modeChip(`${player.duoWins ?? 0}/${player.duoGamesPlayed ?? 0}`, 'Duo')}
    </div>
  `;
  return row;
}

function renderModeList(players) {
  dom.modeList.innerHTML = '';
  players.forEach((player) => dom.modeList.appendChild(renderModeRow(player)));
}

function render(data) {
  const players = Array.isArray(data.players) ? data.players : [];
  if (players.length === 0) {
    showState('empty');
    return;
  }

  lastPlayers = players;

  dom.podium.innerHTML = '';
  dom.rest.innerHTML = '';

  const champion = players[0];
  const runners = players.slice(1, 3);

  dom.podium.appendChild(renderChampion(champion));
  if (runners.length > 0) {
    const row = document.createElement('div');
    row.className = 'runners';
    runners.forEach((p, i) => row.appendChild(renderRunnerUp(p, i + 2)));
    dom.podium.appendChild(row);
  }

  // Blague perso : n'a de sens que quand ce n'est pas Adrien en tête.
  dom.jokeLine.classList.toggle('hidden', (champion.name || '').trim().toLowerCase() === 'adrien');

  players.slice(3).forEach((p, i) => dom.rest.appendChild(renderRestRow(p, i + 4)));

  // Le détail par mode liste TOUT le monde, pas seulement le trio de tête —
  // c'est justement le principe : chacun retrouve sa propre répartition.
  renderModeList(players);

  if (data.updatedAt) {
    dom.updatedAt.textContent = `Mis à jour ${formatRelativeTime(data.updatedAt)}`;
    dom.updatedAt.classList.remove('hidden');
  }

  showState('board');
  showWelcome();
}

function formatRelativeTime(timestamp) {
  // Timestamp Firestore (objet {seconds}) ou Date, selon la source (vrai
  // serveur vs démo locale) : on couvre les deux plutôt que de planter.
  const date = typeof timestamp.toDate === 'function' ? timestamp.toDate() : new Date(timestamp);
  const diffMin = Math.round((Date.now() - date.getTime()) / 60000);
  if (diffMin < 1) return "à l'instant";
  if (diffMin < 60) return `il y a ${diffMin} min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `il y a ${diffH} h`;
  return date.toLocaleDateString('fr-FR');
}

// --------------------------------------------------------------- DÉMARRAGE

const forceDemo = new URLSearchParams(location.search).has('demo');

if (forceDemo) {
  render({
    updatedAt: new Date(),
    players: [
      { name: 'Adrien', avatarColorHex: '#7E57C2', gamesPlayed: 18, totalWins: 9, winRatio: 50, firstPlaces: 9, secondPlaces: 4, thirdPlaces: 2, podiumFinishes: 15, podiumPoints: 43, x01Wins: 4, cricketWins: 3, killerWins: 2, duoWins: 3, duoGamesPlayed: 5 },
      { name: 'Laura', avatarColorHex: '#EC407A', gamesPlayed: 15, totalWins: 5, winRatio: 33, firstPlaces: 5, secondPlaces: 6, thirdPlaces: 1, podiumFinishes: 12, podiumPoints: 28, x01Wins: 2, cricketWins: 1, killerWins: 1, duoWins: 1, duoGamesPlayed: 4 },
      { name: 'Stéphane', avatarColorHex: '#26A69A', gamesPlayed: 14, totalWins: 3, winRatio: 21, firstPlaces: 3, secondPlaces: 2, thirdPlaces: 5, podiumFinishes: 10, podiumPoints: 18, x01Wins: 1, cricketWins: 1, killerWins: 1, duoWins: 0, duoGamesPlayed: 3 },
      { name: 'Stéphanie', avatarColorHex: '#42A5F5', gamesPlayed: 10, totalWins: 1, winRatio: 10, firstPlaces: 1, secondPlaces: 1, thirdPlaces: 2, podiumFinishes: 4, podiumPoints: 7, x01Wins: 1, cricketWins: 0, killerWins: 0, duoWins: 0, duoGamesPlayed: 2 },
      { name: 'Julien', avatarColorHex: '#FFA726', gamesPlayed: 8, totalWins: 0, winRatio: 0, firstPlaces: 0, secondPlaces: 1, thirdPlaces: 1, podiumFinishes: 2, podiumPoints: 3, x01Wins: 0, cricketWins: 0, killerWins: 0, duoWins: 0, duoGamesPlayed: 1 },
    ],
  });
} else {
  showState('loading');
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);
  onSnapshot(
    doc(db, 'leaderboard', 'current'),
    (snap) => (snap.exists() ? render(snap.data()) : showState('empty')),
    () => showState('empty')
  );
}
