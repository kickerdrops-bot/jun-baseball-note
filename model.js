export const KEY = 'diamond-note.v1';
export const CATEGORIES = ['打撃','守備','走塁','投球','その他'];
export const TYPES = ['練習','試合','自主練'];
export const LIMITS = {good:1600,improve:1600,goal:300,action:300,amount:100};
export function today(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
export function validDate(s){if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;const d=new Date(s+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s&&s>='1900-01-01'&&s<='2100-12-31';}
function fail(){throw new Error('野球ノートのバックアップ形式と合っていません。書き出したJSONファイルを選んでください。');}
export function validateNotes(notes){if(!Array.isArray(notes)||notes.length>3000)fail();const ids=new Set();for(const n of notes){if(!n||typeof n!=='object'||typeof n.id!=='string'||!/^[\w-]{1,80}$/.test(n.id)||ids.has(n.id))fail();ids.add(n.id);if(!validDate(n.date)||!TYPES.includes(n.type)||!Array.isArray(n.categories)||n.categories.length>5||new Set(n.categories).size!==n.categories.length||n.categories.some(x=>!CATEGORIES.includes(x)))fail();for(const [k,max] of Object.entries(LIMITS)){if(typeof n[k]!=='string'||n[k].length>max)fail();}if(!n.good.trim()&&!n.improve.trim())fail();if(n.action.trim()&&!n.goal.trim()||n.amount.trim()&&!n.action.trim())fail();for(const k of ['goalDone','actionDone'])if(typeof n[k]!=='boolean')fail();if(n.goalDone&&!n.goal.trim()||n.actionDone&&!n.action.trim())fail();for(const k of ['createdAt','updatedAt'])if(typeof n[k]!=='string'||!Number.isFinite(Date.parse(n[k])))fail();for(const k of ['goalDoneAt','actionDoneAt'])if(n[k]!==null&&(typeof n[k]!=='string'||!Number.isFinite(Date.parse(n[k]))))fail();if(!['','よかった','ふつう','むずかしかった'].includes(n.feeling))fail();if(!Array.isArray(n.reviews)||n.reviews.length>6)fail();for(const r of n.reviews){if(!r||typeof r.id!=='string'||!/^[\w-]{1,80}$/.test(r.id)||typeof r.text!=='string'||r.text.length>450||!['done','partial','notyet'].includes(r.status))fail();}}
return notes.map(n=>({id:n.id,date:n.date,type:n.type,categories:[...n.categories],good:n.good,improve:n.improve,goal:n.goal,action:n.action,amount:n.amount,feeling:n.feeling,goalDone:n.goalDone,actionDone:n.actionDone,goalDoneAt:n.goalDoneAt,actionDoneAt:n.actionDoneAt,createdAt:n.createdAt,updatedAt:n.updatedAt,reviews:n.reviews.map(r=>({id:r.id,text:r.text,status:r.status}))}));}
export function parseBackup(text){if(typeof text!=='string'||text.length>5*1024*1024)throw new Error('ファイルが大きすぎます。5MB以下のバックアップを選んでください。');let data;try{data=JSON.parse(text);}catch{throw new Error('ファイルを読み取れませんでした。JSON形式のバックアップを選んでください。');}if(!data||data.app!=='diamond-note'||data.version!==1)fail();return validateNotes(data.notes);}
export function backup(notes){return JSON.stringify({app:'diamond-note',version:1,title:'ジュンの野球ノート',exportedAt:new Date().toISOString(),notes:validateNotes(notes)},null,2);}
// Add only new records. Cloud records always win an ID collision; repeated imports are safe.
export function mergeBackup(current,incoming){
  const notes=validateNotes(current),imported=validateNotes(incoming),ids=new Set(notes.map(n=>n.id));
  const fingerprint=n=>JSON.stringify([n.date,n.type,n.categories,n.good,n.improve,n.goal,n.action,n.amount,n.feeling]);
  const content=new Set(notes.map(fingerprint));let skipped=0;
  for(const n of imported){const key=fingerprint(n);if(ids.has(n.id)||content.has(key)){skipped++;continue;}notes.push(n);ids.add(n.id);content.add(key);}
  validateNotes(notes);return {notes,added:notes.length-current.length,skipped};
}
export function sorted(notes){return [...notes].sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt));}
export function stats(notes){return {notes:notes.length,days:new Set(notes.map(n=>n.date)).size,active:notes.filter(n=>n.goal&&!n.goalDone).length,done:notes.filter(n=>n.goalDone).length,actions:notes.filter(n=>n.actionDone).length};}
