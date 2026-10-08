// Leaderboard: All-time (total points) and Blood (best single run). Fetched when a tab opens, never polled.
// The player's own row is recognised ONLY by the board id (a hash of their private id), never by name.

import { formatNumber, t } from '../i18n/index.js';
import { boardId } from '../sync/index.js';
import { $, $$, el, isRtl, onAction, say } from './dom.js';

const TABS = ['all', 'blood'];

/** @param {any} app */
export function createBoard(app) {
  const { remote } = app;
  const root = app.sections.board;
  const tablist = $(root, '[role="tablist"]');
  const panel = $(root, '[role="tabpanel"]');
  const rowsEl = $(root, '[data-slot="board-rows"]');
  const caption = $(root, 'caption');
  const pointsHead = $(root, 'thead th:last-child');
  const cache = { all: null, blood: null };
  let tab = 'all';
  let seq = 0;
  let myBid = null;
  let myBidFor = null;

  const msg = (key, tone) => say(root, key ? t(key) : '', tone || 'info', { sticky: true });

  function paintTabs(focus) {
    for (const b of $$(tablist, '[role="tab"]')) {
      const on = b.getAttribute('data-tab') === tab;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    }
    panel.setAttribute('aria-labelledby', `board-tab-${tab}`);
    const key = tab === 'all' ? 'all' : 'blood';
    caption.setAttribute('data-i18n', `board.caption.${key}`);
    caption.textContent = t(`board.caption.${key}`);
    pointsHead.setAttribute('data-i18n', tab === 'all' ? 'board.col.points' : 'board.col.bestRun');
    pointsHead.textContent = t(tab === 'all' ? 'board.col.points' : 'board.col.bestRun');
  }

  function paintRows(rows) {
    const value = (r) => (tab === 'all' ? r.total : r.bestRun);
    const list = rows.filter((r) => value(r) > 0);
    rowsEl.replaceChildren(
      ...list.map((r, i) => {
        const bdi = el('bdi', {}, r.name);
        const th = el('th', { scope: 'row' }, bdi);
        const tr = el('tr', {}, el('td', {}, formatNumber(i + 1)), th, el('td', {}, formatNumber(value(r))));
        if (myBid !== null && r.bid === myBid) {
          tr.dataset.self = 'true';
          tr.setAttribute('aria-current', 'true');
          th.append(' ', el('span', {}, t('board.you')));
        }
        return tr;
      }),
    );
    return list.length;
  }

  async function load() {
    const mine = ++seq;
    // "Which row is mine" comes ONLY from the random board key inside my save (never from name or code).
    const bk = app.sync.getSave()?.bk || null;
    if (bk !== myBidFor) {
      myBidFor = bk;
      myBid = bk ? await boardId(bk).catch(() => null) : null;
    }
    const cached = cache[tab];
    if (cached) msg(paintRows(cached) ? '' : 'board.empty');
    else {
      rowsEl.replaceChildren();
      msg('board.loading');
    }
    const r = await remote.listBoard({ orderBy: tab === 'all' ? 'total' : 'bestRun', limit: 50 });
    if (mine !== seq) return; // a newer tab/open superseded this response
    if (r.ok) {
      cache[tab] = r.data;
      msg(paintRows(r.data) ? '' : 'board.empty');
    } else if (cached) {
      msg('board.offlineStale', 'info');
    } else if (r.reason === 'offline') {
      msg('board.offline', 'bad');
    } else {
      msg(r.reason === 'denied' ? 'board.denied' : 'board.error', 'bad');
    }
  }

  function choose(name, focus) {
    if (!TABS.includes(name)) return;
    tab = name;
    paintTabs(focus);
    void load();
  }

  tablist.addEventListener('keydown', (e) => {
    const i = TABS.indexOf(tab);
    let next = -1;
    const fwd = isRtl(tablist) ? 'ArrowLeft' : 'ArrowRight';
    const back = isRtl(tablist) ? 'ArrowRight' : 'ArrowLeft';
    if (e.key === fwd) next = (i + 1) % TABS.length;
    else if (e.key === back) next = (i + TABS.length - 1) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    choose(TABS[next], true);
  });

  onAction(
    root,
    { back: () => app.router.back('home') },
    (target) => {
      const b = target.closest('[data-tab]');
      if (b) choose(b.getAttribute('data-tab'), false);
    },
  );

  return {
    enter() {
      tab = 'all';
      paintTabs(false);
      void load();
    },
    rerender() {
      if (root.hidden) return;
      paintTabs(false);
      if (cache[tab]) paintRows(cache[tab]);
    },
  };
}
