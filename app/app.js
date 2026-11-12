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
  const button = row.querySelector('[data-testid="ack"]');
  if (button) button.remove();
  if (!row.querySelector('[data-testid="acked"]')) {
    const mark = el('span', { 'data-testid': 'acked', class: 'acked', title: `acked ${reply.ackedAt}` }, 'acked');
    row.querySelector('.action').append(mark);
  }
  row.classList.add('is-acked');
}

// SCHED-4511 (R2): Ack on a row acks that row's incident, by id, never by position.
async function onAck(event) {
  const button = event.currentTarget;
  const row = button.closest('[data-testid="incident-row"]');
  const id = row.dataset.id;
  button.disabled = true;
  button.textContent = 'acking…';
  try {
    const reply = await ack(id);
    acked.set(id, reply);
    markAcked(row, reply);
  } catch (err) {
    console.error(err);
    button.disabled = false;
    button.textContent = 'Ack';
    showStatus(`Ack failed for ${id}. Try again.`);
  }
}

function buildRow(i) {
  const row = el('li', { 'data-testid': 'incident-row', 'data-id': i.id, class: `row ${i.severity}` });
  row.append(
    el('span', { class: 'id' }, i.id),
    el('span', { class: 'sev' }, i.severity),
    el('span', { class: 'what' }, `${i.service} · ${i.region} · ${i.summary}`),
    el('time', { datetime: i.openedAt, title: i.openedAt }, localTime(i.openedAt)),
  );
  const action = el('span', { class: 'action' });
  row.append(action);
  if (acked.has(i.id)) {
    markAcked(row, acked.get(i.id));
  } else {
    const button = el('button', { type: 'button', 'data-testid': 'ack', class: 'ack' }, 'Ack');
    button.addEventListener('click', onAck);
    action.append(button);
  }
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
