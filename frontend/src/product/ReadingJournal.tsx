import { t } from '../lib/language';
import {useEffect,useRef,useState} from 'react';
import {BookOpen,Check,Pencil,Plus,Tag} from 'lucide-react';
import {api,errorMessage} from '../lib/api';
import {dayLabel,todayKey} from '../lib/dates';
import type {Notify,User} from '../lib/types';
import {LifeCard,LifeRings} from '../components/LifeCard';
import {OverviewWidgets,WidgetGroup} from '../components/OverviewWidgets';
import {Modal} from '../components/ui';
import {bodyFor,sections} from './schema';
import type {Row} from './schema';

export function DiaryComposer({user,day,onSaved,notify}:{user:User;day:string;onSaved:()=>void;notify:Notify}){
  const [text,setText]=useState(''),[title,setTitle]=useState(''),[mood,setMood]=useState<number|null>(null),[tags,setTags]=useState('');
  const [extras,setExtras]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const saving=useRef(false);
  async function save(){
    if(!text.trim()||saving.current)return;
    saving.current=true;setBusy(true);setError('');
    try{
      await api('/diary/entries',{method:'POST',body:{day,title:title.trim(),text:text.trim(),mood,tags:tags.split(',').map(t=>t.trim()).filter(Boolean)}});
      setText('');setTitle('');setMood(null);setTags('');setExtras(false);onSaved();notify(t("Запись сохранена"));
    }catch(e){setError(errorMessage(e));}
    finally{saving.current=false;setBusy(false);}
  }
  return <form className="life-diary-compose" onSubmit={e=>{e.preventDefault();void save();}}>
    <div className="life-diary-compose-head"><label><span className="sr-only">{t("Дата записи")}</span>{dayLabel(day,{weekday:'long',day:'numeric',month:'long'})}</label>
      <div className="life-mood" role="group" aria-label={t("Как прошёл день?")}><span>{t("Как прошёл день?")}</span>{[1,2,3,4,5].map(value=><button key={value} type="button" aria-pressed={mood===value} onClick={()=>setMood(mood===value?null:value)}>{value}</button>)}</div>
    </div>
    <label className="sr-only" htmlFor="life-diary-draft">{t("Запись в дневник")}</label>
    <textarea id="life-diary-draft" required maxLength={100000} value={text} onChange={e=>setText(e.target.value)} rows={3}
      placeholder={t("Что хочется сохранить сегодня?")} onKeyDown={e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();void save();}}}/>
    {extras&&<div className="life-diary-extras"><label>{t("Название")}<input maxLength={300} value={title} onChange={e=>setTitle(e.target.value)}/></label>
      <label>{t("Теги через запятую")}<input maxLength={390} value={tags} onChange={e=>setTags(e.target.value)}/></label></div>}
    {error&&<p className="field-error" role="alert">{error}</p>}
    <footer><button type="button" className="life-text-link" aria-expanded={extras} onClick={()=>setExtras(open=>!open)}><Tag size={16}/>{t("Название и теги")}</button>
      <button className="button primary" disabled={busy||!text.trim()}><Check size={15}/>{busy?t("Сохраняю…"):t("Сохранить")}</button></footer>
  </form>;
}

export function BookCover({book}:{book:Row}){
  const [failed,setFailed]=useState(false);
  useEffect(()=>setFailed(false),[book.cover_id]);
  return <span className="life-book-cover"><span><strong>{String(book.title)}</strong><small>{String(book.author??'')}</small></span>
    {!!book.cover_id&&!failed&&<img src={'https://covers.openlibrary.org/b/id/'+book.cover_id+'-M.jpg'} alt="" loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>}</span>;
}

export function ReadingPanel({user,rows,pro,notify,onOpen,onSaved}:{user:User;rows:Row[];pro:boolean;notify:Notify;onOpen:(row:Row)=>void;onSaved:()=>void}){
  const today=todayKey(user.timezone),year=today.slice(0,4);
  const storage='lifehub.reading.goal.'+user.id+'.'+year;
  const [book,setBook]=useState<Row|null>(null),[total,setTotal]=useState<number|null>(null);
  const [target,setTarget]=useState(()=>{try{return Number(localStorage.getItem(storage))||0;}catch{return 0;}});
  const [goal,setGoal]=useState<string|null>(null),[rating,setRating]=useState(0),[finish,setFinish]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [bookmark, setBookmark] = useState<{book: Row; page: string; notes: string; quote: string | null} | null>(null);
  useEffect(()=>{
    const controller=new AbortController();
    api<{items:Row[]}>('/books?status=reading&limit=1',{signal:controller.signal}).then(data=>{if(!controller.signal.aborted)setBook(data.items[0]??null);}).catch(()=>{});
    if(pro)api<{finished:number}>('/books/stats?year='+year,{signal:controller.signal}).then(data=>{if(!controller.signal.aborted)setTotal(data.finished);}).catch(()=>{});
    return ()=>controller.abort();
  },[rows,pro,year]);
  const pct=book?.total_pages?Math.min(100,Math.round(100*Number(book.current_page)/Number(book.total_pages))):null;
  async function save(next:Record<string,unknown>, source = book){
    if(!source||busy)return;
    setBusy(true);setError('');
    try{
      const body={...bodyFor(sections.books[0],{...source,...next}),version:source.version};
      const updated=await api<Row>('/books/'+source.id,{method:'PATCH',body});
      setBook(updated.status==='reading'?updated:null);setFinish(false);setBookmark(null);onSaved();notify(t("Прогресс чтения сохранён"));
    }catch(e){setError(errorMessage(e));}
    finally{setBusy(false);}
  }
  return <OverviewWidgets account={user.id} page="books" groups={[
    {id:'reading',title:t("Показатели"),widgets:pro?{current:t("Сейчас читаю"),goal:t("Цель")}: {current:t("Сейчас читаю")}},
  ]}><div className="life-reading-grid"><WidgetGroup name="reading">
    <LifeCard key="current" className="life-reading-current">
      {book?<><button className="life-book-cover-button" onClick={()=>onOpen(book)} aria-label={t("Открыть ")+book.title}><BookCover book={book}/></button>
        <div><span className="life-tag"><BookOpen size={13}/>{t("Читаю")}</span><h2>{String(book.title)}</h2><p>{String(book.author??'')}{book.total_pages?' · '+book.total_pages+t(" стр."):''}</p>
          {pct!==null&&<div className="life-reading-progress"><progress max={100} value={pct} aria-label={t("Прогресс чтения")}/><strong>{pct}%</strong></div>}
          <p>{String(book.current_page)}{book.total_pages?t(" из ")+book.total_pages:''} {t("стр.")}</p>
          <div className="life-reading-actions">{[10,25,50].map(delta=><button key={delta} onClick={()=>void save({current_page:Math.min(Number(book.total_pages??100000),Number(book.current_page)+delta)})} disabled={busy||pct===100}>+{delta} {t("стр.")}</button>)}
            <button onClick={()=>{setError('');setBookmark({book,page:String(book.current_page),notes:String(book.notes ?? ''),quote:null});}} disabled={busy}><Pencil size={14}/>{t("Закладка")}</button>
            <button className="finish" onClick={()=>{setRating(0);setFinish(true);}} disabled={busy}><Check size={15}/>{t("Дочитал")}</button></div>
          {error&&!finish&&!bookmark&&<p className="field-error" role="alert">{error}</p>}</div></>
        :<div><h2>{t("Сейчас читаю")}</h2><p>{t("Выберите книгу на полке и переведите её в «Читаю», чтобы отмечать страницы.")}</p></div>}
    </LifeCard>
    {pro&&<LifeCard key="goal" className="life-reading-goal"><h3>{t("Цель")} {year}</h3><LifeRings size={119} label={(total??0)+t(" прочитано")} values={[{value:target&&total!==null?total/target:0,color:'#245447'}]}/>
      <strong>{total??'—'} {target?t("из ")+target+t(" книг"):t("прочитано")}</strong>
      <button className="button secondary" onClick={()=>setGoal(target?String(target):'12')}>{target?t("Изменить цель"):t("Установить цель")}</button></LifeCard>}
    </WidgetGroup>
    {bookmark && <Modal title={t("Закладка")} description={String(bookmark.book.title)} onClose={() => !busy && setBookmark(null)}>
      <form onSubmit={event => {
        event.preventDefault();
        let notes = bookmark.notes;
        if (pro && bookmark.quote?.trim()) {
          const citation = t("Стр. {0} — «{1}»", Number(bookmark.page), bookmark.quote.trim());
          notes = notes ? notes + '\n\n' + citation : citation;
          if (notes.length > 50000) {
            setError(t("Заметки вместе с цитатой могут занимать до 50 000 символов."));
            return;
          }
        }
        void save({current_page: Number(bookmark.page), ...(pro ? {notes} : {})}, bookmark.book);
      }}>
        <div className="modal-body product-form">
          <label>{t("Прочитано страниц")}<input type="number" required min={0} max={Number(bookmark.book.total_pages ?? 100000)}
            step={1} value={bookmark.page} onChange={e => setBookmark({...bookmark, page: e.target.value})}/></label>
          {!!bookmark.book.total_pages && <input type="range" aria-label={t("Прогресс чтения")} min={0} max={Number(bookmark.book.total_pages)}
            value={bookmark.page || '0'} onChange={e => setBookmark({...bookmark, page: e.target.value})}/>}
          {pro && <label>{t("Заметки о книге")}<textarea rows={4} maxLength={50000} value={bookmark.notes}
            onChange={e => setBookmark({...bookmark, notes: e.target.value})}/></label>}
          {pro && (bookmark.quote === null
            ? <button className="button secondary" type="button" onClick={() => setBookmark({...bookmark, quote: ''})}>{t("Добавить цитату")}</button>
            : <label>{t("Цитата со страницы {0}", Number(bookmark.page))}<textarea rows={3} maxLength={50000}
                value={bookmark.quote} onChange={e => setBookmark({...bookmark, quote: e.target.value})}/></label>)}
          {error && <p className="field-error" role="alert">{error}</p>}
        </div>
        <footer className="modal-footer"><button className="button primary" disabled={busy}>{t("Сохранить")}</button></footer>
      </form>
    </Modal>}
    {goal!==null&&<Modal title={t("Цель на ")+year+t(" год")} onClose={()=>setGoal(null)}><form onSubmit={e=>{e.preventDefault();setTarget(Number(goal));try{localStorage.setItem(storage,goal);}catch{}setGoal(null);}}>
      <div className="modal-body product-form"><label>{t("Сколько книг хотите прочитать?")}<input required type="number" min={1} max={1000} value={goal} onChange={e=>setGoal(e.target.value)}/></label></div>
      <footer className="modal-footer"><button className="button primary">{t("Сохранить")}</button></footer></form></Modal>}
    {finish&&<Modal title={t("Книга прочитана")} description={t("Можно поставить оценку или сохранить сразу.")} onClose={()=>!busy&&setFinish(false)}>
      <div className="modal-body life-mood">{[1,2,3,4,5].map(value=><button key={value} type="button" aria-label={t("Оценка ")+value} aria-pressed={rating===value} onClick={()=>setRating(value)}>{value}</button>)}
        {error&&<p className="field-error" role="alert">{error}</p>}</div>
      <footer className="modal-footer"><button className="button primary" disabled={busy} onClick={()=>void save({status:'read',rating:rating||null,finished_on:today})}>{t("Сохранить")}</button></footer></Modal>}
  </div></OverviewWidgets>;
}
