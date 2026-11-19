import {useEffect,useState} from 'react';
import {Activity,Check,Clock3,Plus,Trash2} from 'lucide-react';
import {api,errorMessage} from '../lib/api';
import {todayKey} from '../lib/dates';
import type {Notify,User} from '../lib/types';
import {refreshWorkspace} from '../lib/workspace';
import {ConfirmDialog,Modal} from '../components/ui';
import type {Row} from './schema';

type Exercise={name:string;sets:number;reps:number;kg:number|null};
type Effort={name:string;reps:number;kg:number|null};
type Session={started:number;title:string;program:Exercise[];index:number;efforts:Effort[];restUntil:number};
const clock=(seconds:number)=>Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');
const storage=(id:string)=>'lifehub.workout.draft.'+id;

export function readWorkout(id:string):Session|null {
  try{
    const saved=JSON.parse(localStorage.getItem(storage(id))??'null');
    return saved&&typeof saved.title==='string'&&typeof saved.started==='number'&&Array.isArray(saved.efforts)&&Array.isArray(saved.program)?saved:null;
  }catch{return null;}
}

export function openWorkout(program?:Row){
  window.dispatchEvent(new CustomEvent('lifehub:workout-open',{detail:program}));
}
export function useActiveWorkout(id:string){
  const [session,setSession]=useState(()=>readWorkout(id));
  useEffect(()=>{
    const update=()=>setSession(readWorkout(id));
    window.addEventListener('lifehub:workout-change',update);
    return ()=>window.removeEventListener('lifehub:workout-change',update);
  },[id]);
  return session;
}

export function WorkoutSession({user,notify}:{user:User;notify:Notify}){
  const [session,setSession]=useState(()=>readWorkout(user.id));
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[discard,setDiscard]=useState(false);
  const [programs,setPrograms]=useState<Row[]>([]),[program,setProgram]=useState('');
  const [title,setTitle]=useState(''),[name,setName]=useState(''),[kg,setKg]=useState(''),[reps,setReps]=useState('10');
  const [now,setNow]=useState(Date.now);
  const [last,setLast]=useState<Record<string,Effort>>({});
  const pro=user.plan==='pro'||(user.plan==='trial'&&Date.parse(user.trial_ends??'')>Date.now());
  function record(next:Session|null){
    setSession(next);
    try{
      if(next)localStorage.setItem(storage(user.id),JSON.stringify(next));else localStorage.removeItem(storage(user.id));
    }catch{}
    window.dispatchEvent(new Event('lifehub:workout-change'));
  }
  const current=session?.program[session.index];
  const rest=session?Math.max(0,Math.ceil((session.restUntil-now)/1000)):0;
  useEffect(()=>{
    const show=(event:Event)=>{
      const program=(event as CustomEvent<Row|undefined>).detail;
      setError('');setOpen(true);setNow(Date.now());
      if(program?.id&&!session){
        setPrograms(old=>old.some(item=>item.id===program.id)?old:[program,...old]);
        setProgram(program.id);setTitle(String(program.title??''));
      }
    };
    window.addEventListener('lifehub:workout-open',show);
    return ()=>window.removeEventListener('lifehub:workout-open',show);
  },[session]);
  useEffect(()=>{
    if(!open)return;
    const controller=new AbortController(),signal=controller.signal;
    const timer=window.setInterval(()=>setNow(Date.now()),1000);
    if(!session&&pro)api<{items:Row[]}>('/health/programs',{signal}).then(result=>{
      if(!signal.aborted)setPrograms(result.items);
    }).catch(()=>{});
    api<{items:Row[]}>('/health/workouts?limit=30',{signal}).then(result=>{
      if(signal.aborted)return;
      const last:Record<string,Effort>=Object.create(null);
      for(const row of result.items){
        const entries=Array.isArray(row.efforts)?row.efforts as Effort[]:[];
        for(const entry of entries.slice().reverse())if(!last[entry.name])last[entry.name]=entry;
      }
      setLast(last);
    }).catch(()=>{});
    return ()=>{controller.abort();window.clearInterval(timer);};
  },[open,pro,user.id]);
  useEffect(()=>{
    if(!current)return;
    const previous=last[current.name];
    setName(current.name);
    setReps(String(previous?.reps??current.reps));
    setKg(previous?.kg!=null?String(previous.kg):current.kg!=null?String(current.kg):'');
  },[current,last]);
  function start(){
    if(!title.trim())return;
    const source=programs.find(item=>item.id===program);
    const now=Date.now();
    setNow(now);
    record({started:now,title:title.trim(),program:Array.isArray(source?.exercises)?source.exercises as Exercise[]:[],index:0,efforts:[],restUntil:0});
  }
  function add(){
    if(!session||session.efforts.length>=500||!name.trim())return;
    const effort={name:name.trim(),reps:Number(reps),kg:kg===''?null:Number(kg)};
    const efforts=[...session.efforts,effort];
    const done=current?efforts.filter(item=>item.name===current.name).length:0;
    record({...session,efforts,index:current&&done>=current.sets?session.index+1:session.index,restUntil:Date.now()+90_000});
    setNow(Date.now());
  }
  async function finish(){
    if(!session||busy)return;
    setBusy(true);setError('');
    try{
      await api('/health/workouts',{method:'POST',body:{day:todayKey(user.timezone),title:session.title,
        minutes:Math.max(1,Math.min(1440,Math.round((Date.now()-session.started)/60_000))),efforts:session.efforts}});
      record(null);setOpen(false);setTitle('');setName('');setProgram('');setKg('');refreshWorkspace();notify('Тренировка сохранена');
    }catch(e){setError(errorMessage(e));}
    finally{setBusy(false);}
  }
  if(!open)return null;
  return <><Modal title={session?'Идёт тренировка':'Начать тренировку'} onClose={()=>!busy&&setOpen(false)} className={'life-workout-modal'+(session?' live':'')}>
    {!session?<form onSubmit={e=>{e.preventDefault();start();}}><div className="modal-body product-form">
      {pro&&programs.length>0&&<label>Программа<select value={program} onChange={e=>{setProgram(e.target.value);const row=programs.find(item=>item.id===e.target.value);if(row)setTitle(String(row.title));}}>
        <option value="">Свободная тренировка</option>{programs.map(row=><option value={row.id} key={row.id}>{String(row.title)}</option>)}</select></label>}
      <label>Название<input required value={title} maxLength={300} onChange={e=>setTitle(e.target.value)} placeholder="Например, силовая тренировка"/></label>
    </div><footer className="modal-footer"><button className="button primary"><Activity size={17}/>Начать</button></footer></form>:
      <div className="modal-body life-workout-session">
        <header><span><i/>Идёт тренировка</span><time>{clock(Math.max(0,Math.floor((now-session.started)/1000)))}</time></header>
        <h3>{session.title}</h3>
        {current&&<p>{current.name} · подход {Math.min(current.sets,session.efforts.filter(e=>e.name===current.name).length+1)} из {current.sets}</p>}
        {current&&<div className="life-session-steps">{Array.from({length:current.sets},(_,i)=><i key={i} data-done={i<session.efforts.filter(e=>e.name===current.name).length||undefined}/>)}</div>}
        <form className="life-workout-effort" onSubmit={e=>{e.preventDefault();add();}}>
          <label>Упражнение<input value={name} maxLength={200} required onChange={e=>setName(e.target.value)}/></label>
          <label>Вес, кг<input value={kg} type="number" step=".01" min="0" max="1000" onChange={e=>setKg(e.target.value)}/></label>
          <label>Повторы<input value={reps} required type="number" min="1" max="1000" onChange={e=>setReps(e.target.value)}/></label>
          <button className="button primary" disabled={session.efforts.length>=500}><Check size={16}/>Подход готов</button>
        </form>
        {rest>0&&<div className="life-rest"><Clock3 size={16}/>Отдых после подхода · {clock(rest)}<button className="text-button" onClick={()=>record({...session,restUntil:0})}>Пропустить</button></div>}
        {session.efforts.length>0&&<details className="hub-disclosure"><summary>Подходы · {session.efforts.length}</summary><ul>
          {session.efforts.map((effort,i)=><li key={i}>{effort.name} · {effort.reps}{effort.kg!==null?' × '+effort.kg+' кг':' повторов'}</li>)}
        </ul></details>}
        {error&&<p className="field-error" role="alert">{error}</p>}
        <footer><button className="button secondary" onClick={()=>setDiscard(true)} disabled={busy}><Trash2 size={16}/>Отменить</button>
          <button className="button primary" onClick={()=>void finish()} disabled={busy}>{busy?'Сохраняю…':'Завершить и сохранить'}</button></footer>
      </div>}
  </Modal>
  {discard&&<ConfirmDialog title="Отменить тренировку?" description="Подходы из текущей тренировки будут удалены." onClose={()=>setDiscard(false)} onConfirm={async()=>{record(null);setOpen(false);}}/>}</>;
}
