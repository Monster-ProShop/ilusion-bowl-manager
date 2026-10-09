import { createAuthClient } from 'https://esm.sh/@neondatabase/auth@0.5.0-beta?bundle';

const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cfg=window.PRODRILLOS;
const client={auth:createAuthClient(cfg.authUrl)};
const authKey='prodrillos-auth-session';
const savedAuth=()=>{try{return JSON.parse(sessionStorage.getItem(authKey)||'null');}catch{return null;}};
let sessionToken=savedAuth()?.token||null,user=null,role='user',accountMode='user',competition=null,session=null,roster=[],competitionRows=[],accessUsers=[],dirty=false,saving=false;
const notice=message=>{$('cloud-notice').textContent=message;};
const fail=error=>{notice(error.message||String(error));};
const run=fn=>async event=>{event?.preventDefault();try{await fn(event);}catch(error){fail(error);}};
const hasAdminRole=()=>['manager','superadmin'].includes(role);
const manager=()=>accountMode==='admin'&&!!competition?.can_manage;
function updateAuth(){ $('btn-login').textContent=user?'My competitions':'Sign in';$('btn-logout').classList.toggle('hidden',!user); }
async function activeToken(attempts=5){
  let lastError;
  for(let attempt=0;attempt<attempts;attempt++){
    try{
      const response=await fetch(cfg.authUrl+'/token',{credentials:'include',cache:'no-store',headers:sessionToken?{authorization:'Bearer '+sessionToken}:{}});
      const data=await response.json();
      if(response.ok&&data?.token)return data.token;
    }catch(error){lastError=error;}
    const result=await client.auth.token();
    if(!result.error&&result.data?.token)return result.data.token;
    lastError=result.error||lastError;
    await client.auth.getSession();
    if(attempt<attempts-1)await new Promise(resolve=>setTimeout(resolve,150*(attempt+1)));
  }
  if(sessionToken)return sessionToken;
  throw lastError||Error('Please sign in again. Your current edits have not been saved.');
}
async function api(path,method='GET',body){
  const token=await activeToken();
  const response=await fetch(cfg.apiUrl+path,{method,headers:{'content-type':'application/json',authorization:'Bearer '+token},...(body?{body:JSON.stringify(body)}:{})});
  const data=await response.json();if(!response.ok)throw Error(data.error||'Could not complete the request');return data;
}
const query=()=>'?competition_id='+encodeURIComponent(competition.id);
const sessionBody=extra=>({competitionId:competition.id,sessionId:session.id,revision:session.revision,...extra});
function canLeave(){return !dirty||confirm('There are unsaved edits. Discard them and continue?');}
async function loadAccount(){
  const auth=await client.auth.getSession(),saved=savedAuth();user=auth.data?.user||saved?.user||null;sessionToken=auth.data?.session?.token||sessionToken||saved?.token||null;if(user&&sessionToken)sessionStorage.setItem(authKey,JSON.stringify({user,token:sessionToken}));updateAuth();
  if(!user){$('account-panel').classList.remove('hidden');return;}
  if(!user.emailVerified){$('verify-form').classList.remove('hidden');throw Error('Verify your email before opening your competitions.');}
  const account=await api('/me');role=account.role;accountMode=hasAdminRole()?'admin':'user';
  $('account-panel').classList.add('hidden');$('account-name').textContent=user.email;
  $('account-mode-wrap').classList.toggle('hidden',!hasAdminRole());$('account-mode').value=accountMode;
  await dashboard();
}
async function dashboard(){
  if(!canLeave())return;
  dirty=false;competition=null;session=null;
  $('competition-panel').classList.remove('hidden');$('session-panel').classList.add('hidden');$('tournament-workspace').classList.add('hidden');
  competitionRows=await api('/competitions');renderCompetitions(competitionRows);
  $('create-competition-details').classList.toggle('hidden',!(hasAdminRole()&&accountMode==='admin'));
  $('superadmin-users').classList.toggle('hidden',!(role==='superadmin'&&accountMode==='admin'));
  if(role==='superadmin'&&accountMode==='admin')await loadUsers();
  const requested=new URLSearchParams(location.search).get('competition');
  if(requested){const row=competitionRows.find(c=>c.id===requested);if(row)await openCompetition(row);}
}
async function loadUsers(){accessUsers=await api('/users');renderUsers('');}
function renderUsers(filter){
  const query=filter.trim().toLowerCase(),rows=accessUsers.filter(a=>!query||a.email.includes(query)).slice(0,30);
  $('admin-user-results').innerHTML=rows.map(a=>{
    const owner=a.role==='superadmin';
    return `<div class="admin-user-row" data-access-user="${esc(a.id)}"><strong>${esc(a.email)}</strong><label>Account type<select data-access-role ${owner?'disabled':''}><option value="user" ${a.role==='user'?'selected':''}>User</option><option value="manager" ${a.role==='manager'?'selected':''}>Admin</option>${owner?'<option value="superadmin" selected>SuperAdmin</option>':''}</select></label>${owner?'<span class="hint">Protected owner</span>':'<button data-save-role>Save</button>'}</div>`;
  }).join('')||'<p class="hint">No registered users match this email.</p>';
}
function renderCompetitions(rows){
  $('competition-list').innerHTML=rows.map(c=>`<article class="competition-card"><span class="eyebrow">${esc(c.kind)}</span><h3>${esc(c.name)}</h3><p>${[c.bowling_center,c.city,c.region,c.country].filter(Boolean).map(esc).join(' · ')}</p><button data-open-competition="${esc(c.id)}">Open competition</button></article>`).join('')||'<p class="hint">No competitions yet. Search by name or location to join one.</p>';
  $('competition-list').querySelectorAll('[data-open-competition]').forEach(button=>button.onclick=run(async()=>{
    let row=competitionRows.find(c=>c.id===button.dataset.openCompetition);
    if(!row){await api('/memberships','POST',{competitionId:button.dataset.openCompetition});competitionRows=await api('/competitions');row=competitionRows.find(c=>c.id===button.dataset.openCompetition);}
    if(!row)throw Error('Competition access is not available.');await openCompetition(row);
  }));
}
async function loadRoster(){
  roster=await api('/league/roster'+query());
  const eligible=roster.filter(p=>p.eligible);
  $('claim-profile').innerHTML='<option value="">Choose your bowler name</option>'+eligible.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}${p.linkedToMe?' · Linked':''}</option>`).join('');
  $('bowler-claim').classList.toggle('hidden',manager());
}
async function openCompetition(row){
  competition=row;session=null;dirty=false;
  $('competition-panel').classList.add('hidden');$('session-panel').classList.remove('hidden');$('tournament-workspace').classList.add('hidden');
  $('competition-name').textContent=row.name;$('competition-location').textContent=[row.bowling_center,row.city,row.region,row.country].filter(Boolean).join(' · ');
  $('session-manager').classList.toggle('hidden',!manager());
  await loadRoster();await listSessions();await loadSummary();
  const requested=new URLSearchParams(location.search).get('session');
  if(requested&&[...$('session-select').options].some(o=>o.value===requested))await openSession(requested);
}
async function listSessions(selected){
  const rows=await api('/league/sessions'+query());
  $('session-select').innerHTML='<option value="">Choose a session</option>'+rows.map(s=>`<option value="${esc(s.id)}">${esc(String(s.session_date).slice(0,10))} · ${esc(s.label)}</option>`).join('');
  if(selected)$('session-select').value=selected;
}
async function loadSummary(){
  const rows=await api('/league/summary'+query());
  $('season-summary').innerHTML=rows.length?'<h3>League averages · all sessions</h3>'+table(['Bowler','Games','Pinfall','Average','High game'],rows.map(r=>[r.name,r.games,r.pinfall,r.average,r.high_game])):'';
}
function table(head,rows){return '<div class="table-scroll"><table class="score-grid"><thead><tr>'+head.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(v=>'<td>'+esc(v)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';}
async function openSession(id){
  if(!canLeave()){$('session-select').value=session?.id||'';return;}
  session=await api('/league/session'+query()+'&session_id='+encodeURIComponent(id));dirty=false;
  $('session-select').value=id;$('tournament-workspace').classList.remove('hidden');
  window.TournamentManager.setState(session.state,manager());
  const url=new URL(location.href);url.searchParams.set('competition',competition.id);url.searchParams.set('session',id);history.replaceState(null,'',url);
  $('session-status').textContent=`${session.label} · ${String(session.session_date).slice(0,10)} · ${session.brackets_linked?'Linked bracket scores sync automatically.':'Cloud session'} · Saved revision ${session.revision}`;
  $('link-brackets').disabled=session.brackets_linked;$('unlink-brackets').disabled=!session.brackets_linked;
  renderStandings();notice('Session loaded from the cloud.');
}
function renderStandings(){
  const totals=new Map();
  for(const game of session.games){const t=totals.get(game.profile_id)||{games:0,total:0,high:0};t.games++;t.total+=game.scratch;t.high=Math.max(t.high,game.scratch);totals.set(game.profile_id,t);}
  const rows=session.state.teams.flatMap(t=>t.players.map(p=>{const s=totals.get(p.profileId)||{games:0,total:0,high:0};return {name:p.name,team:t.name,...s};})).sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name));
  $('results-display').innerHTML=rows.length?table(['Bowler','Team','Games','Scratch pins','Average','High game'],rows.map(r=>[r.name,r.team,r.games,r.total,r.games?(r.total/r.games).toFixed(2):'—',r.games?r.high:'—'])):'<div class="standings-placeholder">Set up the session and select bowlers from the shared roster to begin.</div>';
  let matches=$('match-results');if(!matches){matches=document.createElement('div');matches.id='match-results';$('page-matches').append(matches);}
  matches.innerHTML=table(['Match','Team A','Team B'],session.state.matches.map(m=>[m.id,m.teamA.name,m.teamB.name]));
}
function renderScores(){
  const game=Number($('match-selector').value);if(!game||!session){$('score-matrix-container').innerHTML='';$('commit-scores-btn').classList.add('hidden');return;}
  $('score-matrix-container').innerHTML=session.state.teams.map(team=>`<div class="team-card"><h3>${esc(team.name)}</h3><div class="score-fields">${team.players.map(p=>{
    const score=session.games.find(g=>g.profile_id===p.profileId&&g.game_number===game),locked=session.brackets_linked&&score?.source==='brackets';
    return `<label>${esc(p.name)}${locked?' <small>· Brackets</small>':''}<input data-score-profile="${esc(p.profileId)}" data-game="${game}" type="number" min="0" max="300" step="1" value="${score?.scratch??''}" placeholder="Not bowled" ${locked?'disabled':''}></label>`;
  }).join('')}</div></div>`).join('');
  $('commit-scores-btn').classList.toggle('hidden',!manager());
}
async function saveState(state){
  if(!session||!manager())throw Error('Open a session you manage first.');
  if(saving)throw Error('Please wait for the current save to finish.');
  saving=true;try{const result=await api('/league/session','POST',sessionBody({state}));session.revision=result.revision;session.state=structuredClone(state);dirty=false;notice('Saved to the cloud.');renderStandings();return result;}catch(error){fail(error);throw error;}finally{saving=false;}
}
async function commitScores(){
  try{
    const inputs=[...$('score-matrix-container').querySelectorAll('input[data-score-profile]:not(:disabled)')];
    if(inputs.some(i=>!i.checkValidity()))throw Error('Scores must be whole numbers between 0 and 300.');
    const games=inputs.filter(i=>i.value!=='').map(i=>({profileId:i.dataset.scoreProfile,gameNumber:Number(i.dataset.game),scratch:Number(i.value)}));
    if(inputs.some(i=>i.value===''&&session.games.some(g=>g.profile_id===i.dataset.scoreProfile&&g.game_number===Number(i.dataset.game))))throw Error('A saved score cannot be cleared. Enter a corrected score, including 0 if bowled.');
    if(!games.length)throw Error('Enter at least one score.');
    await api('/league/scores','POST',sessionBody({games}));dirty=false;await openSession(session.id);await loadSummary();notice('Scores saved to the cloud.');
  }catch(error){fail(error);}
}
async function importLegacy(data){
  if(!session||!manager())throw Error('Open a cloud session first.');
  if(!Array.isArray(data.teams)||!data.config)throw Error('Invalid tournament backup');
  const copy=structuredClone(data);for(const team of copy.teams)for(const p of team.players){
    const match=roster.find(r=>r.id===p.profileId);
    if(!match)throw Error('This backup needs registered bowler IDs. Rebuild its roster using the shared bowler selections; names alone are not safe to link.');
  }
  if(!confirm('Import this backup into the selected cloud session?'))return;
  await saveState(copy);await openSession(session.id);
}
function exportSession(){
  if(!session)throw Error('Open a bowling session before exporting a backup.');
  const backup={version:2,exportedAt:new Date().toISOString(),competition:{id:competition.id,name:competition.name},session:{id:session.id,label:session.label,date:String(session.session_date).slice(0,10),revision:session.revision,bracketsLinked:session.brackets_linked},state:session.state,games:session.games};
  const url=URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download=`${session.label.replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'').toLowerCase()||'bowling-session'}-backup.json`;a.click();URL.revokeObjectURL(url);
}
async function signOut(){if(!canLeave())return;await client.auth.signOut();sessionStorage.removeItem(authKey);sessionToken=null;user=null;session=null;competition=null;dirty=false;updateAuth();['competition-panel','session-panel','tournament-workspace'].forEach(id=>$(id).classList.add('hidden'));$('account-panel').classList.remove('hidden');notice('Signed out.');}
window.TournamentCloud={notice,saveState,renderScores,commitScores,importLegacy,exportSession,
 rosterOptions:()=>'<option value="">Choose a registered bowler</option>'+roster.filter(p=>p.active).map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join(''),
 profileName:id=>roster.find(p=>p.id===id)?.name||'',
 accountAction:()=>user?run(dashboard)():$('account-panel').scrollIntoView({behavior:'smooth'}),signOut:()=>run(signOut)()};
$('btn-logout').onclick=run(signOut);
$('signin-form').onsubmit=run(async()=>{const {data,error}=await client.auth.signIn.email({email:$('account-email').value.trim().toLowerCase(),password:$('account-password').value});if(error)throw error;sessionToken=data?.token||data?.session?.token||sessionToken;if(data?.user&&sessionToken)sessionStorage.setItem(authKey,JSON.stringify({user:data.user,token:sessionToken}));$('account-password').value='';await loadAccount();});
$('register-account').onclick=run(async()=>{if(!$('signin-form').reportValidity())return;const email=$('account-email').value.trim().toLowerCase();const {error}=await client.auth.signUp.email({email,password:$('account-password').value,name:email.split('@')[0]});if(error)throw error;$('account-password').value='';$('verify-form').classList.remove('hidden');notice('Check your email for a verification code. Existing Brackets users can sign in with their existing password.');});
$('verify-form').onsubmit=run(async()=>{const {error}=await client.auth.emailOtp.verifyEmail({email:$('account-email').value.trim().toLowerCase(),otp:$('verification-code').value.trim()});if(error)throw error;$('verify-form').classList.add('hidden');notice('Email verified. Sign in to continue.');});
$('resend-code').onclick=run(async()=>{const {error}=await client.auth.sendVerificationEmail({email:$('account-email').value.trim().toLowerCase(),callbackURL:location.origin+location.pathname});if(error)throw error;notice('Verification code sent.');});
$('back-competitions').onclick=run(dashboard);
$('account-mode').onchange=run(async event=>{if(!canLeave()){event.target.value=accountMode;return;}accountMode=event.target.value;competition=null;session=null;dirty=false;await dashboard();notice(accountMode==='admin'?'Admin tools are active.':'Bowler mode is active. You can join leagues and link your bowler profile.');});
$('admin-user-search').oninput=event=>renderUsers(event.target.value);
$('admin-user-results').onclick=run(async event=>{const button=event.target.closest('[data-save-role]');if(!button)return;const row=button.closest('[data-access-user]'),selected=row.querySelector('[data-access-role]').value;await api('/users/role','POST',{userId:row.dataset.accessUser,role:selected});await loadUsers();notice('User account type saved.');});
$('search-competitions').onclick=run(async()=>renderCompetitions(await api('/directory?q='+encodeURIComponent($('competition-search').value))));
$('create-competition').onsubmit=run(async event=>{const body=Object.fromEntries(new FormData(event.target));body.format='traditional';const result=await api('/competitions','POST',body);competitionRows=await api('/competitions');await openCompetition(competitionRows.find(c=>c.id===result.id));event.target.reset();});
$('create-session').onsubmit=run(async event=>{const result=await api('/league/sessions','POST',{competitionId:competition.id,...Object.fromEntries(new FormData(event.target))});await listSessions(result.id);await openSession(result.id);event.target.reset();});
$('add-profile').onsubmit=run(async event=>{await api('/league/roster','POST',{competitionId:competition.id,...Object.fromEntries(new FormData(event.target))});await loadRoster();event.target.reset();notice('Bowler added to the shared roster.');});
$('claim-bowler').onclick=run(async()=>{const profile=roster.find(p=>p.id===$('claim-profile').value);if(!profile)throw Error('Choose your bowler name.');if(!confirm('Confirm that you are '+profile.name+'.'))return;await api('/league/claim','POST',{competitionId:competition.id,profileId:profile.id,confirm:true});await loadRoster();notice('Your verified account is linked to this bowler.');});
$('session-select').onchange=run(async event=>{if(event.target.value)await openSession(event.target.value);else $('tournament-workspace').classList.add('hidden');});
$('refresh-session').onclick=run(async()=>{if(session)await openSession(session.id);await loadSummary();});
$('link-brackets').onclick=run(async()=>{
 if(!session||!canLeave())return;const date=String(session.session_date).slice(0,10);
 if(!confirm(`Link the CURRENT Brackets roster and games 1–3 to ${session.label} (${date}) at ${competition.bowling_center}? Confirm this is the same bowling session.`))return;
 const result=await api('/league/link-brackets','POST',sessionBody({confirm:true,date}));dirty=false;await openSession(session.id);notice(result.unmapped?.length?`Linked. Not matched to this session roster: ${result.unmapped.join(', ')}`:'Brackets linked. Scores sync when saved in Brackets.');
});
$('unlink-brackets').onclick=run(async()=>{if(!session||!confirm('Stop syncing Brackets into this session? Saved scores will be retained.'))return;await api('/league/unlink-brackets','POST',sessionBody({}));dirty=false;await openSession(session.id);});
$('tournament-workspace').addEventListener('input',()=>{dirty=true;});
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
// Refresh linked scores only when there are no local edits; never overwrite a form in use.
setInterval(()=>{if(session?.brackets_linked&&!dirty&&!saving&&!document.hidden)void api('/league/session'+query()+'&session_id='+session.id).then(next=>{if(next.revision!==session.revision){session=next;renderStandings();if($('match-selector').value)renderScores();$('session-status').textContent='Linked scores updated from Brackets · revision '+next.revision;}}).catch(fail);},30000);
void loadAccount().catch(fail);

