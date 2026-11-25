import {useEffect,useMemo,useState} from 'react';
import {Navigation} from '../../components/Navigation';
import {Modal} from '../../components/ui';
import {api,errorMessage} from '../../lib/api';
import {shiftDay} from '../../lib/dates';
import {t} from '../../lib/language';
import type {Notify,User} from '../../lib/types';
import {openAssistant} from '../../lib/workspace';
import {isPro} from '../recordPresentation';
import {ArchiveView,archiveMonths} from './ArchiveView';
import {LinksView,PairDots} from './LinksView';
import {ConsentDialog,resultsConsentChanged,resultsPrefs} from './ResultsConsent';
import {WeekView} from './WeekView';
import {GlyphTile,LoadState,ResultsIcon,monthLabel,pairLabel,resultsRoot,summaryText,useResults,weekLabel} from './shared';
import type {Archive,Consent,PairData,Week} from './shared';
import './results.css';

type View='week'|'links'|'archive';
const tabs: [View,string][] = [['week',t('Неделя')],['links',t('Связи')],['archive',t('Архив')]];
const toView=(view:View)=>resultsRoot+(view==='week'?'':'/'+view);
const scrollTo=(id:string)=>document.getElementById(id)?.scrollIntoView({block:'start'});
function isDay(value:string|null):value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value+'T12:00:00Z'));
}

export function Results({user,path,search,navigate,notify,onSettings}:{
  user:User;path:string;search:string;navigate:(to:string)=>void;notify:Notify;onSettings:()=>void;
}) {
  const suffix = path.split('/')[3];
  const view:View = ['links','comparisons','review'].includes(suffix) ? 'links' : suffix==='archive' ? 'archive' : 'week';
  const query = useMemo(()=>new URLSearchParams(search),[search]);
  const start = query.get('start');
  const span = query.get('days')==='14'?14:28;
  const mode = query.get('kind')==='month'?'month':'week';
  const currency = /^[A-Z]{3}$/.test(query.get('currency')??'') ? query.get('currency')! : 'PLN';
  const modules = query.has('modules') ? query.getAll('modules').filter(value=>['planning','goals_habits','health','finance','books'].includes(value)) : null;
  const pairQuery = new URLSearchParams({days:String(span),currency});
  modules?.forEach(key=>pairQuery.append('modules',key));
  const pairs = useResults<PairData>('/insights/pairs?'+pairQuery);
  const weeks = useResults<Week>(view==='week'?'/insights/week'+(isDay(start)?'?start='+start:''):null);
  const archive = useResults<Archive>(view==='archive'?'/insights/archive?'+new URLSearchParams({kind:mode,
    ...(/^\d{4}$/.test(query.get('year')??'')?{year:query.get('year')!}:{})}):null);
  const preferences=useResults<Consent>(resultsPrefs);
  const [consent,setConsent] = useState<Consent>();
  const [consentOpen, setConsentOpen] = useState(false);
  const [consentSeen, setConsentSeen] = useState(false);
  const [share,setShare] = useState(false);
  const [error,setError] = useState('');
  const [moving,setMoving] = useState(false);
  const pro=isPro(user), prefs=consent??preferences.data, ai=pro&&!!prefs?.ai_enabled;
  useEffect(()=>{
    if(pro&&prefs&&!prefs.decided&&!consentSeen){setConsentOpen(true);setConsentSeen(true);}
  },[pro,prefs,consentSeen]);
  useEffect(()=>{
    if(!pairs.data || view!=='links')return;
    const target=query.get('pair');
    if(target)scrollTo('pair-'+target);
  },[pairs.data,query,view]);
  useEffect(()=>{
    const update=()=>{setConsent(undefined);preferences.reload();weeks.reload();archive.reload();};
    window.addEventListener(resultsConsentChanged,update);
    return()=>window.removeEventListener(resultsConsentChanged,update);
  },[preferences.reload,weeks.reload,archive.reload]);
  const update = (changes:Record<string,string|null>)=>{
    const next=new URLSearchParams(query);
    Object.entries(changes).forEach(([key,value])=>{if(value===null)next.delete(key);else next.set(key,value);});
    navigate(toView(view)+(next.size?'?'+next:''));
  };
  const onFilter=(selected:string[]|null,code:string)=>{
    const next=new URLSearchParams({days:String(span),currency:code});
    selected?.forEach(item=>next.append('modules',item));
    navigate(toView('links')+'?'+next);
  };
  const onHidden=async (pair:string,hidden:boolean)=>{
    setMoving(true);setError('');
    try{await api('/insights/pairs/visibility',{method:'PATCH',body:{pair,hidden}});pairs.reload();}
    catch(cause){setError(errorMessage(cause));}
    finally{setMoving(false);}
  };
  const week=weeks.data, pairData=pairs.data, history=archive.data;
  const found=pairData?.found??[], collecting=pairData?.collecting??[], newCount=found.filter(pair=>pair.new).length;
  const shareText=week?weekLabel(week.start,week.end)+'\n'+summaryText(week)+(week.score!==null?'\n'+t('Оценка недели · {0}',week.score):''):'';
  const context=<div className="results-context">
    {view==='week'&&week&&<>
      <h2>{t('Недели')}</h2>
      {week.recent.map((item,index)=><button type="button" className="results-context-week" key={item.start}
        aria-current={week.start===item.start?'date':undefined} onClick={()=>navigate(resultsRoot+'?start='+item.start)}>
        <span><strong>{weekLabel(item.start,shiftDay(item.start,6))}</strong>
          <small>{index===0&&week.latest===week.start&&week.built_at?t('готово в вс, 20:00'):
            item.habits!==null?t('{0}% привычек',item.habits):t('Итоги недели')}</small></span>
        {index===0&&<i aria-hidden="true"/>}
      </button>)}
      <button className="results-text" onClick={()=>navigate(toView('archive'))}>{t('Все недели')}<ResultsIcon name="arrow" size={14}/></button>
    </>}
    {view==='links'&&pairData&&<>
      {found.length>0&&<><h2>{t('Найдено')}</h2>{found.map(pair=><button key={pair.id} type="button" onClick={()=>scrollTo('pair-'+pair.id)}>
        <PairDots x={pair.x} y={pair.y}/><span>{pairLabel(pair)}</span>{pair.new&&<small>{t('новое')}</small>}
      </button>)}</>}
      {collecting.length>0&&<><h2>{t('Копят данные')}</h2>{collecting.map(pair=><button key={pair.id} type="button"
        onClick={()=>scrollTo('pair-'+pair.id)}><PairDots x={pair.x} y={pair.y}/><span>{pairLabel(pair)}</span>
        <small>{Math.min(8,pair.n_days)}/8</small></button>)}</>}
    </>}
    {view==='archive'&&history&&<><h2>{history.year}</h2>
      {[...archiveMonths(history.items)].map(([month,entries])=><button type="button" key={month}
        onClick={()=>scrollTo('archive-'+(mode==='week'?month:entries[0].start))}><i aria-hidden="true"/><span>{monthLabel(month)}</span>
        {mode==='week'&&<small>{t('Недель: {0}',entries.length)}</small>}</button>)}
    </>}
    <button className="results-consent-chip" type="button" onClick={()=>setConsentOpen(true)}>
      <GlyphTile icon="sparkles" tone={ai?'dark':'green'}/><span><strong>{ai?t('ИИ-итоги включены'):t('ИИ-итоги выключены')}</strong>
        <small>{t('Что передаётся')}</small></span>
    </button>
  </div>;
  return <div className="app-layout results-layout" data-results-view={view}>
    <Navigation user={user} path={toView(view)} navigate={navigate} onSettings={onSettings} context={context} resultsNewCount={newCount}/>
    <div className="app-main product-layout">
      <a className="skip-link" href="#results-main">{t('Перейти к содержимому')}</a>
      <main className="results-main" id="results-main">
        <nav className="results-tab-nav" aria-label={t('Разделы итогов')}>{tabs.map(([key,label])=>
          <button type="button" key={key} aria-current={view===key?'page':undefined} onClick={()=>navigate(toView(key))}>{label}</button>
        )}</nav>
        {view==='week'&&(week?<WeekView week={week} user={user} pro={pro} ai={ai} navigate={navigate}
          onConsent={()=>setConsentOpen(true)} onShare={()=>setShare(true)}/>:<LoadState error={weeks.error} reload={weeks.reload}/>)}
        {view==='links'&&<><LinksView data={pairData} span={span} modules={modules} currency={currency} timeZone={user.timezone}
          onSpan={value=>update({days:String(value),pair:null})} onFilter={onFilter} onHidden={onHidden} navigate={navigate}
          error={error} waiting={moving}/>{!pairData&&<LoadState error={pairs.error} reload={pairs.reload}/>}</>}
        {view==='archive'&&(history?<ArchiveView key={mode+history.year} data={history} mode={mode} user={user} pro={pro} ai={ai}
          onMode={kind=>update({kind:kind==='week'?null:kind})} onYear={year=>update({year:String(year)})}
          onConsent={()=>setConsentOpen(true)} navigate={navigate}/>:<LoadState error={archive.error} reload={archive.reload}/>)}
        <div className="results-end"><button type="button" className="results-consent-mobile results-text" onClick={()=>setConsentOpen(true)}>
          <ResultsIcon name="sparkles"/>{t('Что передаётся')}</button>
          <button type="button" className="results-assistant" onClick={()=>openAssistant()}><ResultsIcon name="sparkles" size={20}/>
            {t('Спросить помощника')}<kbd>⌘J</kbd></button></div>
      </main>
    </div>
    {consentOpen&&<ConsentDialog enabled={ai} pro={pro} close={()=>setConsentOpen(false)} onSave={setConsent}/>}
    {share&&<Modal title={t('Поделиться итогами')} onClose={()=>setShare(false)} className="results-dialog">
      <div className="modal-body"><textarea readOnly aria-label={t('Текст итогов')} value={shareText} rows={5}/></div>
      <footer className="modal-footer"><button className="results-button results-primary" onClick={()=>void navigator.clipboard.writeText(shareText)
        .then(()=>{notify(t('Скопировано'));setShare(false);}).catch(()=>notify(t('Не удалось скопировать текст'),'error'))}>
        <ResultsIcon name="send"/>{t('Скопировать текст')}</button></footer>
    </Modal>}
  </div>;
}

export function ResultsOnHome({navigate}:{navigate:(to:string)=>void}) {
  const {data:week}=useResults<Week>('/insights/week');
  const {data:pairs}=useResults<PairData>('/insights/pairs');
  const recent=pairs?.found.find(pair=>pair.new);
  return <section className="results-home-entry" aria-label={t('Итоги')}>
    <button type="button" className="results-button" onClick={()=>navigate(resultsRoot)}>
      <ResultsIcon name="sun"/>{week?.built_at&&week.score!==null?t('Неделя готова — {0}',week.score):t('Итоги недели')}
      <ResultsIcon name="arrow" size={14}/></button>
    {recent&&<button type="button" className="results-button" onClick={()=>navigate(resultsRoot+'/links?pair='+encodeURIComponent(recent.id))}>
      <ResultsIcon name="sparkles"/>{t('Новая связь: {0}',pairLabel(recent))}<ResultsIcon name="arrow" size={14}/></button>}
  </section>;
}
