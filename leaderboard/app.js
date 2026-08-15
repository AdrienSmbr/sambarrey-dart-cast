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
  sheet: el('playerSheet'),
  sheetAvatar: el('sheetAvatar'),
  sheetName: el('sheetName'),
  sheetKpis: el('sheetKpis'),
  sheetBody: el('sheetBody'),
  sheetClose: el('sheetClose'),
  sheetTabPodium: el('sheetTabPodium'),
  sheetTabByMode: el('sheetTabByMode'),
};

/** Les noms viennent de la base de la maison, mais ils traversent `innerHTML` :
 *  une apostrophe ou un chevron dans un prénom ne doit pas casser la page. */
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const int = (value) => Math.round(Number(value) || 0);
const pct = (value) => `${Math.round(Number(value) || 0)}%`;
const dec = (value) => (Number(value) || 0).toFixed(1);

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

/** Rend une ligne du classement cliquable : partout, le clic ouvre la fiche. */
function openable(node, player, tab) {
  node.classList.add('openable');
  node.setAttribute('role', 'button');
  node.setAttribute('tabindex', '0');
  node.addEventListener('click', () => openSheet(player, tab));
  node.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openSheet(player, tab);
    }
  });
  return node;
}

function renderChampion(player) {
  const frame = document.createElement('div');
  frame.className = 'champion-frame';
  frame.innerHTML = `
    <div class="champion-card">
      <div class="champion-avatar-slot"></div>
      <div class="champion-body">
        <div class="champion-kicker">${ICONS.gold}CHAMPION</div>
        <div class="champion-name">${esc(player.name)}</div>
        <div class="chips">
          <span class="chip" style="--chip-color:#F2B705"><span class="value">${player.firstPlaces}</span><span class="label">victoires</span></span>
          <span class="chip" style="--chip-color:#F2B705"><span class="value">${player.podiumFinishes}</span><span class="label">podiums</span></span>
          <span class="chip" style="--chip-color:#F2B705"><span class="value">${Math.round(player.winRatio)}%</span><span class="label">réussite</span></span>
        </div>
      </div>
    </div>
  `;
  frame.querySelector('.champion-avatar-slot').replaceWith(medalAvatar(player, 'champion'));
  return openable(frame, player, 'podium');
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
      <div class="runner-name">${esc(player.name)}</div>
      <div class="runner-sub">${int(player.firstPlaces)} victoires · ${int(player.gamesPlayed)} parties</div>
    </div>
  `;
  card.querySelector('.runner-avatar-slot').replaceWith(medalAvatar(player, medalClass));
  return openable(card, player, 'podium');
}

function renderRestRow(player, position) {
  const row = document.createElement('div');
  row.className = 'rest-row';
  row.innerHTML = `
    <div class="rest-position">${position}</div>
    <div class="rest-avatar" style="background:${esc(player.avatarColorHex || '#FF6D00')}">${esc(initials(player.name))}</div>
    <div class="rest-name">${esc(player.name)}</div>
    <div class="rest-sub">${int(player.firstPlaces)} v. · ${int(player.gamesPlayed)} parties</div>
  `;
  return openable(row, player, 'podium');
}

/** Une pastille "N" + son libellé, sur le modèle des chips du podium. */
function modeChip(value, label) {
  return `<span class="mode-chip"><span class="value">${value}</span><span class="label">${label}</span></span>`;
}

function renderModeRow(player) {
  const row = document.createElement('div');
  row.className = 'mode-row';
  row.innerHTML = `
    <div class="mode-row-avatar" style="background:${esc(player.avatarColorHex || '#FF6D00')}">${esc(initials(player.name))}</div>
    <div class="mode-row-name">${esc(player.name)}</div>
    <div class="mode-row-chips">
      ${modeChip(int(player.x01Wins), '301')}
      ${modeChip(int(player.cricketWins), 'Cricket')}
      ${modeChip(int(player.killerWins), 'Killer')}
      ${modeChip(`${int(player.duoWins)}/${int(player.duoGamesPlayed)}`, 'Duo')}
    </div>
  `;
  // Ouverte depuis cet onglet, la fiche s'ouvre sur la même lecture — comme
  // dans l'app, où l'onglet d'origine choisit la vue affichée.
  return openable(row, player, 'byMode');
}

function renderModeList(players) {
  dom.modeList.innerHTML = '';
  players.forEach((player) => dom.modeList.appendChild(renderModeRow(player)));
}

// ------------------------------------------------------------ FICHE JOUEUR

/*
  Même fiche que sur la tablette (PlayerStatsDetailDialog) : deux lectures d'un
  seul joueur, l'une sur ses places et son duo, l'autre sur ses trois modes de
  jeu. Aucun calcul ici — moyennes et ratios arrivent déjà faits dans le
  document Firestore (LeaderboardPayload), pour que la même statistique ne
  puisse pas diverger entre l'app et cette page.
*/

let sheetPlayer = null;
let sheetTab = 'podium';

function statRow(label, value, highlighted = false) {
  return `
    <div class="stat-row${highlighted ? ' highlighted' : ''}">
      <span class="stat-label">${esc(label)}</span>
      <span class="stat-value">${esc(value)}</span>
    </div>
  `;
}

function statCard(title, accent, rows) {
  return `
    <section class="stat-card" style="--accent:${accent}">
      <h3>${esc(title)}</h3>
      ${rows.join('')}
    </section>
  `;
}

const SEPARATOR = '<div class="stat-separator"></div>';

function podiumCards(p) {
  return [
    statCard('Podium', 'var(--gold-tint)', [
      statRow('Premières places', int(p.firstPlaces)),
      statRow('Deuxièmes places', int(p.secondPlaces)),
      statRow('Troisièmes places', int(p.thirdPlaces)),
      SEPARATOR,
      statRow('Montées sur le podium', int(p.podiumFinishes)),
      statRow('Points podium', int(p.podiumPoints), true),
    ]),
    statCard('Duo', 'var(--primary)', [
      statRow('Parties en duo', int(p.duoGamesPlayed)),
      statRow('Victoires en duo', int(p.duoWins)),
      statRow('Taux de victoire', pct(p.duoWinRatio), true),
      SEPARATOR,
      statRow('Coéquipiers différents', int(p.duoPartners)),
    ]),
  ].join('');
}

function modeCards(p) {
  return [
    statCard('301 / 501 (X01)', 'var(--primary)', [
      statRow('Victoires', int(p.x01Wins)),
      SEPARATOR,
      statRow('Lancers total', int(p.x01TotalThrows)),
      statRow('Moy. / fléchette (PPD)', `${dec(p.x01PPD)} pts`),
      statRow('Moy. / volée (PPR)', `${dec(p.x01PPR)} pts`, true),
      statRow('Meilleure fléchette', `${int(p.bestDartScore)} pts`),
      statRow('Meilleure volée', `${int(p.bestTurnScore)} pts`),
      SEPARATOR,
      statRow('Triples', int(p.x01TripleCount)),
      statRow('Doubles', int(p.x01DoubleCount)),
      statRow('Ratés (0)', int(p.x01ZeroThrows)),
      statRow('Taux de raté', `${dec(p.x01ZeroRatio)}%`),
      statRow('Tours à vide', int(p.x01EmptyTurns)),
      statRow('Volées perdues (buste)', int(p.x01Busts)),
    ]),
    statCard('Cricket', 'var(--silver-deep)', [
      statRow('Victoires', int(p.cricketWins)),
      SEPARATOR,
      statRow('Lancers total', int(p.cricketTotalHits)),
      statRow('Triples', int(p.cricketTriples)),
      statRow('Doubles', int(p.cricketDoubles)),
      SEPARATOR,
      statRow('Tours à vide', int(p.cricketEmptyTurns), true),
      statRow('Cibles touchées', int(p.cricketUsefulHits)),
      statRow('Taux de tour à vide', `${dec(p.cricketEmptyTurnRatio)}%`),
    ]),
    statCard('Killer', 'var(--bronze-tint)', [
      statRow('Victoires', int(p.killerWins)),
      SEPARATOR,
      statRow('Adversaires éliminés', int(p.killerEliminations), true),
      statRow('Fois éliminé', int(p.killerTimesEliminated)),
      statRow('Ratio élim. / subies', dec(p.killerEliminationRatio)),
      SEPARATOR,
      statRow('Lancers total', int(p.killerTotalThrows)),
      statRow('Tours à vide', int(p.killerEmptyTurns)),
      statRow('Taux de tour à vide', `${dec(p.killerEmptyTurnRatio)}%`),
    ]),
  ].join('');
}

function renderSheet() {
  const p = sheetPlayer;
  if (!p) return;

  const color = p.avatarColorHex || '#FF6D00';
  dom.sheetAvatar.style.background = color;
  dom.sheetAvatar.textContent = initials(p.name);
  dom.sheetName.textContent = p.name || '';

  dom.sheetKpis.innerHTML = `
    <div class="kpi"><span class="value">${int(p.gamesPlayed)}</span><span class="label">Parties</span></div>
    <div class="kpi"><span class="value">${int(p.totalWins)}</span><span class="label">Victoires</span></div>
    <div class="kpi primary"><span class="value">${pct(p.winRatio)}</span><span class="label">Ratio</span></div>
  `;

  dom.sheetTabPodium.classList.toggle('active', sheetTab === 'podium');
  dom.sheetTabPodium.setAttribute('aria-selected', String(sheetTab === 'podium'));
  dom.sheetTabByMode.classList.toggle('active', sheetTab === 'byMode');
  dom.sheetTabByMode.setAttribute('aria-selected', String(sheetTab === 'byMode'));

  dom.sheetBody.innerHTML = sheetTab === 'podium' ? podiumCards(p) : modeCards(p);
  dom.sheetBody.scrollTop = 0;
}

function openSheet(player, tab) {
  sheetPlayer = player;
  sheetTab = tab || 'podium';
  renderSheet();
  dom.sheet.classList.remove('hidden');
  // La page derrière ne doit pas défiler sous la fiche : au doigt, on ne sait
  // plus lequel des deux on fait bouger.
  document.body.classList.add('sheet-open');
}

function closeSheet() {
  dom.sheet.classList.add('hidden');
  document.body.classList.remove('sheet-open');
  sheetPlayer = null;
}

dom.sheetClose.addEventListener('click', closeSheet);
dom.sheet.addEventListener('click', (e) => {
  if (e.target === dom.sheet) closeSheet();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !dom.sheet.classList.contains('hidden')) closeSheet();
});
dom.sheetTabPodium.addEventListener('click', () => { sheetTab = 'podium'; renderSheet(); });
dom.sheetTabByMode.addEventListener('click', () => { sheetTab = 'byMode'; renderSheet(); });

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

/** Complète une fiche de démo : la fiche joueur lit une vingtaine de champs,
 *  les énumérer cinq fois rendrait le bloc de démo illisible. */
function demoPlayer(base) {
  return {
    duoWinRatio: base.duoGamesPlayed ? (base.duoWins / base.duoGamesPlayed) * 100 : 0,
    duoPartners: 2,
    x01TotalThrows: 240, x01PPD: 18.4, x01PPR: 55.2, bestDartScore: 60, bestTurnScore: 140,
    x01TripleCount: 21, x01DoubleCount: 17, x01ZeroThrows: 26, x01ZeroRatio: 10.8,
    x01EmptyTurns: 5, x01Busts: 9,
    cricketTotalHits: 132, cricketTriples: 9, cricketDoubles: 14,
    cricketEmptyTurns: 6, cricketUsefulHits: 114, cricketEmptyTurnRatio: 13.6,
    killerTotalThrows: 96, killerEmptyTurns: 7, killerEmptyTurnRatio: 21.9,
    killerEliminations: 6, killerTimesEliminated: 4, killerEliminationRatio: 1.5,
    ...base,
  };
}

if (forceDemo) {
  render({
    updatedAt: new Date(),
    players: [
      { name: 'Adrien', avatarColorHex: '#7E57C2', gamesPlayed: 18, totalWins: 9, winRatio: 50, firstPlaces: 9, secondPlaces: 4, thirdPlaces: 2, podiumFinishes: 15, podiumPoints: 43, x01Wins: 4, cricketWins: 3, killerWins: 2, duoWins: 3, duoGamesPlayed: 5 },
      { name: 'Laura', avatarColorHex: '#EC407A', gamesPlayed: 15, totalWins: 5, winRatio: 33, firstPlaces: 5, secondPlaces: 6, thirdPlaces: 1, podiumFinishes: 12, podiumPoints: 28, x01Wins: 2, cricketWins: 1, killerWins: 1, duoWins: 1, duoGamesPlayed: 4 },
      { name: 'Stéphane', avatarColorHex: '#26A69A', gamesPlayed: 14, totalWins: 3, winRatio: 21, firstPlaces: 3, secondPlaces: 2, thirdPlaces: 5, podiumFinishes: 10, podiumPoints: 18, x01Wins: 1, cricketWins: 1, killerWins: 1, duoWins: 0, duoGamesPlayed: 3 },
      { name: 'Stéphanie', avatarColorHex: '#42A5F5', gamesPlayed: 10, totalWins: 1, winRatio: 10, firstPlaces: 1, secondPlaces: 1, thirdPlaces: 2, podiumFinishes: 4, podiumPoints: 7, x01Wins: 1, cricketWins: 0, killerWins: 0, duoWins: 0, duoGamesPlayed: 2 },
      { name: 'Julien', avatarColorHex: '#FFA726', gamesPlayed: 8, totalWins: 0, winRatio: 0, firstPlaces: 0, secondPlaces: 1, thirdPlaces: 1, podiumFinishes: 2, podiumPoints: 3, x01Wins: 0, cricketWins: 0, killerWins: 0, duoWins: 0, duoGamesPlayed: 1 },
    ].map(demoPlayer),
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
