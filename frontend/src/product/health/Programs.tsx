import {useState} from 'react';
import {LifeCard} from '../../components/LifeCard';
import {ConfirmDialog} from '../../components/ui';
import {errorMessage} from '../../lib/api';
import {t} from '../../lib/language';
import type {User} from '../../lib/types';
import {formatAmount} from '../format';
import {RecordEditor} from '../RecordEditor';
import {sections} from '../schema';
import type {Row} from '../schema';
import {openWorkout} from '../WorkoutSession';
import {deleteHealth,HealthButton,HealthState,HealthTile,HealthTitle,HIcon,IconAction,saveHealth,shortHealthDay,summaryPath,useHealthData} from './shared';
import type {HealthSummary,Program,Workout} from './shared';

const schema=sections.health.find(section=>section.key==='programs')!;
export function ProBadge(){return <span className="health-pro"><HIcon name="crown" size={12}/>Pro</span>;}
export function ProPreview({title,children,onUpgrade}:{title:string;children:string;onUpgrade:()=>void}) {
  return <LifeCard className="health-pro-preview"><ProBadge/><h2>{title}</h2><p>{children}</p>
    <HealthButton primary onClick={onUpgrade}>{t('Посмотреть Pro')}</HealthButton></LifeCard>;
}
const exerciseCount=(count:number)=>t('Упражнений: {0}',count);
function programRuns(program:Program,sessions:Workout[]) {
  return sessions.filter(session=>session.program_id?session.program_id===program.id:session.title===program.title)
    .sort((a,b)=>b.day.localeCompare(a.day)||(b.created_at??'').localeCompare(a.created_at??''));
}
function start(program:Program){openWorkout(program as unknown as Row,true);}
const volume=(workout:Workout)=>workout.efforts.reduce((sum,effort)=>sum+effort.reps*(effort.kg??0),0);

export function ProgramsScreen({user,today,pro,id,onUpgrade,programs}:{user:User;today:string;pro:boolean;id?:string;onUpgrade:()=>void;
  programs:ReturnType<typeof useHealthData<{items:Program[]}>>}) {
  const [selected,setSelected]=useState(id??''),[editing,setEditing]=useState<Program|null>();
  const [menu,setMenu]=useState<string>(),[removing,setRemoving]=useState<Program>();
  const [from,setFrom]=useState<number>(),[moving,setMoving]=useState(false),[failure,setFailure]=useState('');
  const workouts=useHealthData<HealthSummary>(pro?summaryPath(today,90):null);
  const direct=useHealthData<Program>(pro&&id?'/health/programs/'+id:null);
  const listed=programs.data?.items??[];
  const list=direct.data&&!listed.some(row=>row.id===direct.data?.id)?[direct.data,...listed]:listed;
  const program=list.find(row=>row.id===selected)??list[0];
  const sessions=workouts.data?.workouts??[];
  const runs=program?programRuns(program,sessions):[];
  const current=runs[0],previous=runs[1];
  const order=async(index:number,target:number)=>{
    if(!program||moving||index===target||target<0||target>=program.exercises.length)return;
    const items=[...program.exercises];
    items.splice(target,0,...items.splice(index,1));
    setFailure('');setMoving(true);
    try{await saveHealth('/health/programs',{title:program.title,exercises:items},program);}
    catch(cause){setFailure(errorMessage(cause));}
    finally{setMoving(false);setFrom(undefined);}
  };
  return <>
    <HealthTitle title={t('Программы')} subtitle={t('Шаблоны тренировок — запускайте в один тап')}>
      <ProBadge/><HealthButton icon="plus" primary onClick={()=>pro?setEditing(null):onUpgrade()}>{t('Новая программа')}</HealthButton>
    </HealthTitle>
    {!pro?<ProPreview title={t('Шаблоны тренировок')} onUpgrade={onUpgrade}>{t('Соберите упражнения, подходы и повторы в программу и открывайте её перед тренировкой.')}</ProPreview>:
      !programs.data?<HealthState error={programs.error} reload={programs.reload}/>:
      <div className="health-program-grid">
        <div className="health-program-stack">
          {list.map(row=>{
            const last=programRuns(row,sessions)[0];
            return <LifeCard key={row.id} className={'health-program-summary'+(row.id===program?.id?' is-selected':'')}>
              <div className="health-card-head"><button type="button" className="health-program-choice" aria-pressed={row.id===program?.id}
                onClick={()=>setSelected(row.id)}><HealthTile icon="activity"/><span><strong>{row.title}</strong>
                <small>{exerciseCount(row.exercises.length)}{last?' · '+last.minutes+' '+t('мин'):''}</small></span></button>
                <IconAction icon="more" label={t('Действия с программой {0}',row.title)} onClick={()=>setMenu(menu===row.id?undefined:row.id)}/>
              </div>
              {menu===row.id&&<div className="health-program-menu"><HealthButton icon="pencil" onClick={()=>{setMenu(undefined);setEditing(row);}}>{t('Изменить')}</HealthButton>
                <HealthButton icon="trash" onClick={()=>{setMenu(undefined);setRemoving(row);}}>{t('Удалить')}</HealthButton></div>}
              <ul>{row.exercises.slice(0,3).map((exercise,index)=><li key={index}><span>{exercise.name}</span><b>{exercise.sets}×{exercise.reps}</b></li>)}</ul>
              <footer><span>{last?t('Последний раз {0}',shortHealthDay(last.day)):t('Ещё не выполнялась')}</span>
                <HealthButton icon="zap" primary={row.id===program?.id} onClick={()=>start(row)}>{t('Начать')}</HealthButton></footer>
            </LifeCard>;
          })}
          <button type="button" className="health-button health-dashed" onClick={()=>setEditing(null)}><HIcon name="plus"/>{t('Новая программа')}</button>
        </div>
        {program?<LifeCard className="health-program-detail">
          <div className="health-card-head"><div><div className="health-kicker">{t('Программа')}</div><h2>{program.title}</h2>
            <p>{exerciseCount(program.exercises.length)}{current?' · '+current.minutes+' '+t('мин'):''}</p></div>
            <div className="health-program-actions"><HealthButton icon="pencil" onClick={()=>setEditing(program)}>{t('Изменить')}</HealthButton>
              <HealthButton icon="zap" primary onClick={()=>start(program)}>{t('Начать тренировку')}</HealthButton></div>
          </div>
          <div className="health-program-facts">
            {[[program.exercises.reduce((sum,item)=>sum+item.sets,0),t('подходов')],
              [program.exercises.reduce((sum,item)=>sum+item.sets*item.reps,0),t('повторений')],
              [current?formatAmount(volume(current)):'—',t('кг тоннаж')],
              [runs.length,t('раз за 90 дней')]].map(([value,label])=><div key={label}><b>{value}</b><small>{label}</small></div>)}
          </div>
          {failure&&<p className="health-error" role="alert">{failure}</p>}
          <ul className="health-exercises">
            {program.exercises.map((exercise,index)=>{
              const last=current?.efforts.filter(row=>row.name===exercise.name).at(-1)?.kg;
              const before=previous?.efforts.filter(row=>row.name===exercise.name).at(-1)?.kg;
              const weight=last??exercise.kg;
              return <li key={index} draggable={!moving} onDragStart={e=>{e.dataTransfer.setData('text/plain',String(index));setFrom(index);}}
                onDragEnd={()=>setFrom(undefined)} onDragOver={e=>{if(from!==undefined)e.preventDefault();}}
                onDrop={e=>{e.preventDefault();if(from!==undefined)void order(from,index);}}>
                <button type="button" className="health-icon-action health-grip" disabled={moving}
                  title={t('Перетащите или используйте стрелки вверх и вниз')} aria-label={t('Изменить порядок: {0}',exercise.name)}
                  onKeyDown={e=>{if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();void order(index,index+(e.key==='ArrowUp'?-1:1));}}}
                  onClick={()=>{if(program.exercises.length>1)void order(index,index===0?1:index-1);}}><HIcon name="grip"/></button>
                <span className="health-exercise-index">{index+1}</span>
                <div><strong>{exercise.name}</strong><div className="health-chip-row">
                  {Array.from({length:Math.min(6,exercise.sets)},(_,i)=><span key={i} className="health-chip">{exercise.reps}</span>)}
                  {exercise.sets>6&&<span className="health-chip">+{exercise.sets-6}</span>}</div></div>
                <div><strong>{weight==null?'—':formatAmount(weight)+' '+t('кг')}</strong>
                  {before!=null&&<small>{t('было {0}',formatAmount(before))}</small>}</div>
              </li>;
            })}
          </ul>
          {current&&previous&&<div className="health-callout"><HIcon name="trend"/><span>{t('К прошлой тренировке: {0} кг тоннажа',
            (volume(current)-volume(previous)>=0?'+':'')+formatAmount(volume(current)-volume(previous)))}</span></div>}
        </LifeCard>:<LifeCard><h2>{t('Ваши программы')}</h2><p>{t('Добавьте упражнения, чтобы сохранить первую программу.')}</p></LifeCard>}
      </div>}
    {direct.error&&<HealthState error={direct.error} reload={direct.reload}/>}
    {editing!==undefined&&<RecordEditor key={editing?.id??'new'} section={schema} initial={editing??{}} user={user} onClose={()=>setEditing(undefined)}
      onSave={async body=>{await saveHealth('/health/programs',body,editing??undefined);setEditing(undefined);}}/>}
    {removing&&<ConfirmDialog title={t('Удалить программу?')} description={t('Записанные тренировки сохранятся.')} onClose={()=>setRemoving(undefined)}
      onConfirm={async()=>{await deleteHealth('/health/programs',removing);setRemoving(undefined);}}/>}
  </>;
}
