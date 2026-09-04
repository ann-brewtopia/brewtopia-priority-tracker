// ============================================================================
// Auth — replaces the old "claim your ticket" soft identity picker with a
// real signed-in user. There's no more per-browser guessing: whoever is
// signed in IS the identity, enforced server-side by Row Level Security,
// not just hidden by the UI.
//
// Two sign-in methods, both against the same email:
//   - Password (default tab) — a normal email + password + "remember me."
//   - Magic link — the original no-password option, kept as an alternative.
// There's no separate "username" — the email address IS the identifier,
// same as it already was for magic link. Adding a second, disconnected
// username system would just be two sources of truth for one person.
// ============================================================================

let currentUser = null;     // the Supabase auth user object, or null if signed out
let currentProfile = null;  // { id, full_name, role } from public.profiles

async function initAuth(){
  handleUrlAuthSignals(); // expired/invalid link errors only — see note below

  const { data: { session } } = await supabase.auth.getSession();
  if(session){
    await loadCurrentProfile(session.user);
  }
  showAuthUI();

  supabase.auth.onAuthStateChange(async (event, session) => {
    // Fires once Supabase has actually validated the recovery link and
    // established a real session from it — this is the reliable signal to
    // show the "set new password" form, not guessing from the URL.
    if(event === 'PASSWORD_RECOVERY'){
      await loadCurrentProfile(session.user); // populated now, so we can drop them into the app right after they set a password
      showPasswordResetForm();
      return;
    }
    if(session){
      await loadCurrentProfile(session.user);
    }else{
      currentUser = null;
      currentProfile = null;
    }
    showAuthUI();
    if(session) await loadAllData();
  });
}

async function loadCurrentProfile(user){
  currentUser = user;
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, role')
    .eq('id', user.id)
    .single();
  if(error){
    console.error('Could not load profile', error);
    currentProfile = { id: user.id, full_name: user.email, role: 'member' };
  }else{
    currentProfile = data;
  }
}

function isAdmin(){
  return !!currentProfile && currentProfile.role === 'admin';
}

// ----------------------------------------------------------------------------
// Supabase reports an expired/invalid magic link as an error in the URL's
// hash fragment (#error=access_denied&error_code=otp_expired&...). Left
// alone, that just lands on a blank login form with zero explanation —
// which is exactly what happened. This reads the hash once on load and
// shows something useful.
//
// Password-recovery links are handled separately, in initAuth() below, via
// Supabase's own PASSWORD_RECOVERY event — NOT by parsing the hash here.
// An earlier version of this function also tried to detect `type=recovery`
// in the hash and immediately cleared it with history.replaceState(). That
// was a real bug: the hash contains the actual session tokens the recovery
// link grants, and Supabase's client needs to read them itself
// (detectSessionInUrl) before they're gone. Wiping the hash early meant the
// "set new password" form displayed correctly, but with no real session
// behind it — so saving a new password silently had nothing to save it to.
// ----------------------------------------------------------------------------
function handleUrlAuthSignals(){
  const hash = window.location.hash;
  if(!hash || hash.length < 2) return;
  const params = new URLSearchParams(hash.slice(1));

  if(params.get('error')){
    const desc = (params.get('error_description') || 'That sign-in link is invalid.').replace(/\+/g, ' ');
    const note = document.getElementById('magicLinkNote');
    if(note) note.innerText = params.get('error_code') === 'otp_expired'
      ? 'That link expired before it was opened — request a new one below.'
      : desc;
    // Safe to clean up here — an error means there's no valid session token
    // in this hash to protect.
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }
}

// ----------------------------------------------------------------------------
// Password sign-in
// ----------------------------------------------------------------------------
async function signInWithPassword(email, password, remember){
  setRememberMePreference(remember);
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return error;
}

// For someone who's only ever used the magic link and has no password yet —
// sends a reset-password email, which doubles as a "set your first password"
// link (Supabase doesn't distinguish "reset" from "set for the first time").
async function requestPasswordReset(email){
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin
  });
  return error;
}

async function setNewPassword(password){
  const { error } = await supabase.auth.updateUser({ password });
  return error;
}

// ----------------------------------------------------------------------------
// Magic link (kept as the alternative option)
// ----------------------------------------------------------------------------
async function sendMagicLink(email){
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin }
  });
  return error;
}

async function signOut(){
  await supabase.auth.signOut();
}

// ----------------------------------------------------------------------------
// UI wiring
// ----------------------------------------------------------------------------
function showAuthUI(){
  const loginScreen = document.getElementById('loginScreen');
  const appRoot = document.getElementById('appRoot');
  if(currentUser){
    loginScreen.style.display = 'none';
    appRoot.style.display = '';
    const label = document.getElementById('currentUserLabel');
    if(label){
      label.innerHTML = `Signed in as <strong>${escapeHtml(currentProfile.full_name || currentUser.email)}</strong>` +
        (isAdmin() ? ' — Admin' : '');
    }
  }else{
    loginScreen.style.display = '';
    appRoot.style.display = 'none';
  }
}

function showPasswordResetForm(){
  document.getElementById('passwordTabForm').style.display = 'none';
  document.getElementById('magicLinkForm').style.display = 'none';
  document.getElementById('loginTabs').style.display = 'none';
  document.getElementById('resetPasswordForm').style.display = '';
}

function switchLoginTab(tab){
  document.getElementById('passwordTabForm').style.display = tab === 'password' ? '' : 'none';
  document.getElementById('magicLinkForm').style.display = tab === 'magiclink' ? '' : 'none';
  document.querySelectorAll('.login-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
}
document.querySelectorAll('.login-tab').forEach(t => {
  t.addEventListener('click', () => switchLoginTab(t.dataset.tab));
});

document.getElementById('passwordTabForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('passwordEmail').value.trim();
  const password = document.getElementById('passwordInput').value;
  const remember = document.getElementById('rememberMeCheckbox').checked;
  const note = document.getElementById('passwordNote');
  note.innerText = 'Signing in…';
  const error = await signInWithPassword(email, password, remember);
  note.innerText = error ? `Couldn't sign in: ${error.message}` : '';
});

document.getElementById('forgotPasswordLink').addEventListener('click', async (e) => {
  e.preventDefault();
  const email = document.getElementById('passwordEmail').value.trim();
  const note = document.getElementById('passwordNote');
  if(!email){ note.innerText = 'Enter your email above first, then click this again.'; return; }
  note.innerText = 'Sending a link to set your password…';
  const error = await requestPasswordReset(email);
  note.innerText = error ? `Couldn't send that: ${error.message}` : `Check ${email} for a link to set your password.`;
});

document.getElementById('resetPasswordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const newPassword = document.getElementById('newPasswordInput').value;
  const note = document.getElementById('resetPasswordNote');
  if(newPassword.length < 8){ note.innerText = 'Use at least 8 characters.'; return; }
  note.innerText = 'Saving…';
  const error = await setNewPassword(newPassword);
  if(error){
    note.innerText = error.message;
    return;
  }
  note.innerText = 'Password set — signing you in…';
  showAuthUI();     // currentUser/currentProfile were already populated during PASSWORD_RECOVERY
  await loadAllData();
});

document.getElementById('magicLinkForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const emailInput = document.getElementById('magicLinkEmail');
  const note = document.getElementById('magicLinkNote');
  const email = emailInput.value.trim();
  if(!email) return;
  note.innerText = 'Sending…';
  const error = await sendMagicLink(email);
  note.innerText = error
    ? `Couldn't send that: ${error.message}`
    : `Check ${email} for a sign-in link.`;
});

document.getElementById('signOutBtn').addEventListener('click', signOut);


