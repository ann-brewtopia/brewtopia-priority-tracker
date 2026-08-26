// ============================================================================
// Rendering — this is largely PORTED, not rewritten. The original Claude-
// artifact app's rendering code only ever touched in-memory arrays; it never
// cared where those arrays came from. So this file looks close to the
// original tracker's render functions, with two real differences:
//   1. Every write goes through data.js's Supabase functions instead of
//      window.storage.
//   2. Permission checks (canEditTicket) are still done here for the UI
//      (disabling buttons, etc.) — but the REAL enforcement is server-side
//      via Row Level Security now. If you disabled the JS check entirely,
//      the database would still refuse the write. That's new, and it's the
//      whole point of moving off a browser-side identity picker.
//
// PORTED IN THIS PASS: Home (Team P1s + Follow-Ups), Daily Priorities
// (Cards view only).
// NOT YET PORTED: Compact view, KPIs tab, History, Users tab, Help tab,
// linking a priority to a follow-up. See README.md for why these were left
// for a follow-up pass instead of guessed at without a live database to
// test against.
// ============================================================================

const DAYS = ['Mon','Tue','Wed','Thu','Fri'];

function renderAll(){
  renderTickets();
  renderP1s();
  renderFollowups();
  renderKpiTab();
}

// ---------- sidebar tab switching ----------
document.querySelectorAll('.sidebar-item[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.sidebar-item[data-tab]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
    document.getElementById('tab-' + btn.dataset.tab).style.display = '';
  });
});

// ---------- Daily Priorities: ticket cards ----------
function renderTickets(){
  const rail = document.getElementById('ticketRail');
  rail.innerHTML = '';

  if(members.length === 0){
    rail.innerHTML = `<div class="rail-empty">No tickets yet — each team member adds their own below.</div>`;
  }

  members.forEach(m => {
    const editable = canEditTicket(m);
    const ticket = document.createElement('div');
    ticket.className = 'ticket' + (editable ? '' : ' locked');

    const dayBlocks = DAYS.map(d => {
      const entries = m.priorities.filter(p => p.day === d);
      const entryRows = entries.map(entry => `
        <div class="day-entry" data-entry-id="${entry.id}">
          <div class="day-entry-main">
            <textarea class="day-input" rows="1" data-entry-id="${entry.id}" ${editable ? '' : 'disabled'}>${escapeHtml(entry.text || '')}</textarea>
            <button class="flag-day-btn ${entry.flagged ? 'flagged' : ''}" data-entry-id="${entry.id}" title="Send to Team P1s" ${editable ? '' : 'disabled'}>&#9873;</button>
            <button class="due-day-btn ${entry.due ? 'has-due' : ''}" data-entry-id="${entry.id}" title="Set a due date" ${editable ? '' : 'disabled'}>&#128197;</button>
            <button class="remove-entry-mini" data-entry-id="${entry.id}" title="Remove this priority" ${editable ? '' : 'disabled'}>&times;</button>
          </div>
          ${statusButtonsHtml(entry.status, `data-entry-id="${entry.id}"`, editable)}
          ${entry.due ? `<div class="day-due-chip">&#128197; Due ${entry.due}</div>` : ''}
          ${entry.carried_weeks ? `<div class="carried-badge">&#8635; Week ${entry.carried_weeks + 1}</div>` : ''}
        </div>
      `).join('');
      const emptyNote = entries.length === 0 ? `<div class="day-empty-note">No priorities yet</div>` : '';
      const sched = (m.day_schedule && m.day_schedule[d]) || 'office';
      const schedLabels = { office: 'Office', remote: 'Remote', off: 'Off' };
      return `
        <div class="day-block ${sched === 'off' ? 'off' : ''}">
          <div class="day-block-label-row">
            <span class="day-block-label">${d}</span>
            <button class="dayschedule-btn active ${sched}" data-day="${d}" ${editable ? '' : 'disabled'}>${schedLabels[sched]}</button>
          </div>
          <div class="day-entries">${entryRows}${emptyNote}</div>
          <button class="add-mini-btn add-day-entry-btn" data-day="${d}" ${editable ? '' : 'disabled'}>+ Add priority</button>
        </div>
      `;
    }).join('');

    const lockNote = editable ? '' : `<div class="ticket-lock-note">&#128274; Only ${escapeHtml(m.name || 'this person')} (or admin) can edit this</div>`;

    ticket.innerHTML = `
      ${lockNote}
      <div class="ticket-top">
        <div style="flex:1">
          <input class="name" value="${escapeHtml(m.name)}" placeholder="Name" ${editable ? '' : 'disabled'} />
          <input class="role" value="${escapeHtml(m.title)}" placeholder="Role" ${editable ? '' : 'disabled'} />
        </div>
        ${editable ? '<button class="remove-x" title="Remove ticket">&times;</button>' : ''}
      </div>
      <div class="field-label">Daily Priorities</div>
      <div class="day-grid">${dayBlocks}</div>
    `;

    if(editable){
      ticket.querySelector('.name').addEventListener('change', e => updateMember(m.id, { name: e.target.value }));
      ticket.querySelector('.role').addEventListener('change', e => updateMember(m.id, { title: e.target.value }));

      ticket.querySelectorAll('.day-input').forEach(inp => {
        inp.addEventListener('change', e => updatePriority(e.target.dataset.entryId, { text: e.target.value }));
      });
      ticket.querySelectorAll('.status-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          await updatePriority(btn.dataset.entryId, { status: btn.dataset.status });
          await loadAllData();
        });
      });
      ticket.querySelectorAll('.flag-day-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const entry = m.priorities.find(p => p.id === btn.dataset.entryId);
          if(!entry || !(entry.text || '').trim()){ alert('Add text to this priority before flagging it.'); return; }
          await togglePriorityFlag(entry, m.name);
        });
      });
      ticket.querySelectorAll('.due-day-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const date = prompt('Due date (YYYY-MM-DD), blank to clear:');
          if(date === null) return;
          await updatePriority(btn.dataset.entryId, { due: date || null });
          await loadAllData();
        });
      });
      ticket.querySelectorAll('.remove-entry-mini').forEach(btn => {
        btn.addEventListener('click', () => deletePriority(btn.dataset.entryId));
      });
      ticket.querySelectorAll('.add-day-entry-btn').forEach(btn => {
        btn.addEventListener('click', () => addPriority(m.id, btn.dataset.day));
      });
      ticket.querySelectorAll('.dayschedule-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const cycle = ['office','remote','off'];
          const day = btn.dataset.day;
          const current = (m.day_schedule && m.day_schedule[day]) || 'office';
          const next = cycle[(cycle.indexOf(current) + 1) % cycle.length];
          const updatedSchedule = { ...(m.day_schedule || {}), [day]: next };
          await updateMember(m.id, { day_schedule: updatedSchedule });
          await loadAllData();
        });
      });
      const removeBtn = ticket.querySelector('.remove-x');
      if(removeBtn){
        removeBtn.addEventListener('click', () => {
          if(confirm(`Remove ${m.name || 'this ticket'}? This can't be undone.`)) deleteMember(m.id);
        });
      }
    }

    rail.appendChild(ticket);
  });

  const addBtn = document.createElement('div');
  addBtn.className = 'add-ticket';
  addBtn.innerText = '+ Add team member';
  addBtn.addEventListener('click', async () => {
    const name = prompt('Name for the new ticket:');
    if(name) await createMember(name);
  });
  rail.appendChild(addBtn);
}

// ---------- Home: Team P1s table ----------
function renderP1s(){
  const tbody = document.getElementById('p1TableBody');
  if(!tbody) return;
  tbody.innerHTML = '';

  if(p1s.length === 0){
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-note">Nothing here yet.</div></td></tr>`;
    return;
  }

  p1s.forEach(item => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><input class="line-text" value="${escapeHtml(item.text)}" placeholder="What is it, and whose P1 is it?" /></td>
      <td><input class="line-owner" value="${escapeHtml(item.owner_name || '')}" placeholder="Owner" /></td>
      <td><input type="date" class="line-due" value="${item.due || ''}" /></td>
      <td>${statusButtonsHtml(item.status, `data-p1-id="${item.id}"`, true)}</td>
      <td><button class="remove-x" title="Remove">&times;</button></td>
    `;
    row.querySelector('.line-text').addEventListener('change', e => updateP1(item.id, { text: e.target.value }));
    row.querySelector('.line-owner').addEventListener('change', e => updateP1(item.id, { owner_name: e.target.value }));
    row.querySelector('.line-due').addEventListener('change', e => updateP1(item.id, { due: e.target.value || null }));
    row.querySelectorAll('.status-btn').forEach(btn => {
      btn.addEventListener('click', async () => { await updateP1(item.id, { status: btn.dataset.status }); await loadAllData(); });
    });
    row.querySelector('.remove-x').addEventListener('click', () => deleteP1(item.id));
    tbody.appendChild(row);
  });
}

document.getElementById('addP1').addEventListener('click', addP1);

// ---------- Home: Follow-Ups ----------
function renderFollowups(){
  const list = document.getElementById('followupList');
  if(!list) return;
  list.innerHTML = '';

  if(followups.length === 0){
    list.innerHTML = `<div class="empty-note">Nothing here yet.</div>`;
    return;
  }

  followups.forEach(f => {
    const card = document.createElement('div');
    card.className = 'followup-card';
    const entryRows = f.entries.map(e => `
      <div class="followup-entry" data-entry-id="${e.id}">
        <div class="followup-entry-main">
          <input class="line-text" data-entry-id="${e.id}" value="${escapeHtml(e.text)}" placeholder="Follow-up item" />
          <button class="remove-entry-mini" data-entry-id="${e.id}" title="Remove this item">&times;</button>
        </div>
        ${statusButtonsHtml(e.status, `data-entry-id="${e.id}"`, true)}
        ${e.linked_priority_text ? `<div class="link-tag">&#128279; ${escapeHtml(e.linked_member_name || '')} &middot; ${escapeHtml(e.linked_day || '')}: ${escapeHtml(e.linked_priority_text)}</div>` : ''}
      </div>
    `).join('');

    card.innerHTML = `
      <div class="followup-card-top">
        <input class="line-owner" value="${escapeHtml(f.owner_name || '')}" placeholder="Owner" />
        <input type="date" class="line-due" value="${f.due || ''}" />
        <button class="remove-x" title="Remove this whole follow-up">&times;</button>
      </div>
      <div class="followup-entries">${entryRows}</div>
      <button class="add-mini-btn add-followup-entry-btn">+ Add item</button>
    `;

    card.querySelector('.line-owner').addEventListener('change', e => updateFollowup(f.id, { owner_name: e.target.value }));
    card.querySelector('.line-due').addEventListener('change', e => updateFollowup(f.id, { due: e.target.value || null }));
    card.querySelectorAll('.followup-entry-main .line-text').forEach(inp => {
      inp.addEventListener('change', e => updateFollowupEntry(e.target.dataset.entryId, { text: e.target.value }));
    });
    card.querySelectorAll('.status-btn').forEach(btn => {
      btn.addEventListener('click', async () => { await updateFollowupEntry(btn.dataset.entryId, { status: btn.dataset.status }); await loadAllData(); });
    });
    card.querySelectorAll('.remove-entry-mini').forEach(btn => {
      btn.addEventListener('click', () => deleteFollowupEntry(btn.dataset.entryId, f.id));
    });
    card.querySelector('.remove-x').addEventListener('click', () => {
      if(confirm('Remove this whole follow-up?')) deleteFollowup(f.id);
    });
    card.querySelector('.add-followup-entry-btn').addEventListener('click', () => addFollowupEntry(f.id));

    list.appendChild(card);
  });
}

document.getElementById('addFollowup').addEventListener('click', addFollowup);

// ---------- KPIs ----------
// Ranks a position by seniority so higher roles sort above others within a
// department — ported unchanged from the artifact version.
function positionRank(position){
  const p = (position || '').toLowerCase();
  if(p.includes('vp')) return 1;
  if(p.includes('director')) return 2;
  if(p.includes('manager')) return 3;
  return 4;
}
function sortKpiRoster(people){
  return [...people].sort((a, b) => {
    const rankDiff = positionRank(a.position) - positionRank(b.position);
    if(rankDiff !== 0) return rankDiff;
    const posCompare = (a.position || '').localeCompare(b.position || '');
    if(posCompare !== 0) return posCompare;
    return (a.name || '').localeCompare(b.name || '');
  });
}

let kpiActiveDept = null;
let kpiSelectedWeek = null;
let kpiSearchTerm = '';

function allKnownKpiWeeks(){
  const weeks = new Set([currentWeekStart]);
  kpiRoster.forEach(p => p.kpis.forEach(k => Object.keys(k.notesByWeek || {}).forEach(w => weeks.add(w))));
  return [...weeks].sort().reverse();
}

function renderKpiAdminPanel(){
  const panel = document.getElementById('kpiAdminPanel');
  panel.style.display = isAdmin() ? '' : 'none';
}

function renderKpiWeekSelect(){
  const select = document.getElementById('kpiWeekSelect');
  if(!select) return;
  if(!kpiSelectedWeek) kpiSelectedWeek = currentWeekStart;
  const weeks = allKnownKpiWeeks();
  select.innerHTML = weeks.map(w =>
    `<option value="${w}" ${w === kpiSelectedWeek ? 'selected' : ''}>Week of ${w}${w === currentWeekStart ? ' (current)' : ''}</option>`
  ).join('');
  select.onchange = () => { kpiSelectedWeek = select.value; renderKpiTable(); };
}

function renderKpiDeptTabs(){
  const row = document.getElementById('kpiDeptTabs');
  if(!row) return;
  const departments = [];
  kpiRoster.forEach(p => { if(!departments.includes(p.department)) departments.push(p.department); });
  if(departments.length === 0){ row.innerHTML = ''; return; }
  if(!kpiActiveDept || !departments.includes(kpiActiveDept)) kpiActiveDept = departments[0];

  row.innerHTML = '';
  departments.forEach(dept => {
    const btn = document.createElement('button');
    btn.className = 'kpi-dept-tab' + (dept === kpiActiveDept ? ' active' : '');
    btn.innerText = dept;
    btn.addEventListener('click', () => { kpiActiveDept = dept; kpiSearchTerm = ''; document.getElementById('kpiSearchInput').value = ''; renderKpiDeptTabs(); renderKpiTable(); });
    row.appendChild(btn);
  });
}

function renderKpiTable(){
  const body = document.getElementById('kpiTabBody');
  if(!body) return;

  if(kpiRoster.length === 0){
    body.innerHTML = `<div class="empty-note">${isAdmin() ? 'No one on the KPI roster yet — add someone above.' : 'No KPIs have been shared with you yet.'}</div>`;
    return;
  }

  if(!kpiSelectedWeek) kpiSelectedWeek = currentWeekStart;
  const week = kpiSelectedWeek;
  const departments = [];
  kpiRoster.forEach(p => { if(!departments.includes(p.department)) departments.push(p.department); });
  if(!kpiActiveDept || !departments.includes(kpiActiveDept)) kpiActiveDept = departments[0];

  const term = kpiSearchTerm.trim().toLowerCase();
  const visibleRoster = sortKpiRoster(
    kpiRoster
      .filter(p => p.department === kpiActiveDept)
      .filter(p => !term || (p.name || '').toLowerCase().includes(term))
  );

  if(visibleRoster.length === 0){
    body.innerHTML = `<div class="empty-note">No matches in ${escapeHtml(kpiActiveDept)}.</div>`;
    return;
  }

  body.innerHTML = `
    <table class="kpi-table">
      <thead><tr><th class="kpi-person-col">Person</th><th>KPI #1</th><th>KPI #2</th><th>KPI #3</th><th>KPI #4</th></tr></thead>
      <tbody id="kpiTableBody"></tbody>
    </table>
  `;
  const tbody = document.getElementById('kpiTableBody');

  visibleRoster.forEach(person => {
    const row = document.createElement('tr');
    const canEdit = isAdmin();
    const cells = person.kpis.map(k => `
      <td>
        <div class="kpi-title">${escapeHtml(k.title)}</div>
        <textarea class="kpi-notes" rows="2" data-kpi-id="${k.id}" placeholder="Notes for this week" ${canEdit ? '' : 'disabled'}>${escapeHtml((k.notesByWeek && k.notesByWeek[week]) || '')}</textarea>
      </td>
    `).join('');
    const shareControls = canEdit ? `
      <div style="margin-top:6px; display:flex; gap:6px; align-items:center;">
        <button class="kpi-share-btn ${person.shared_with_owner ? 'shared' : ''}" data-person-id="${person.id}" style="font-size:10px; padding:3px 8px; border-radius:100px; border:1px solid var(--border); background:${person.shared_with_owner ? 'var(--on-track-bg)' : '#fff'}; color:${person.shared_with_owner ? 'var(--on-track)' : 'var(--muted)'}; cursor:pointer;">
          ${person.shared_with_owner ? '✓ Shared with them' : '○ Private to you'}
        </button>
        <button class="kpi-link-btn" data-person-id="${person.id}" style="font-size:10px; padding:3px 8px; border-radius:100px; border:1px solid var(--border); background:#fff; color:var(--muted); cursor:pointer;">
          ${person.linked_user_id ? 'Change account link' : 'Link to account'}
        </button>
        <button class="kpi-add-item-btn" data-person-id="${person.id}" style="font-size:10px; padding:3px 8px; border-radius:100px; border:1px dashed var(--border); background:#fff; color:var(--muted); cursor:pointer;">+ KPI</button>
      </div>
    ` : '';
    row.innerHTML = `
      <td><div class="history-name">${escapeHtml(person.name)}</div><div class="history-role">${escapeHtml(person.position)}</div>${shareControls}</td>
      ${cells}
    `;

    row.querySelectorAll('.kpi-notes').forEach(inp => {
      let debounceTimer;
      inp.addEventListener('input', e => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => saveKpiNote(e.target.dataset.kpiId, week, e.target.value), 500);
      });
    });
    const shareBtn = row.querySelector('.kpi-share-btn');
    if(shareBtn) shareBtn.addEventListener('click', () => toggleKpiShare(person.id, !person.shared_with_owner).then(renderKpiTab));
    const linkBtn = row.querySelector('.kpi-link-btn');
    if(linkBtn) linkBtn.addEventListener('click', async () => {
      const profiles = await loadAllProfiles();
      const list = profiles.map(p => `${p.full_name || '(no name yet)'} — ${p.id}`).join('\n');
      const chosenId = prompt(`Paste the id of the account to link (from the list below):\n\n${list}`);
      if(chosenId) await linkKpiPersonToUser(person.id, chosenId.trim()).then(renderKpiTab);
    });
    const addItemBtn = row.querySelector('.kpi-add-item-btn');
    if(addItemBtn) addItemBtn.addEventListener('click', async () => {
      const title = prompt('New KPI title for ' + person.name + ':');
      if(title) await addKpiItem(person.id, title).then(renderKpiTab);
    });

    tbody.appendChild(row);
  });
}

function renderKpiTab(){
  renderKpiAdminPanel();
  renderKpiDeptTabs();
  renderKpiWeekSelect();
  renderKpiTable();
}

document.getElementById('kpiSearchInput').addEventListener('input', e => {
  kpiSearchTerm = e.target.value;
  renderKpiTable();
});

document.getElementById('addKpiPersonForm').addEventListener('submit', async e => {
  e.preventDefault();
  const name = document.getElementById('newKpiName').value.trim();
  const position = document.getElementById('newKpiPosition').value.trim();
  const department = document.getElementById('newKpiDept').value.trim();
  if(!name || !department) return;
  await createKpiPerson(name, position, department);
  document.getElementById('newKpiName').value = '';
  document.getElementById('newKpiPosition').value = '';
  document.getElementById('newKpiDept').value = '';
  document.getElementById('kpiAdminNote').innerText = `Added ${name}.`;
  renderKpiTab();
});

// ---------- boot ----------
const STATUS_STATES = [
  { key: 'not-started', label: 'Not Started' },
  { key: 'in-progress', label: 'In Progress' },
  { key: 'completed', label: 'Completed' }
];
function statusButtonsHtml(status, dataAttrs, editable){
  return `<div class="status-btn-group">` + STATUS_STATES.map(s =>
    `<button class="status-btn ${status === s.key ? 'active ' + s.key : ''}" data-status="${s.key}" ${dataAttrs} ${editable ? '' : 'disabled'}>${s.label}</button>`
  ).join('') + `</div>`;
}

(async function boot(){
  await initAuth();
  if(currentUser){
    await loadAllData();
    subscribeToRealtimeUpdates();
  }
})();
