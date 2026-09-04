// ============================================================================
// Data layer — this file is the actual replacement for window.storage.
// Everything in here talks to Supabase; nothing in app.js (the rendering
// code) touches the database directly. That split is deliberate: it means
// the rendering/UI code barely had to change from the original Claude-artifact
// version, since it still just operates on in-memory arrays (members, p1s,
// followups) exactly like before — only how those arrays get filled and
// saved is different.
// ============================================================================

let members = [];    // [{ id, name, title, day_schedule, priorities: [...] }]
let p1s = [];         // from the p1s_with_live_text view
let followups = [];   // [{ id, owner_name, due, entries: [...] }]

function todayMondayStr(){
  const d = new Date();
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0,0,0,0);
  return d.toISOString().slice(0,10);
}
let currentWeekStart = todayMondayStr();

function escapeHtml(str){
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ----------------------------------------------------------------------------
// Load everything needed for the currently-ported tabs (Home + Daily
// Priorities). KPIs/History/Users/Help aren't wired up to real data yet —
// see the README for what's next.
// ----------------------------------------------------------------------------
async function loadAllData(){
  await checkForWeekRollover();

  const { data: memberRows, error: memberErr } = await supabase
    .from('members')
    .select('*')
    .order('created_at', { ascending: true });
  if(memberErr){ console.error(memberErr); return; }

  const { data: priorityRows, error: priorityErr } = await supabase
    .from('priorities')
    .select('*')
    .eq('week_start', currentWeekStart);
  if(priorityErr){ console.error(priorityErr); return; }

  members = memberRows.map(m => ({
    ...m,
    priorities: priorityRows.filter(p => p.member_id === m.id)
  }));

  const { data: p1Rows, error: p1Err } = await supabase
    .from('p1s_with_live_text')
    .select('*')
    .order('created_at', { ascending: true });
  if(p1Err) console.error(p1Err);
  p1s = p1Rows || [];

  const { data: followupRows, error: fErr } = await supabase
    .from('followups')
    .select('*')
    .order('created_at', { ascending: true });
  if(fErr) console.error(fErr);

  const { data: entryRows, error: eErr } = await supabase
    .from('followup_entries_with_live_link')
    .select('*')
    .order('created_at', { ascending: true });
  if(eErr) console.error(eErr);

  followups = (followupRows || []).map(f => ({
    ...f,
    entries: (entryRows || []).filter(e => e.followup_id === f.id)
  }));

  await loadKpiData();

  renderAll(); // defined in app.js
}

// ----------------------------------------------------------------------------
// Week rollover — no global "current week" pointer to advance anymore
// (every client just computes todayMondayStr() itself). This function's only
// job is to make sure unfinished priorities actually carry forward as new
// rows for the new week, since a brand-new Monday otherwise starts empty.
// Guarded so it only carries forward once per member per week, even if this
// runs on every page load.
// ----------------------------------------------------------------------------
async function checkForWeekRollover(){
  const monday = todayMondayStr();
  currentWeekStart = monday;

  const { data: alreadyThisWeek } = await supabase
    .from('priorities').select('member_id').eq('week_start', monday);
  const alreadyHandled = new Set((alreadyThisWeek || []).map(p => p.member_id));

  const { data: memberRows } = await supabase.from('members').select('id');
  for(const m of (memberRows || [])){
    if(alreadyHandled.has(m.id)) continue; // this member already has rows for this week

    const { data: priorWeeks } = await supabase
      .from('priorities')
      .select('week_start')
      .eq('member_id', m.id)
      .lt('week_start', monday)
      .order('week_start', { ascending: false })
      .limit(1);
    if(!priorWeeks || priorWeeks.length === 0) continue; // nothing to carry forward

    const lastWeek = priorWeeks[0].week_start;
    const { data: unfinished } = await supabase
      .from('priorities')
      .select('*')
      .eq('member_id', m.id)
      .eq('week_start', lastWeek)
      .neq('status', 'completed')
      .not('text', 'eq', '');

    for(const p of (unfinished || [])){
      await supabase.from('priorities').insert({
        member_id: m.id,
        week_start: monday,
        day: 'Mon',
        text: p.text,
        status: p.status,
        due: p.due,
        carried_weeks: (p.carried_weeks || 0) + 1
      });
    }
  }
}

// ----------------------------------------------------------------------------
// Members
// ----------------------------------------------------------------------------
async function createMember(name){
  const { data, error } = await supabase
    .from('members')
    .insert({ name, title: '', owner_user_id: currentUser.id })
    .select().single();
  if(error){ console.error(error); return null; }
  await loadAllData();
  return data;
}

async function claimTicket(memberId){
  const { error } = await supabase
    .from('members')
    .update({ owner_user_id: currentUser.id })
    .eq('id', memberId)
    .is('owner_user_id', null); // RLS also enforces this — belt and suspenders
  if(error) console.error(error);
  await loadAllData();
}

async function updateMember(memberId, fields){
  const { error } = await supabase.from('members').update(fields).eq('id', memberId);
  if(error) console.error(error);
}

async function deleteMember(memberId){
  const { error } = await supabase.from('members').delete().eq('id', memberId);
  if(error){ console.error(error); return; }
  await loadAllData();
}

function canEditTicket(member){
  return isAdmin() || member.owner_user_id === (currentUser && currentUser.id);
}

// ----------------------------------------------------------------------------
// Priorities
// ----------------------------------------------------------------------------
async function addPriority(memberId, day){
  const { error } = await supabase.from('priorities').insert({
    member_id: memberId, week_start: currentWeekStart, day, text: ''
  });
  if(error) console.error(error);
  await loadAllData();
}

async function updatePriority(priorityId, fields){
  const { error } = await supabase.from('priorities').update(fields).eq('id', priorityId);
  if(error) console.error(error);
}

async function deletePriority(priorityId){
  const { error } = await supabase.from('priorities').delete().eq('id', priorityId);
  if(error) console.error(error);
  await loadAllData();
}

// Flag toggle — matches the v7 fix: clicking an already-flagged priority
// offers to remove it from Team P1s instead of creating a duplicate.
async function togglePriorityFlag(priority, memberName){
  const existing = p1s.find(p => p.source_priority_id === priority.id);
  if(existing){
    await supabase.from('p1s').delete().eq('id', existing.id);
    await supabase.from('priorities').update({ flagged: false }).eq('id', priority.id);
  }else{
    await supabase.from('p1s').insert({
      text: `${memberName}: ${priority.text}`,
      owner_name: memberName,
      source_priority_id: priority.id,
      auto_text: true
    });
    await supabase.from('priorities').update({ flagged: true }).eq('id', priority.id);
  }
  await loadAllData();
}

// ----------------------------------------------------------------------------
// P1s
// ----------------------------------------------------------------------------
async function addP1(){
  const { error } = await supabase.from('p1s').insert({ text: '', owner_name: '' });
  if(error) console.error(error);
  await loadAllData();
}

async function updateP1(id, fields){
  // Editing the text by hand detaches it from the source priority — otherwise
  // a manual edit would just get overwritten next time the view re-reads the
  // live join.
  if(fields.text !== undefined) fields.auto_text = false;
  const { error } = await supabase.from('p1s').update(fields).eq('id', id);
  if(error) console.error(error);
}

async function deleteP1(id){
  const p1 = p1s.find(p => p.id === id);
  const { error } = await supabase.from('p1s').delete().eq('id', id);
  if(error) console.error(error);
  if(p1 && p1.source_priority_id){
    await supabase.from('priorities').update({ flagged: false }).eq('id', p1.source_priority_id);
  }
  await loadAllData();
}

// ----------------------------------------------------------------------------
// Follow-ups
// ----------------------------------------------------------------------------
async function addFollowup(){
  const { data, error } = await supabase.from('followups').insert({ owner_name: '' }).select().single();
  if(error){ console.error(error); return; }
  await supabase.from('followup_entries').insert({ followup_id: data.id, text: '' });
  await loadAllData();
}

async function addFollowupEntry(followupId){
  const { error } = await supabase.from('followup_entries').insert({ followup_id: followupId, text: '' });
  if(error) console.error(error);
  await loadAllData();
}

async function updateFollowup(id, fields){
  const { error } = await supabase.from('followups').update(fields).eq('id', id);
  if(error) console.error(error);
}

async function updateFollowupEntry(id, fields){
  const { error } = await supabase.from('followup_entries').update(fields).eq('id', id);
  if(error) console.error(error);
}

async function deleteFollowup(id){
  const { error } = await supabase.from('followups').delete().eq('id', id);
  if(error) console.error(error);
  await loadAllData();
}

async function deleteFollowupEntry(id, followupId){
  await supabase.from('followup_entries').delete().eq('id', id);
  const remaining = await supabase.from('followup_entries').select('id').eq('followup_id', followupId);
  if(remaining.data && remaining.data.length === 0){
    await supabase.from('followups').delete().eq('id', followupId); // don't leave an empty card behind
  }
  await loadAllData();
}

// ----------------------------------------------------------------------------
// Realtime — this is a genuine upgrade over the old app, not a port. The
// Claude-artifact version had no way to know when someone else's browser
// changed something; it needed a manual "Refresh" button. Supabase can push
// changes to every open tab the moment they happen.
// ----------------------------------------------------------------------------
function subscribeToRealtimeUpdates(){
  supabase.channel('priority-tracker-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'members' }, loadAllData)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'priorities' }, loadAllData)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'p1s' }, loadAllData)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'followups' }, loadAllData)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'followup_entries' }, loadAllData)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'kpi_people' }, loadAllData)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'kpi_items' }, loadAllData)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'kpi_notes' }, loadAllData)
    .subscribe();
}

// ----------------------------------------------------------------------------
// KPIs — private by default. RLS is what actually enforces this (see
// supabase_schema.sql): the query below just asks for "everything I'm
// allowed to see," and Postgres decides what that is per the signed-in
// user. An admin gets every row; anyone else gets only their own row, and
// only once it's been shared — the same select, with completely different
// results depending on who's asking. That's the whole privacy fix.
// ----------------------------------------------------------------------------
let kpiRoster = [];

async function loadKpiData(){
  const { data: people, error } = await supabase
    .from('kpi_people')
    .select('*, kpi_items(*, kpi_notes(*))')
    .order('department', { ascending: true });
  if(error){ console.error(error); kpiRoster = []; return; }

  kpiRoster = people.map(p => ({
    ...p,
    kpis: (p.kpi_items || [])
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(item => ({
        ...item,
        notesByWeek: Object.fromEntries((item.kpi_notes || []).map(n => [n.week_start, n.notes]))
      }))
  }));
}

// Admin-only from here down — matches canEditKpis() being admin-only in the
// original app. RLS backs this up regardless of what the UI allows.
async function createKpiPerson(name, position, department){
  const { error } = await supabase.from('kpi_people').insert({ name, position, department });
  if(error) console.error(error);
  await loadKpiData();
}

async function addKpiItem(personId, title){
  const person = kpiRoster.find(p => p.id === personId);
  const sortOrder = person ? person.kpis.length : 0;
  const { error } = await supabase.from('kpi_items').insert({ kpi_person_id: personId, title, sort_order: sortOrder });
  if(error) console.error(error);
  await loadKpiData();
}

async function toggleKpiShare(personId, shared){
  const { error } = await supabase.from('kpi_people').update({ shared_with_owner: shared }).eq('id', personId);
  if(error) console.error(error);
  await loadKpiData();
}

async function linkKpiPersonToUser(personId, userId){
  const { error } = await supabase.from('kpi_people').update({ linked_user_id: userId || null }).eq('id', personId);
  if(error) console.error(error);
  await loadKpiData();
}

async function saveKpiNote(itemId, weekStart, notes){
  const { error } = await supabase
    .from('kpi_notes')
    .upsert({ kpi_item_id: itemId, week_start: weekStart, notes }, { onConflict: 'kpi_item_id,week_start' });
  if(error) console.error(error);
}

async function loadAllProfiles(){
  const { data, error } = await supabase.from('profiles').select('id, full_name').order('full_name');
  if(error){ console.error(error); return []; }
  return data;
}


