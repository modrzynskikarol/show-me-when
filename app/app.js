import { fetchIncidents, ack } from './api.js';

// SCHED-4513 (R4): the board refreshes itself every 2 seconds while open.
const REFRESH_MS = 2000;

const board = document.querySelector('[data-testid="board"]');
const list = document.querySelector('[data-testid="incident-list"]');
const loader = document.querySelector('[data-testid="loader"]');
const empty = document.querySelector('[data-testid="empty"]');
const status = document.querySelector('.status');

/** Incident ids acked from this board, with the ack reply. Survives re-renders. */
const acked = new Map();
/** Rows already on screen, keyed by incident id, so a refresh never rebuilds a row under the pointer. */
const rows = new Map();

// SCHED-4514 (R5): the viewer's own time zone and the viewer's own date order (dd/mm in EU locales).
const timeFormat = new Intl.DateTimeFormat(undefined, {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZoneName: 'short',
});
const localTime = (iso) => timeFormat.format(new Date(iso));

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

function markAcked(row, reply) {
  if (!row.querySelector('[data-testid="acked"]')) {
    const mark = el('span', { 'data-testid': 'acked', class: 'acked', title: `acked ${reply.ackedAt}` }, 'acked');
    row.querySelector('.action').append(mark);
  }
  row.classList.add('is-acked');
}

// SCHED-4515 (R2, changed by product on 2026-11-12): Ack left the row. A row opens its incident panel; the
// panel names the incident, and its Ack acks the incident the panel names. New rows still land live at the
// top (R1), so a click that lands on a row that just moved opens the wrong panel, and the panel says so
// before anything is acked.
const panel = document.querySelector('[data-testid="incident-panel"]');
const panelId = panel.querySelector('.panel-id');
const panelWhat = panel.querySelector('.panel-what');
const panelTime = panel.querySelector('.panel-time');
const panelAck = panel.querySelector('[data-testid="panel-ack"]');
const panelState = panel.querySelector('.panel-state');
let openId = null;
const incidentsById = new Map();

function showPanel(id) {
  const i = incidentsById.get(id);
  if (!i) return;
  openId = id;
  for (const [rid, row] of rows) row.classList.toggle('is-open', rid === id);
  panel.dataset.id = id;
  panelId.textContent = id;
  panelWhat.textContent = `${i.severity} · ${i.service} · ${i.region} · ${i.summary}`;
  panelTime.setAttribute('datetime', i.openedAt);
  panelTime.textContent = `opened ${localTime(i.openedAt)}`;
  const reply = acked.get(id);
  panelAck.hidden = Boolean(reply);
  panelAck.disabled = false;
  panelAck.textContent = `Ack ${id}`;
  panelState.hidden = !reply;
  panelState.textContent = reply ? `acked ${localTime(reply.ackedAt)}` : '';
  panel.hidden = false;
}

function closePanel() {
  openId = null;
  panel.hidden = true;
  delete panel.dataset.id;
  for (const row of rows.values()) row.classList.remove('is-open');
}

async function onPanelAck() {
  const id = panel.dataset.id; // the incident the panel names, never a position in the list
  if (!id || acked.has(id)) return;
  panelAck.disabled = true;
  panelAck.textContent = `acking ${id}…`;
  try {
    const reply = await ack(id);
    acked.set(id, reply);
    const row = rows.get(id);
    if (row) markAcked(row, reply);
  } catch (err) {
    console.error(err);
    showStatus(`Ack failed for ${id}. Try again.`);
  }
  if (openId === id) showPanel(id);
}
panelAck.addEventListener('click', onPanelAck);
panel.querySelector('.panel-close').addEventListener('click', closePanel);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && openId) closePanel();
});

function onRowOpen(event) {
  if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
  if (event.type === 'keydown') event.preventDefault();
  showPanel(event.currentTarget.dataset.id);
}

function buildRow(i) {
  const row = el('li', {
    'data-testid': 'incident-row',
    'data-id': i.id,
    class: `row ${i.severity}`,
    role: 'button',
    tabindex: '0',
    'aria-controls': 'incident-panel',
    'aria-label': `Open ${i.id}`,
  });
  row.append(
    el('span', { class: 'id' }, i.id),
    el('span', { class: 'sev' }, i.severity),
    el('span', { class: 'what' }, `${i.service} · ${i.region} · ${i.summary}`),
    el('time', { datetime: i.openedAt, title: i.openedAt }, localTime(i.openedAt)),
    el('span', { class: 'action' }),
  );
  if (acked.has(i.id)) markAcked(row, acked.get(i.id));
  if (openId === i.id) row.classList.add('is-open');
  row.addEventListener('click', onRowOpen);
  row.addEventListener('keydown', onRowOpen);
  return row;
}

function updateRow(row, i) {
  const time = row.querySelector('time');
  if (time.getAttribute('datetime') !== i.openedAt) {
    time.setAttribute('datetime', i.openedAt);
    time.title = i.openedAt;
    time.textContent = localTime(i.openedAt);
  }
}

// SCHED-4511 (R1): newest first; new incidents go in at the top, existing rows stay the same nodes.
function render(incidents) {
  const seen = new Set();
  let prev = null;
  for (const i of incidents) {
    seen.add(i.id);
    incidentsById.set(i.id, i);
    let row = rows.get(i.id);
    if (row) updateRow(row, i);
    else {
      row = buildRow(i);
      rows.set(i.id, row);
    }
    const want = prev ? prev.nextSibling : list.firstChild;
    if (want !== row) list.insertBefore(row, want);
    prev = row;
  }
  for (const [id, row] of rows) {
    if (!seen.has(id)) {
      row.remove();
      rows.delete(id);
    }
  }
  empty.hidden = incidents.length > 0;
}

function showStatus(text) {
  status.textContent = text;
  status.hidden = !text;
}

let loaded = false;
async function refresh() {
  try {
    const page = await fetchIncidents();
    render(page.incidents);
    if (!loaded) {
      loaded = true;
      // SCHED-4512 (R3): the loader is gone once the incidents are on screen.
      loader.remove();
      board.setAttribute('aria-busy', 'false');
    }
    showStatus('');
  } catch (err) {
    console.error(err);
    showStatus(loaded ? 'Connection lost. Retrying…' : 'Could not load incidents. Retrying…');
  } finally {
    // One request at a time: the next refresh is scheduled after this one ends.
    setTimeout(refresh, REFRESH_MS);
  }
}

refresh();
