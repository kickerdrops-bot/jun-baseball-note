import {CATEGORIES,TYPES,today,validDate,validateNotes,parseBackup,backup,mergeBackup,sorted,stats} from './model.js';
import {supabase} from './cloud.js';
import iconUrl from './icon.svg';
const root=document.querySelector('#app');
const e=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths={home:'M3 10 12 3l9 7v10H3Z M9 20v-7h6v7',book:'M4 3h13a3 3 0 0 1 3 3v15H7a3 3 0 0 1-3-3V3Zm0 14h16 M8 7h7 M8 11h7',target:'M21 12a9 9 0 1 1-9-9 M17 12a5 5 0 1 1-5-5 M12 12l9-9 M16 3h5v5',settings:'M5 4v16 M12 4v16 M19 4v16 M2 8h6 M9 16h6 M16 10h6',plus:'M12 5v14 M5 12h14',arrow:'M5 12h14 M14 6l6 6-6 6',check:'m5 12 4 4L19 6',spark:'m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4Z',flag:'M5 21V3h13l-3 4 3 4H5',chevron:'m9 5 7 7-7 7',search:'M15 15l6 6 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',lock:'M6 10h12v11H6Z M8 10V7a4 4 0 0 1 8 0v3',download:'M12 3v12 m-5-5 5 5 5-5 M4 15v6h16v-6',upload:'M12 16V4 m-5 5 5-5 5 5 M4 15v6h16v-6',trash:'M3 6h18 M8 6V3h8v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7',back:'M19 12H5 m6-6-6 6 6 6',edit:'m4 15 12-12 5 5L9 20l-6 1Z M13 6l5 5',info:'M12 10v7 M12 6v1 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',calendar:'M4 5h16v16H4Z M8 3v4 M16 3v4 M4 10h16',ball:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M6 5c6 2 6 12 0 14 M18 5c-6 2-6 12 0 14'};
const icon=(name)=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]?`<path d="${paths[name]}"/>`:''}</svg>`;
const btn=(label,action,cls='')=>`<button type="button" class="button ${cls}" data-action="${action}">${label}</button>`;
const fmt=(date,opts={month:'long',day:'numeric',weekday:'short'})=>new Date(date+'T12:00:00').toLocaleDateString('ja-JP',opts);
let notes=[],view='home',selectedId='',goalTab='active',search='',category='',typeFilter='',formBase='',editingId='',reviewItems=[],toastTimer;
let user=null,membership=null,revision=null,remoteDocument=null,busy=false,loading=false,ready=false,booting=true;
let authStage='loading',authMessage='',loadError='',family=[],familyLoaded=false,familyLoading=false,generatedLink=null,epoch=0;
const setupKey='jun-note.password-setup';
const writer=()=>ready&&membership?.role==='writer';
const manager=()=>ready&&membership?.role==='manager';
const roleLabel=role=>({writer:'ジュン（記入する人）',manager:'管理者',viewer:'家族（見る人）'}[role]||'家族');
function toast(message){const el=document.querySelector('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),5000);}
function showError(message){const el=document.querySelector('#form-error')||document.querySelector('#page-error')||document.querySelector('#auth-error');if(el){el.textContent=message;el.hidden=false;el.scrollIntoView({block:'center',behavior:'smooth'});el.focus();}else toast(message);}
function errorMessage(error,fallback='通信できませんでした。接続を確認して、もう一度お試しください。'){
  const msg=String(error?.message||'');
  if(msg.includes('NOTEBOOK_CONFLICT')||error?.code==='40001')return '別の画面で記録が更新されています。今の入力は残っています。入力を控えてから「閉じる」で一覧へ戻り、最新の記録を確認してください。';
  if(error?.code==='invalid_credentials')return 'メールアドレスまたはパスワードが違います。招待を受けたメールアドレスでログインしてください。';
  if(error?.code==='weak_password')return 'パスワードをもう少し長く、推測されにくいものにしてください。';
  if(error?.code==='same_password')return '前のものとは違うパスワードを設定してください。';
  if(error?.code==='over_request_rate_limit'||error?.status===429)return '操作が続いたため一時的に制限されています。少し待ってからお試しください。';
  if(error?.code==='42501'||error?.status===403)return 'この操作の権限がありません。画面を更新し、家族の管理者に確認してください。';
  if(error?.status===401)return 'ログインの有効期限が切れました。入力を控えてから、ログインし直してください。';
  return fallback;
}
function setBusy(value){busy=value;root.setAttribute('aria-busy',String(value));if(value){root.querySelectorAll('button,input,textarea,select').forEach(el=>{el.dataset.wasDisabled=String(el.disabled);el.disabled=true;});}else{root.querySelectorAll('[data-was-disabled]').forEach(el=>{el.disabled=el.dataset.wasDisabled==='true';delete el.dataset.wasDisabled;});}}
async function confirmAction(title,message,label='削除する'){const d=document.querySelector('#confirm-dialog');if(d.open)return false;document.querySelector('#dialog-title').textContent=title;document.querySelector('#dialog-message').textContent=message;const b=document.querySelector('#confirm-button');b.textContent=label;b.className='button '+(label.includes('削除')||label.includes('解除')?'danger':'');d.returnValue='cancel';d.showModal();return new Promise(resolve=>d.addEventListener('close',()=>resolve(d.returnValue==='confirm'),{once:true}));}
function formState(){const f=document.querySelector('#note-form');return f?JSON.stringify([...new FormData(f).entries()]):'';}
function dirty(){return view==='form'&&formState()!==formBase;}
function setupPending(){try{return localStorage.getItem(setupKey);}catch{return null;}}
function markSetup(value){try{if(value)localStorage.setItem(setupKey,value);else localStorage.removeItem(setupKey);}catch{/* Session remains restricted in this page even when browser storage is unavailable. */}}
function clearPrivate(){epoch++;notes=[];membership=null;revision=null;remoteDocument=null;family=[];familyLoaded=false;generatedLink=null;ready=false;view='home';selectedId='';editingId='';loadError='';}
function applyDocument(doc){notes=validateNotes(doc.notes);revision=doc.revision;remoteDocument=null;loadError='';}
async function navigate(next,id=''){
  if(busy)return;
  if(next==='form'&&!writer())return;
  if(dirty()&&!await confirmAction('入力をやめますか？','まだ保存していない内容があります。画面を移動すると、今の入力は消えます。','移動する'))return;
  if(remoteDocument)applyDocument(remoteDocument);
  view=next;selectedId=id;generatedLink=null;render();window.scrollTo({top:0});
  if(next==='settings'&&manager()&&!familyLoaded)void loadFamily();
}
async function loadLatest({notify=false}={}){
  if(!supabase||!user||authStage==='setup'||loading||busy)return;
  const ticket=epoch,uid=user.id;loading=true;
  try{
    const {data:members,error:memberError}=await supabase.from('memberships').select('notebook_id,user_id,role').eq('user_id',uid);
    if(memberError)throw memberError;
    if(ticket!==epoch||user?.id!==uid)return;
    if(!members?.length){clearPrivate();authStage='denied';authMessage='このノートの招待が確認できません。家族の管理者に確認してください。';render();return;}
    const mine=members.find(m=>m.notebook_id===membership?.notebook_id)||members[0];
    const {data:doc,error:docError}=await supabase.from('notebook_documents').select('notebook_id,revision,notes,updated_at').eq('notebook_id',mine.notebook_id).maybeSingle();
    if(docError)throw docError;
    if(ticket!==epoch||user?.id!==uid)return;
    if(!doc){clearPrivate();authStage='denied';authMessage='現在このノートを閲覧できません。家族の管理者に確認してください。';render();return;}
    validateNotes(doc.notes);
    const previousRole=membership?.role;membership=mine;ready=true;authStage='ready';loadError='';
    if(view==='form'&&mine.role!=='writer'){view='home';applyDocument(doc);render();toast('記入の権限が変更されました。');return;}
    if(dirty()){
      if(doc.revision!==revision){remoteDocument=doc;showError('別の画面で記録が更新されています。入力内容は残しています。入力を控えてから「閉じる」で戻り、最新の内容を確認してください。');}
      else if(notify)toast('最新の記録です。入力内容はそのまま残っています。');
      return;
    }
    const changed=revision!==doc.revision||previousRole!==mine.role;applyDocument(doc);
    if(changed||!document.querySelector('.shell'))render();
    if(notify)toast('最新の記録を読み込みました。');
  }catch(err){
    if(ticket!==epoch)return;
    loadError='最新の記録を取得できませんでした。インターネット接続を確認して「更新」を押してください。';
    if(!ready){authStage='unavailable';authMessage=loadError;render();}else showError(loadError);
  }finally{loading=false;}
}
async function persist(next,{expectedRevision=revision}={}){
  if(!writer()||busy)return false;
  if(!navigator.onLine){showError('オフラインです。クラウドに保存できません。入力は残っています。接続後、もう一度保存してください。');return false;}
  // Invalidate any older in-flight reads before writing; their responses must not
  // replace the saved document or re-render a form while its inputs are locked.
  const ticket=++epoch;
  try{
    const clean=validateNotes(next);setBusy(true);
    const {data,error}=await supabase.rpc('save_notebook',{p_notebook_id:membership.notebook_id,p_expected_revision:expectedRevision,p_notes:clean});
    if(error)throw error;
    if(ticket!==epoch)return false;
    const doc=Array.isArray(data)?data[0]:data;
    if(!doc||!Number.isInteger(doc.revision))throw new Error('Invalid save response');
    applyDocument(doc);return true;
  }catch(err){showError(errorMessage(err,'保存できませんでした。入力内容は残っています。接続を確認して、もう一度保存してください。'));return false;}
  finally{setBusy(false);}
}
async function start(){
  render();
  if(!supabase){booting=false;authStage='unavailable';authMessage='接続先の設定がまだ完了していません。管理者に確認してください。';render();return;}
  const url=new URL(location.href),hashParams=new URLSearchParams(url.hash.slice(1));
  const hasCallback=url.searchParams.has('token_hash')||url.searchParams.has('type')||url.searchParams.has('error')||hashParams.has('access_token')||hashParams.has('error');
  if(hasCallback){
    const tokenHash=url.searchParams.get('token_hash'),type=url.searchParams.get('type');
    // Remove one-time credentials before any navigation, asset request, or UI output.
    history.replaceState(null,'',url.pathname);clearPrivate();markSetup(null);
    try{
      const {error:signOutError}=await supabase.auth.signOut({scope:'local'});if(signOutError)throw signOutError;
      if(!tokenHash||!['invite','recovery'].includes(type))throw new Error('Invalid link');
      const {data,error}=await supabase.auth.verifyOtp({token_hash:tokenHash,type});if(error||!data.user)throw error||new Error('Invalid link');
      user=data.user;markSetup(user.id);authStage='setup';authMessage='';
    }catch{user=null;authStage='signin';authMessage='このリンクは期限切れ、使用済み、または無効です。管理者に新しい設定リンクを発行してもらってください。';}
    booting=false;render();return;
  }
  try{
    const {data:{session},error}=await supabase.auth.getSession();if(error)throw error;
    if(!session){authStage='signin';return;}
    const {data,error:verifyError}=await supabase.auth.getUser();if(verifyError)throw verifyError;
    user=data.user;
    if(setupPending()===user?.id){authStage='setup';return;}
    authStage='ready';await loadLatest();
  }catch{authStage='signin';authMessage='ログイン状態を確認できませんでした。接続を確認して、もう一度ログインしてください。';}
  finally{booting=false;render();}
}
async function login(form){
  if(busy||!supabase)return;const data=new FormData(form);setBusy(true);booting=true;
  try{const {data:result,error}=await supabase.auth.signInWithPassword({email:String(data.get('email')).trim(),password:String(data.get('password'))});if(error)throw error;clearPrivate();user=result.user;authMessage='';authStage=setupPending()===user.id?'setup':'ready';setBusy(false);if(authStage==='ready')await loadLatest();render();}
  catch(err){showError(errorMessage(err,'ログインできませんでした。接続と入力内容を確認してください。'));}
  finally{booting=false;setBusy(false);}
}
async function setPassword(form){
  if(busy||!user||authStage!=='setup')return;const data=new FormData(form),password=String(data.get('password'));
  if(password.length<12){showError('パスワードは12文字以上にしてください。');return;}
  if(password!==data.get('confirmation')){showError('2つのパスワードが一致していません。');return;}
  setBusy(true);booting=true;
  try{const {error}=await supabase.auth.updateUser({password});if(error)throw error;markSetup(null);authStage='ready';authMessage='';setBusy(false);await loadLatest();render();toast('パスワードを設定しました。次回からメールアドレスとパスワードでログインできます。');}
  catch(err){showError(errorMessage(err,'パスワードを設定できませんでした。接続を確認してお試しください。'));}
  finally{booting=false;setBusy(false);}
}
async function logout(){
  if(busy)return;if(dirty()&&!await confirmAction('ログアウトしますか？','保存していない入力は消えます。必要な内容を控えてからログアウトしてください。','ログアウトする'))return;
  setBusy(true);booting=true;
  try{const {error}=await supabase.auth.signOut({scope:'local'});if(error)throw error;clearPrivate();user=null;markSetup(null);authStage='signin';authMessage='';render();}
  catch{showError('ログアウトできませんでした。接続を確認してもう一度お試しください。');}
  finally{booting=false;setBusy(false);}
}

function fieldSVG(){return `<svg class="field" viewBox="0 0 360 300" fill="none" aria-hidden="true"><circle cx="180" cy="155" r="139" stroke="#91ad76" stroke-opacity=".12"/><circle cx="180" cy="155" r="111" stroke="#91ad76" stroke-opacity=".1"/><path d="M180 254 62 136a167 167 0 0 1 236 0Z" fill="#294e3a" stroke="#6a8a55" stroke-width="1.3"/><path d="M180 254 86 160a133 133 0 0 1 188 0Z" fill="#355d40"/><path d="m180 254-70-70 70-70 70 70Z" fill="#9b9f67"/><path d="m180 237-52-52 52-52 52 52Z" fill="#54754b"/><path d="m180 254-70-70 70-70 70 70Z" stroke="#e7ebbd" stroke-width="1.5"/><path d="m180 254-132-132 M180 254l132-132" stroke="#b5c698" stroke-width="1.1"/><circle cx="180" cy="185" r="14" fill="#a6a873"/><path d="M175 184h10" stroke="#f4f1d4" stroke-width="2"/><path d="m180 108 6 6-6 6-6-6Z M104 184l6-6 6 6-6 6Z M244 184l6-6 6 6-6 6Z" fill="#f3f2db"/><path d="M175 250h10v6l-5 4-5-4Z" fill="#f3f2db"/><path d="M164 260v-14h8 M196 260v-14h-8" stroke="#c6d2a4"/><path d="M145 273a50 50 0 0 0 70 0" stroke="#b4c693"/><circle cx="300" cy="79" r="18" fill="#d5deae"/><path d="M289 66c14 5 14 21 0 26 M311 66c-14 5-14 21 0 26" stroke="#6a8060" stroke-width="1.4"/><path d="M54 239v12 M48 245h12 M277 229v8 M273 233h8" stroke="#a3b88a" stroke-width="1.5"/></svg>`;}
function intro(title,sub,eyebrow='MY BASEBALL JOURNEY',right=''){return `<section class="intro"><div><span class="eyebrow">${eyebrow}</span><h1>${title}</h1><p>${sub}</p></div>${right}</section>`;}
function empty(title,body,ico='book',action=''){return `<div class="card empty"><div class="empty-icon">${icon(ico)}</div><h3>${title}</h3><p>${body}</p>${action}</div>`;}
function noteCard(n){return `<button class="note-card" data-note="${e(n.id)}"><div class="card-meta"><span>${e(fmt(n.date))}</span><span class="badge ${n.type==='試合'?'orange':''}">${e(n.type)}</span>${n.categories.map(x=>`<span>${e(x)}</span>`).join(' · ')}</div><h3>${e(n.good||n.improve)}</h3><p>${e(n.goal?'次の目標：'+n.goal:n.improve||'今日の気づきを残しました。')}</p><div class="note-card-bottom">ノートを読み返す ${icon('arrow')}</div></button>`;}
function notesView(){return intro('自分の成長を、読み返そう。','できたことも、次へのヒントも。すべてここに。','MY NOTEBOOK')+`<div class="filters"><label class="search-wrap"><span class="visually-hidden">ノートを検索</span>${icon('search')}<input id="search" type="search" placeholder="言葉でノートを探す" value="${e(search)}"></label><label><span class="visually-hidden">カテゴリで絞る</span><select id="category-filter"><option value="">すべてのプレー</option>${CATEGORIES.map(c=>`<option ${category===c?'selected':''}>${c}</option>`).join('')}</select></label><label><span class="visually-hidden">種類で絞る</span><select id="type-filter"><option value="">練習・試合すべて</option>${TYPES.map(c=>`<option ${typeFilter===c?'selected':''}>${c}</option>`).join('')}</select></label></div><div id="note-results">${noteResults()}</div>`;}
function noteResults(){const ns=sorted(notes).filter(n=>(!category||n.categories.includes(category))&&(!typeFilter||n.type===typeFilter)&&(!search||[n.good,n.improve,n.goal,n.action,n.amount].join(' ').toLowerCase().includes(search.toLowerCase())));return `<p class="result-count" aria-live="polite">${ns.length}冊のノート</p>${ns.length?`<div class="notes-grid">${ns.map(noteCard).join('')}</div>`:empty(notes.length?'見つかりませんでした':'まだノートはありません',notes.length?'言葉や絞り込みを変えて探してみよう。':'今日の「できた」をひとつ、残してみよう。','book',notes.length?btn('絞り込みをリセット','reset-filters','secondary'):(writer()?btn('最初のノートを書く','new'):''))}`;}
function choices(name,items,values,multi=false){return `<div class="choices">${items.map(([v,t])=>`<label class="choice"><input type="${multi?'checkbox':'radio'}" name="${name}" value="${e(v)}" ${values.includes(v)?'checked':''}><span>${t}</span></label>`).join('')}</div>`;}
function reviewChoices(r){return `<div class="review-item"><p>${e(r.text)}</p>${choices('review-'+r.id,[['','まだ振り返らない'],['done','できた'],['partial','少しできた'],['notyet','次も取り組む']],[r.status||''])}</div>`;}
function formView(){const n=notes.find(x=>x.id===editingId)||{date:today(),type:'練習',categories:[],good:'',improve:'',goal:'',action:'',amount:'',feeling:'',reviews:[]};if(editingId)reviewItems=n.reviews.map(r=>({...r}));else reviewItems=sorted(notes).filter(x=>x.action&&!x.actionDone&&!x.goalDone).slice(0,3).map(x=>({id:x.id,text:x.action+(x.amount?' ／ '+x.amount:''),status:''}));return intro(editingId?'あの日の気づきを、書き足そう。':'今日のプレーを、振り返ろう。','一言でも大丈夫。「良かった点」か「うまくいかなかったこと」を書いて保存しよう。',editingId?'EDIT YOUR NOTE':'WRITE YOUR NEXT STEP')+`<form id="note-form" novalidate><div class="form-layout"><div><div id="form-error" class="form-error" role="alert" tabindex="-1" hidden></div><section class="card form-card"><h2>${icon('calendar')}今日の記録</h2><p>練習や試合のあとの、小さな振り返り。</p><div class="form-grid"><div class="field-group"><label for="date">日付</label><input id="date" name="date" type="date" min="1900-01-01" max="${today()}" value="${e(n.date)}" required></div><div class="field-group"><label>どんな日？</label>${choices('type',TYPES.map(t=>[t,t]),[n.type])}</div></div><div class="field-group"><label>振り返るプレー<span class="optional">いくつでも・任意</span></label>${choices('categories',CATEGORIES.map(t=>[t,t]),n.categories,true)}</div><div class="field-group"><label>今日の手ごたえ<span class="optional">任意</span></label>${choices('feeling',[['よかった','よかった'],['ふつう','ふつう'],['むずかしかった','むずかしかった']],[n.feeling])}</div></section>${reviewItems.length?`<section class="card form-card"><h2><span class="step">↩</span>前に決めたこと、どうだった？</h2><p>「できた」を選んで保存すると、その行動にチェックがつくよ。目標の達成は、あとで自分で決められます。</p>${reviewItems.map(reviewChoices).join('')}</section>`:''}<section class="card form-card"><h2><span class="step">01</span>今日の良かった点</h2><p>できたことや、うまくいった理由を残してみよう。</p><label for="good" class="visually-hidden">今日の良かった点</label><textarea id="good" name="good" maxlength="1600" placeholder="小さな「できた」も、自分の成長。">${e(n.good)}</textarea><p class="hint">例：ゴロを正面で取れた。最後までボールを見ることを意識できた。</p></section><section class="card form-card"><h2><span class="step">02</span>うまくいかなかったこと</h2><p>失敗は、次にうまくなるヒント。どんな場面だった？</p><label for="improve" class="visually-hidden">うまくいかなかったこと</label><textarea id="improve" name="improve" maxlength="1600" placeholder="くやしかったこと、次は変えたいこと。">${e(n.improve)}</textarea><p class="hint">例：送球を急いで、ボールが相手の頭より高くなってしまった。</p></section><section class="card form-card"><h2><span class="step">03</span>次の目標<span class="optional">任意</span></h2><p>次はどんなプレーができる自分になりたい？</p><label for="goal" class="visually-hidden">次の目標</label><textarea class="small" id="goal" name="goal" maxlength="300" placeholder="次の自分が目指すことを、ひとつ。">${e(n.goal)}</textarea><p class="hint">例：落ち着いて、相手の胸に届く送球をする。</p></section><section class="card form-card"><h2><span class="step">04</span>次の練習でやること<span class="optional">任意</span></h2><p>目標に近づくために「いつ・何を・どれくらい」する？</p><div class="field-group"><label for="action">いつ・何をする？</label><textarea id="action" class="small" name="action" maxlength="300" placeholder="例：次のキャッチボールで、相手の胸を見てから投げる">${e(n.action)}</textarea></div><div class="field-group"><label for="amount">どれくらい？<span class="optional">任意</span></label><input id="amount" name="amount" type="text" maxlength="100" value="${e(n.amount)}" placeholder="例：まずは10球、1球ずつ落ち着いて"></div><p class="hint">ここに書いたことは、ホームからいつでも確認できるよ。</p></section><div class="form-actions"><span>保存後も、いつでも書き直せます。</span><button type="submit" class="button">${icon('check')}${editingId?'変更を保存する':'ノートを保存する'}</button></div></div><aside class="form-aside"><h3>うまくなる、4つのステップ</h3><ol><li>良かったプレーを見つける</li><li>次に変えたいことを考える</li><li>目標をひとつ決める</li><li>練習でやることを具体的に</li></ol><p>全部を埋めなくても大丈夫。<br>今日、心に残ったことから書いてみよう。</p><p>打撃なら…<br>「狙い球を見逃した」<br>↓<br>「打つ前に狙う球を決める」<br>↓<br>「次の打撃練習で狙いを1つ決める」</p></aside></div></form>`;}
async function saveForm(){if(!writer()||busy)return;const f=document.querySelector('#note-form'),d=new FormData(f),date=d.get('date'),good=d.get('good').trim(),improve=d.get('improve').trim(),goal=d.get('goal').trim(),action=d.get('action').trim(),amount=d.get('amount').trim();if(!validDate(date)||date>today()){showError('日付を確認してください。今日までの日付を選ぼう。');return;}if(!good&&!improve){showError('「今日の良かった点」か「うまくいかなかったこと」を、ひとつ書いてみよう。');document.querySelector('#good').focus();return;}if(action&&!goal){showError('練習でやることにつながる「次の目標」も、ひとこと書いてみよう。');document.querySelector('#goal').focus();return;}if(amount&&!action){showError('「いつ・何をする？」に、練習することを書いてみよう。');document.querySelector('#action').focus();return;}const old=notes.find(n=>n.id===editingId),now=new Date().toISOString(),reviews=reviewItems.map(r=>({...r,status:d.get('review-'+r.id)||''})).filter(r=>r.status);const goalSame=old?.goal===goal,actionSame=old?.action===action&&old?.amount===amount;const n={id:old?.id||crypto.randomUUID(),date,type:d.get('type'),categories:d.getAll('categories'),good,improve,goal,action,amount,feeling:d.get('feeling')||'',goalDone:goalSame?old.goalDone:false,actionDone:actionSame?old.actionDone:false,goalDoneAt:goalSame?old.goalDoneAt:null,actionDoneAt:actionSame?old.actionDoneAt:null,createdAt:old?.createdAt||now,updatedAt:now,reviews};let next=old?notes.map(x=>x.id===old.id?n:x):[...notes,n];const newlyDone=new Set(reviews.filter(r=>r.status==='done'&&!old?.reviews.some(o=>o.id===r.id&&o.status==='done')).map(r=>r.id));next=next.map(x=>newlyDone.has(x.id)&&x.action?{...x,actionDone:true,actionDoneAt:now,updatedAt:now}:x);if(await persist(next)){view='detail';selectedId=n.id;editingId='';render();window.scrollTo({top:0});toast(old?'ノートを更新しました。':'今日の気づきを保存しました！');}}
function download(text,name){const url=URL.createObjectURL(new Blob([text],{type:'application/json;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function shell(content){const current=view==='detail'||view==='form'?'notes':view;return `<div class="shell"><aside class="sidebar"><a class="brand" href="#" data-view="home"><img src="${iconUrl}" alt=""><span>ジュンの<br>野球ノート<small>家族で見守る、成長の記録</small></span></a><nav aria-label="メインメニュー">${[['home','home','ホーム'],['notes','book','ノート一覧'],['goals','target','目標とやること'],['settings','settings',manager()?'家族と設定':'データと設定']].map(([v,i,t])=>`<button class="nav-item ${current===v?'active':''}" data-view="${v}" ${current===v?'aria-current="page"':''}>${icon(i)}<span>${t}</span></button>`).join('')}</nav><div class="sidebar-bottom"><div class="sidebar-line"></div><strong>小さな一歩を、積み重ねよう。</strong>今日の気づきが、<br>明日の自分を強くする。<p>JUN’S BASEBALL JOURNEY</p></div></aside><main class="main"><header class="topbar"><div class="page-name">${{home:'ホーム',notes:'ノート一覧',goals:'目標とやること',settings:manager()?'家族と設定':'データと設定',form:'ノートを書く',detail:'ノートを読む'}[view]}</div><a class="mobile-brand" href="#" data-view="home"><img src="${iconUrl}" alt="">ジュンの野球ノート</a><div class="top-right"><span class="role-badge">${e(roleLabel(membership.role))}</span>${btn('更新','refresh','secondary refresh-button')}${view==='form'?btn('閉じる','close-form','secondary'):writer()?btn(icon('plus')+'ノートを書く','new'):''}</div></header><div class="connection-strip"><span>${icon('lock')}家族だけのノート${writer()?'':' ・ 閲覧のみ'}</span><span id="connection-status">${navigator.onLine?'クラウドに保存':'オフライン · 保存できません'}</span></div>${loadError?`<div class="storage-error" role="alert">${e(loadError)}</div>`:''}<div id="page-error" class="form-error" role="alert" tabindex="-1" hidden></div>${content}<footer class="foot"><span>${icon('lock')}招待された家族だけが閲覧できます</span><span>ONE PLAY. ONE STEP.</span></footer></main></div>`;}
function authView(){
  const setup=authStage==='setup',waiting=authStage==='loading';
  return `<main class="auth-shell"><section class="auth-story"><a class="brand" href="./"><img src="${iconUrl}" alt=""><span>ジュンの野球ノート<small>家族で見守る、成長の記録</small></span></a><div class="auth-story-copy"><span class="eyebrow">JUN’S BASEBALL JOURNEY</span><h1>今日の気づきを、<br>明日のナイスプレーへ。</h1><p>うまくできたことも、くやしかったことも。<br>ひとつずつ書いて、次の一歩につなげよう。</p>${fieldSVG()}</div></section><section class="auth-panel"><div class="auth-card"><span class="eyebrow">FAMILY NOTEBOOK</span><h2>${waiting?'ログインを確認しています':setup?'自分のパスワードを決めよう':authStage==='denied'?'招待を確認してください':authStage==='unavailable'?'接続を確認してください':'おかえりなさい'}</h2><p>${setup?`${e(user?.email)} のパスワードを設定します。12文字以上で、本人だけがわかるものにしてください。`:waiting?'少しお待ちください。':'招待された家族のメールアドレスでログインできます。'}</p><div id="auth-error" class="form-error" role="alert" tabindex="-1" ${authMessage?'':'hidden'}>${e(authMessage)}</div>${waiting?'':setup?`<form id="password-form"><label for="password">新しいパスワード</label><input id="password" name="password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required><label for="confirmation">もう一度入力</label><input id="confirmation" name="confirmation" type="password" autocomplete="new-password" minlength="12" maxlength="128" required><button class="button" type="submit">パスワードを設定してはじめる ${icon('arrow')}</button></form>${btn('ログアウト','logout','ghost')}`:authStage==='denied'||authStage==='unavailable'?`<div class="auth-actions">${btn('もう一度確認する','retry','secondary')}${user?btn('ログアウト','logout','ghost'):btn('ログインへ','signin','ghost')}</div>`:`<form id="login-form"><label for="email">メールアドレス</label><input id="email" name="email" type="email" autocomplete="username" required placeholder="招待を受けたメールアドレス"><label for="password">パスワード</label><input id="password" name="password" type="password" autocomplete="current-password" required><button class="button" type="submit">ログイン ${icon('arrow')}</button></form><div class="auth-help"><strong>はじめての方・パスワードを忘れた方</strong><p>家族の管理者から設定リンクを受け取ってください。招待のない方は利用できません。</p></div>`}<p class="auth-privacy">${icon('lock')}記録はログインした家族だけに表示されます。</p></div></section></main>`;
}
function goalCard(n){return `<article class="card goal-card"><div class="card-meta"><span>${e(fmt(n.date))} のノートから</span>${n.categories.map(c=>`<span class="badge">${e(c)}</span>`).join('')}</div><div class="goal-title"><h3>${e(n.goal)}</h3>${n.goalDone?'<span class="badge">達成！</span>':''}</div>${n.action?`<label class="check-row"><input type="checkbox" data-check="action" data-id="${e(n.id)}" ${n.actionDone?'checked':''} ${writer()?'':'disabled'}><span><strong>${e(n.action)}</strong>${n.amount?`<small>${e(n.amount)}</small>`:''}<small>${n.actionDone?'✓ 練習できた！':writer()?'練習できたら、チェックしよう':'これから取り組むこと'}</small></span></label>`:`<p class="hint">${writer()?'具体的にやることは、ノートの編集から追加できます。':'具体的にやることは、まだ書かれていません。'}</p>`}<div class="goal-end">${writer()?`<button class="button ${n.goalDone?'secondary':'light'}" data-check="goal" data-id="${e(n.id)}">${icon(n.goalDone?'check':'flag')}${n.goalDone?'達成を取り消す':'目標を達成した！'}</button>`:`<span class="hint">${n.goalDone?'達成した目標':'取り組み中の目標'}</span>`}<button class="button ghost" data-note="${e(n.id)}">ノートへ ${icon('chevron')}</button></div></article>`;}
function home(){const s=stats(notes),active=sorted(notes).filter(n=>n.goal&&!n.goalDone);return intro(writer()?'今日も、一歩ずつ。':'ジュンの成長を、見守ろう。',writer()?'書いて、気づいて、次のプレーにつなげよう。':'日々の気づきと、次に向かう一歩を家族で。','YOUR NEXT PLAY','<span class="season-tag">BASEBALL JOURNAL</span>')+`<section class="hero"><div class="hero-copy"><span class="eyebrow">MAKE EVERY PLAY COUNT</span><h2>今日の気づきを、<br>明日のナイスプレーへ。</h2><p>うまくできたことも、くやしかったことも。<br>自分だけの成長を、ここに残そう。</p>${writer()?btn('今日のノートを書く '+icon('arrow'),'new','light'):'<button class="button light" data-view="notes">ノートを読む '+icon('arrow')+'</button>'}</div><div class="field-wrap">${fieldSVG()}<span class="field-caption">THE NEXT PLAY STARTS HERE</span></div></section><section class="stats" aria-label="これまでの記録">${[['book','書いたノート',s.notes,'冊'],['target','取り組んでいる目標',s.active,'個'],['flag','達成した目標',s.done,'個']].map(([i,t,num,u])=>`<div class="stat"><div class="stat-icon">${icon(i)}</div><div><div class="stat-label">${t}</div><div class="stat-num">${num}<span>${u}</span></div></div></div>`).join('')}</section><div class="home-grid"><section><div class="section-head"><h2>${icon('target')}次の練習でやること <span class="count">${active.length}</span></h2><button class="button ghost" data-view="goals">すべて見る ${icon('chevron')}</button></div>${active.length?active.slice(0,2).map(goalCard).join(''):empty('次の一歩を、ひとつずつ。','ノートに「次の目標」を書くと、<br>ここでいつでも見返せます。','target',writer()?btn('目標をノートに書く '+icon('arrow'),'new','ghost'):'')}</section><section><div class="section-head"><h2>${icon('book')}最近のノート</h2><button class="button ghost" data-view="notes">すべて見る ${icon('chevron')}</button></div>${notes.length?sorted(notes).slice(0,3).map(noteCard).join(''):empty('最初の1ページを、ここから。','「できたこと」ひとつだけでも大丈夫。<br>今日のプレーを振り返ってみよう。','book',writer()?btn('はじめてのノートを書く '+icon('arrow'),'new','ghost'):'')}</section></div><div class="home-tip">${icon('spark')}<span><strong>今日のヒント</strong>　「がんばる」から、もう一歩。「次のキャッチボールで、相手の胸を見てから10球投げる」のように書いてみよう。</span></div>`;}
function goalsView(){const list=sorted(notes).filter(n=>n.goal&&(goalTab==='done'?n.goalDone:!n.goalDone)),s=stats(notes);return intro('次にやることを、ひとつずつ。',writer()?'練習を実行できたらチェック。目標に届いたら、達成にしよう。':'取り組んでいる目標と、できたことを見守ろう。','GOALS & NEXT ACTIONS')+`<div class="tabs" aria-label="目標の表示"><button class="tab ${goalTab==='active'?'active':''}" aria-pressed="${goalTab==='active'}" data-goal-tab="active">取り組み中 ${s.active}</button><button class="tab ${goalTab==='done'?'active':''}" aria-pressed="${goalTab==='done'}" data-goal-tab="done">達成した目標 ${s.done}</button></div>${list.length?`<div class="goals-grid">${list.map(goalCard).join('')}</div>`:empty(goalTab==='done'?'達成した目標は、ここに残ります':'次の練習で、何をしよう？',goalTab==='done'?'小さな目標からで大丈夫。自分のペースで積み重ねよう。':'ノートに目標と具体的な練習を書くと、ここに表示されます。','target',goalTab==='active'&&writer()?btn('目標をノートに書く','new'):'')}<p class="hint">練習できた行動：${s.actions}個　・　目標を達成した数：${s.done}個</p>`;}
function detailView(){const n=notes.find(x=>x.id===selectedId);if(!n){view='notes';return notesView();}return intro('あの日の自分から、次のヒント。','書いた気づきを、次の練習に持っていこう。','LOOK BACK & GROW',btn(icon('back')+'一覧へ','back-notes','secondary'))+`<div class="detail"><article class="card"><header class="detail-header"><div class="card-meta"><span class="badge ${n.type==='試合'?'orange':''}">${e(n.type)}</span>${n.categories.map(c=>`<span class="badge">${e(c)}</span>`).join('')}</div><h1>${e(fmt(n.date,{year:'numeric',month:'long',day:'numeric',weekday:'short'}))}</h1>${n.feeling?`<p class="hint">今日の手ごたえ：${e(n.feeling)}</p>`:''}</header>${[['01 今日の良かった点',n.good],['02 うまくいかなかったこと',n.improve],['03 次の目標',n.goal],['04 次の練習でやること',n.action+(n.amount?'\n'+n.amount:'')]].map(([t,v])=>`<section class="detail-section"><h2>${t}</h2><p>${v?e(v):'<span class="hint">まだ書いていません。</span>'}</p></section>`).join('')}${n.reviews.length?`<section class="detail-section"><h2>前に決めたことの振り返り</h2>${n.reviews.map(r=>`<p>${e(r.text)}</p><p class="subtext">${{done:'できた',partial:'少しできた',notyet:'次も取り組む'}[r.status]}</p>`).join('')}</section>`:''}</article>${writer()?`<div class="detail-actions"><button class="button ghost danger-text" data-action="delete-note">${icon('trash')}削除</button>${btn(icon('edit')+'ノートを編集','edit','secondary')}</div>`:'<div class="detail-actions"><span class="hint">記入と達成チェックはジュン本人が行います。</span></div>'}${n.goal?goalCard(n):''}</div>`;}
function familyView(){
  if(!manager())return '';
  return `<section class="card settings-card family-card"><div class="section-head"><h2>${icon('lock')}家族の管理</h2>${btn('一覧を更新','family-refresh','secondary')}</div><p>ノートの記入はジュン本人1名だけ。家族は閲覧できます。設定リンクを本人へ直接渡してください。メールは自動送信されません。</p><form id="invite-form" class="invite-form"><div><label for="invite-email">招待する人のメールアドレス</label><input type="email" id="invite-email" name="email" autocomplete="off" required></div><div><label for="invite-role">使い方</label><select id="invite-role" name="role"><option value="viewer">家族として読む</option><option value="writer" ${family.some(m=>m.role==='writer')?'disabled':''}>ジュン本人が記入する</option></select></div><button class="button" type="submit">招待リンクを作る</button></form>${family.some(m=>m.role==='writer')?'<p class="hint">ジュン用アカウントは登録済みです。入り直す場合は、下の「再設定リンク」を使ってください。</p>':''}${generatedLink?`<div class="link-result"><strong>${e(generatedLink.email)} の${generatedLink.kind==='invite'?'招待':'再設定'}リンク</strong><p>期限付き・一度だけ使えます。本人が開いてパスワードを設定します。このリンクは本人以外に渡さないでください。</p><label class="visually-hidden" for="private-link">本人に渡す設定リンク</label><textarea readonly id="private-link" spellcheck="false">${e(generatedLink.link)}</textarea><div class="link-actions">${btn('リンクをコピー','copy-link','secondary')}${btn('表示を閉じる','hide-link','ghost')}</div></div>`:''}<div class="member-list">${familyLoaded?family.map(m=>`<article class="member"><div><strong>${e(m.email)}</strong><span>${e(roleLabel(m.role))}${m.user_id===user.id?' · 自分':''}</span></div>${m.role==='manager'?'<span class="hint">管理者は解除できません</span>':`<div class="member-actions"><button class="button secondary" data-family-action="recovery" data-user-id="${e(m.user_id)}">再設定リンク</button><button class="button ghost danger-text" data-family-action="remove" data-user-id="${e(m.user_id)}">招待を解除</button></div>`}</article>`).join(''):'<p class="hint">家族の一覧を読み込んでいます。</p>'}</div></section>`;
}
function settingsView(){return intro('大切な記録を、残しておこう。','家族で同じ記録を読み返せます。バックアップも手元に残せます。','FAMILY & SETTINGS')+`<section class="card account-card"><div><strong>${e(user.email)}</strong><p>${e(roleLabel(membership.role))}${writer()?' · 記入・編集・達成チェックができます':' · ノートは閲覧のみ'}</p></div>${btn('ログアウト','logout','secondary')}</section>${familyView()}<div class="settings-grid"><section class="card settings-card"><div class="icon-box">${icon('download')}</div><h2>バックアップを書き出す</h2><p>保存した${notes.length}冊のノートと目標・行動チェックを、JSONファイルにまとめます。家族の記録なので、ファイルも大切に保管してください。</p>${btn(icon('download')+'ファイルに保存','export','secondary')}</section>${writer()?`<section class="card settings-card"><div class="icon-box">${icon('upload')}</div><h2>前の記録を読み込む</h2><p>以前のノートで書き出したJSONを選びます。今の記録を残して、新しいノートだけ追加します。同じIDや同じ内容は追加しません。</p>${btn(icon('upload')+'ファイルを選ぶ','import','secondary')}<input id="import-file" type="file" accept=".json,application/json" class="visually-hidden" aria-label="バックアップファイル"></section>`:`<section class="card settings-card"><div class="icon-box">${icon('book')}</div><h2>家族で見守る</h2><p>ノートの作成・編集・削除、目標や行動のチェック、バックアップの取り込みはジュン本人のアカウントで行います。</p></section>`}</div><div class="notice"><strong>${icon('lock')}保存について</strong>ノートはクラウドに保存されます。インターネット接続がない間は保存できません。<br>別の端末の変更は「更新」または画面を開き直すと表示されます。以前の端末の記録は、自動では移りません。元のノートからJSONを書き出し、ジュン本人でログインして読み込んでください。</div>${writer()?`<div class="danger-zone"><div><strong>すべての記録を削除</strong><p>家族全員からノート・目標・行動チェックが見えなくなります。先にバックアップを取っておこう。</p></div>${btn('すべての記録を削除','delete-all','secondary danger-text')}</div>`:''}`;}
function render(){
  if(!ready||authStage!=='ready'){root.innerHTML=authView();return;}
  if(view==='form'&&!writer())view='home';
  const content={home,notes:notesView,goals:goalsView,form:formView,detail:detailView,settings:settingsView}[view]();root.innerHTML=shell(content);if(view==='form')formBase=formState();
}
function newNote(){if(!writer())return;editingId='';void navigate('form');}
async function importFile(file){if(!file||!writer()||busy)return;try{if(file.size>5*1024*1024)throw new Error('ファイルが大きすぎます。5MB以下のバックアップを選んでください。');const imported=parseBackup(await file.text()),expectedRevision=revision,merged=mergeBackup(notes,imported);if(!merged.added){toast(`追加するノートはありません。同じ記録${merged.skipped}冊をスキップしました。`);return;}if(await confirmAction('バックアップを追加しますか？',`${merged.added}冊を追加します。同じ記録${merged.skipped}冊はスキップします。現在の${notes.length}冊は置き換えず、そのまま残します。`,'追加して読み込む')){if(await persist(merged.notes,{expectedRevision})){render();toast(`${merged.added}冊のノートを追加しました。`);}}}catch(err){showError(err.message);}finally{const input=document.querySelector('#import-file');if(input)input.value='';}}
async function familyRequest(body){
  const {data,error}=await supabase.functions.invoke('family-admin',{body:{notebook_id:membership.notebook_id,...body}});
  if(error){let detail='',code='';try{const result=await error.context?.json();detail=result?.error||result?.message||'';code=result?.code||'';}catch{/* No valid JSON response. */}const failure=new Error(typeof detail==='string'?detail:error.message);failure.status=error.context?.status;failure.code=code;failure.userMessage=detail;throw failure;}
  if(data?.error)throw new Error(data.error);return data;
}
function familyError(err){if(err?.code&&typeof err.userMessage==='string')return err.userMessage;const msg=String(err?.message||'');if(/writer.*exists|WRITER_EXISTS|WRITER_ALREADY|ジュン|記入者/.test(msg))return 'ジュン用アカウントは登録済みです。一覧を更新して、再設定リンクを発行してください。';if(/already|exists|ALREADY|registered/.test(msg))return 'このメールアドレスは登録済みです。一覧の再設定リンクを使ってください。';if(/manager|MANAGER|self|SELF/.test(msg))return '管理者のアカウントはこの画面から解除・再設定できません。';return errorMessage(err,'操作できませんでした。メールアドレスと接続を確認し、一覧を更新してお試しください。');}
async function loadFamily(){
  if(!manager()||familyLoading)return;familyLoading=true;const ticket=epoch;
  try{const result=await familyRequest({action:'list'});if(ticket!==epoch||!manager())return;family=Array.isArray(result.members)?result.members:[];familyLoaded=true;if(view==='settings')render();}
  catch(err){showError(familyError(err));}finally{familyLoading=false;}
}
async function invite(form){
  if(!manager()||busy)return;const data=new FormData(form),email=String(data.get('email')).trim(),role=String(data.get('role'));
  if(!await confirmAction('この家族を招待しますか？',`${email} を「${roleLabel(role)}」として招待します。${role==='writer'?'ノートの作成・編集・削除ができるジュン本人用のアカウントです。':'ノートを閲覧できます。'}`,'招待リンクを作る'))return;
  setBusy(true);try{const result=await familyRequest({action:'invite',email,role});if(!result.link)throw new Error('Missing link');generatedLink={link:result.link,email,kind:'invite'};familyLoaded=false;await loadFamily();render();toast('本人に渡す招待リンクを作りました。');}catch(err){showError(familyError(err));}finally{setBusy(false);}
}
async function familyAction(action,uid){
  if(!manager()||busy)return;const member=family.find(m=>m.user_id===uid);if(!member||member.role==='manager'||uid===user.id)return;
  const remove=action==='remove';if(!await confirmAction(remove?'この家族の招待を解除しますか？':'再設定リンクを作りますか？',`${member.email}（${roleLabel(member.role)}）${remove?' は、次のデータ取得からノートを閲覧できなくなります。':' 本人にだけリンクを渡してください。本人がパスワードを設定し直せます。'}`,remove?'招待を解除する':'再設定リンクを作る'))return;
  setBusy(true);try{const result=await familyRequest({action,user_id:uid});if(remove){generatedLink=null;await loadFamily();toast('招待を解除しました。');}else{if(!result.link)throw new Error('Missing link');generatedLink={link:result.link,email:member.email,kind:'recovery'};toast('本人に渡す再設定リンクを作りました。');}render();}catch(err){showError(familyError(err));}finally{setBusy(false);}
}
root.addEventListener('submit',ev=>{ev.preventDefault();if(busy)return;if(ev.target.id==='note-form')void saveForm();if(ev.target.id==='login-form')void login(ev.target);if(ev.target.id==='password-form')void setPassword(ev.target);if(ev.target.id==='invite-form')void invite(ev.target);});
root.addEventListener('input',ev=>{if(ev.target.id==='search'){search=ev.target.value;document.querySelector('#note-results').innerHTML=noteResults();}});
root.addEventListener('change',ev=>{if(ev.target.id==='category-filter'){category=ev.target.value;document.querySelector('#note-results').innerHTML=noteResults();}if(ev.target.id==='type-filter'){typeFilter=ev.target.value;document.querySelector('#note-results').innerHTML=noteResults();}if(ev.target.id==='import-file')void importFile(ev.target.files[0]);});
root.addEventListener('click',async ev=>{
  const t=ev.target.closest('[data-action],[data-view],[data-note],[data-check],[data-goal-tab],[data-family-action]');if(!t||busy||t.disabled)return;
  if(t.dataset.view){ev.preventDefault();await navigate(t.dataset.view);return;}
  if(t.dataset.note){await navigate('detail',t.dataset.note);return;}
  if(t.dataset.goalTab){goalTab=t.dataset.goalTab;render();return;}
  if(t.dataset.familyAction){await familyAction(t.dataset.familyAction,t.dataset.userId);return;}
  if(t.dataset.check){if(!writer())return;const n=notes.find(x=>x.id===t.dataset.id),kind=t.dataset.check,key=kind==='goal'?'goalDone':'actionDone';if(!n)return;const on=!n[key],next=notes.map(x=>x.id===n.id?{...x,[key]:on,[key+'At']:on?new Date().toISOString():null,updatedAt:new Date().toISOString()}:x);if(await persist(next)){render();toast(on?(kind==='goal'?'目標達成！ 積み重ねた自分に拍手。':'練習できた！ 次の一歩につなげよう。'):'チェックを戻しました。');}else if(t.type==='checkbox')t.checked=n[key];return;}
  const a=t.dataset.action;
  if(a==='new')newNote();
  if(a==='close-form')await navigate('home');
  if(a==='back-notes')await navigate('notes');
  if(a==='edit'&&writer()){editingId=selectedId;await navigate('form');}
  if(a==='delete-note'&&writer()){const n=notes.find(x=>x.id===selectedId);if(n&&await confirmAction('このノートを削除しますか？',`${fmt(n.date)}のノートと、このノートの目標・行動チェックが消えます。この操作は取り消せません。`)){if(await persist(notes.filter(x=>x.id!==n.id))){view='notes';render();toast('ノートを削除しました。');}}}
  if(a==='reset-filters'){search='';category='';typeFilter='';render();}
  if(a==='export'&&ready){download(backup(notes),`jun-baseball-note-${today()}.json`);toast('バックアップをダウンロードしました。');}
  if(a==='import'&&writer())document.querySelector('#import-file').click();
  if(a==='delete-all'&&writer()&&await confirmAction('すべての記録を削除しますか？',`${notes.length}冊のノートと、すべての目標・行動チェックが家族全員から見えなくなります。バックアップがない場合は元に戻せません。`,'すべて削除する')){if(await persist([])){render();toast('すべての記録を削除しました。');}}
  if(a==='refresh'){await loadLatest({notify:true});if(manager()&&view==='settings')await loadFamily();}
  if(a==='retry'){if(user)await loadLatest({notify:true});else await start();}
  if(a==='signin'){authStage='signin';authMessage='';render();}
  if(a==='logout')await logout();
  if(a==='family-refresh')await loadFamily();
  if(a==='copy-link'&&generatedLink){try{await navigator.clipboard.writeText(generatedLink.link);toast('リンクをコピーしました。本人だけに渡してください。');}catch{document.querySelector('#private-link')?.select();toast('表示されたリンクを長押し、またはコピーしてください。');}}
  if(a==='hide-link'){generatedLink=null;render();}
});
window.addEventListener('beforeunload',ev=>{if(dirty()||busy){ev.preventDefault();ev.returnValue='';}});
function connectionChanged(){const el=document.querySelector('#connection-status');if(el)el.textContent=navigator.onLine?'クラウドに保存':'オフライン · 保存できません';if(navigator.onLine)void loadLatest();}
window.addEventListener('online',connectionChanged);window.addEventListener('offline',connectionChanged);
window.addEventListener('focus',()=>{if(!booting)void loadLatest();});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&!booting)void loadLatest();});
if(supabase)supabase.auth.onAuthStateChange((event,session)=>{
  // Never await another Auth call inside this callback: it holds the SDK auth lock.
  if(booting)return;
  if(event==='SIGNED_OUT'){clearPrivate();user=null;authStage='signin';authMessage='ログアウトしました。';render();return;}
  if(session?.user&&user?.id&&session.user.id!==user.id){clearPrivate();user=session.user;authStage=setupPending()===user.id?'setup':'ready';render();setTimeout(()=>void loadLatest(),0);}
});
void start();
