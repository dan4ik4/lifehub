import {useCallback, useEffect, useRef, useState} from 'react';
import {ArrowUp, Check, LoaderCircle, MessageCircle, RefreshCw, Sparkles} from 'lucide-react';
import {api, errorMessage, isDemo} from '../lib/api';
import {dayLabel, todayKey} from '../lib/dates';
import type {User} from '../lib/types';
import {Modal} from './ui';
import {ChatMedia} from './ChatMedia';
import type {PhotoDraft} from './ChatMedia';

type Response = {message_id: string; message: string; confirmation: 'pending'|'applied'|'cancelled'|null; remaining_ai_requests: number; affected_resources: {type:string;id:string}[]};
type Entry = {id:string;created_at:string;message:string;photos?:string[];status:string;response:Response|null;error:string|null};
type History = {items:Entry[];next_before:string|null};
import {AssistantPreferences} from './AssistantPreferences';
import {useAssistantPreferences} from '../lib/assistantPreferences';

export function AssistantChat({user, path}: {user:User; path:string}) {
  const [preferencesOpen,setPreferencesOpen]=useState(false);
  const [open,setOpen]=useState(false), [entries,setEntries]=useState<Entry[]>([]), [cursor,setCursor]=useState<string|null>(null);
  const [message,setMessage]=useState(''), [busy,setBusy]=useState(false), [loading,setLoading]=useState(false), [error,setError]=useState('');
  const {preferences,loading:preferencesLoading,save:savePreferences}=useAssistantPreferences(user.id);
  const consent=preferences.messages, mediaConsent=preferences.media;
  const [selectedDay,setSelectedDay]=useState(todayKey(user.timezone));
  const [retry,setRetry]=useState<{text:string;key:string;day:string;photo:PhotoDraft|null}|null>(null);
  const [photo,setPhoto]=useState<PhotoDraft|null>(null),[mediaActive,setMediaActive]=useState(false);

  const draft=useRef(message);
  draft.current=message;
  async function transcribe(audio:Blob,signal:AbortSignal){
    const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('Не удалось прочитать запись.'));reader.readAsDataURL(audio);});
    try{
      const result=await api<{text:string}>('/ai/transcribe',{method:'POST',signal,body:{data,mime:audio.type,media_allowed:true}});
      if(!alive.current||signal.aborted)return;
      const combined=[draft.current.trim(),result.text].filter(Boolean).join(' ');
      if(combined.length>4000)throw new Error('В сообщении слишком много текста. Сначала отправьте текущий текст.');
      signal.throwIfAborted();
      void send(false,combined);
    }catch(e){throw new Error(errorMessage(e));}
  }
  function close(){setOpen(false);setMediaActive(false);}

  const historyRequest=useRef(0);
  const lock=useRef(false), alive=useRef(true), log=useRef<HTMLDivElement>(null), input=useRef<HTMLTextAreaElement>(null);
  const allowed=user.plan==='pro'||(user.plan==='trial'&&!!user.trial_ends&&Date.parse(user.trial_ends)>Date.now())||user.free_modules.includes('planning');
  useEffect(()=>{alive.current=true; const day=(e:Event)=>setSelectedDay((e as CustomEvent<string>).detail); window.addEventListener('lifehub:chat-day',day); return()=>{alive.current=false;window.removeEventListener('lifehub:chat-day',day);};},[]);
  const load=useCallback(async (before?:string)=>{
    const revision=++historyRequest.current;setLoading(true);
    try {const result=await api<History>('/ai/chat/history'+(before?'?before='+encodeURIComponent(before):'')); if(!alive.current||revision!==historyRequest.current)return;
      setEntries(old=>before?[...result.items,...old.filter(x=>!result.items.some(y=>y.id===x.id))]:result.items);setCursor(result.next_before);
    } catch(e){if(alive.current&&revision===historyRequest.current)setError(errorMessage(e));} finally {if(alive.current&&revision===historyRequest.current)setLoading(false);}
  },[]);
  useEffect(()=>{if(open&&allowed&&!isDemo()){setError('');void load();}},[open,allowed,load]);
  useEffect(()=>{
    if(!open||busy||!entries.some(e=>e.status==='processing'&&Date.now()-Date.parse(e.created_at)<120000))return;
    const timer=window.setTimeout(()=>void load(),3000);return()=>window.clearTimeout(timer);
  },[open,busy,entries,load]);
  useEffect(()=>{if(open)log.current?.scrollTo({top:log.current.scrollHeight,behavior:'instant'});},[open,entries.at(-1)?.id,entries.at(-1)?.response?.message,busy]);
  async function send(recover=false,voiceText?:string){
    const text=recover?retry?.text:(voiceText||message.trim()||(photo?'Что на этой фотографии? Помоги разобраться с планами.':''));if(!text||lock.current||(mediaActive&&!voiceText)||!consent||!allowed)return;
    lock.current=true;setBusy(true);setError('');
    const request=recover&&retry?retry:{text,key:crypto.randomUUID(),day:path.startsWith('/planning')?selectedDay:todayKey(user.timezone),photo};
    setRetry(request); if(!recover){setMessage('');setPhoto(null);}
    try {
      await api<Response>('/ai/chat',{method:'POST',headers:{'Idempotency-Key':request.key},body:{context:'planning',mode:'chat',message:request.text,selected_day:request.day,planning_context_allowed:true,media_allowed:mediaConsent,photos:request.photo?[{data:request.photo.data}]:[]}});
      if(!alive.current)return;
      setRetry(null);window.dispatchEvent(new Event('lifehub:data-changed'));await load();
    } catch(e){if(alive.current){setError(errorMessage(e));await load();}}
    finally {lock.current=false;if(alive.current){setBusy(false);input.current?.focus();}}
  }
  async function decide(entry:Entry,apply:boolean){
    if(lock.current)return;lock.current=true;setBusy(true);setError('');
    try {const response=await api<Response>(`/ai/chat/${entry.id}/confirm`,{method:'POST',body:{apply}});if(!alive.current)return;
      setEntries(old=>old.map(e=>e.id===entry.id?{...e,response}:e));if(apply)window.dispatchEvent(new Event('lifehub:data-changed'));
    }catch(e){if(alive.current)setError(errorMessage(e));}finally{lock.current=false;if(alive.current)setBusy(false);}
  }
  const contextDay=path.startsWith('/planning')?selectedDay:todayKey(user.timezone);
  return <>
    <button className={`assistant-launcher ${path.startsWith("/planning") ? "with-bottom-nav" : ""}`} aria-label="Открыть чат с помощником" aria-haspopup="dialog" aria-expanded={open} onClick={()=>setOpen(true)}><MessageCircle size={22}/><span>Помощник</span>{busy&&<i/>}</button>
    {open&&<Modal title="Ваш помощник" description="Один разговор. Все ваши планы." onClose={close} className="assistant-modal">
      <div className="chat-context"><span className="live-dot"/>Life Hub · {dayLabel(contextDay,{day:'numeric',month:'short'})}<span>История сохранена</span></div>
      <div hidden={preferencesOpen} ref={log} className="chat-log" role="log" aria-label="История переписки" aria-live="polite" aria-relevant="additions text">
        {cursor&&<button className="chat-load" disabled={loading||busy} onClick={()=>void load(cursor)}>Показать предыдущие сообщения</button>}
        {loading&&entries.length===0&&<p className="chat-loading"><LoaderCircle className="spinner" size={18}/>Загружаю переписку…</p>}
        {entries.length===0&&!loading&&<div className="chat-welcome"><span className="chat-orb"><Sparkles size={28}/></span><h3>Давайте разберёмся<br/>с вашими планами.</h3><p>Спросите о расписании, добавьте задачу или перенесите встречу. Можно уточнять — разговор сохранится.</p>{allowed&&!isDemo()&&<div className="chat-suggestions">{['Что у меня сегодня?','Помоги спланировать день','Что запланировано на завтра?'].map(t=><button key={t} onClick={()=>{setMessage(t);input.current?.focus();}}>{t}</button>)}</div>}</div>}
        {entries.map(entry=><div className="chat-turn" key={entry.id}><div className="chat-bubble user-bubble"><span className="chat-speaker">Вы</span><p>{entry.message}</p>{entry.photos?.map((src,i)=><img key={i} className="chat-history-photo" src={src} alt="Прикреплённая фотография" loading="lazy"/>)}</div><div className="chat-bubble assistant-bubble"><span className="chat-speaker"><Sparkles size={13}/>Life Hub</span><p>{entry.response?.message||entry.error||(Date.now()-Date.parse(entry.created_at)>120000?'Ответ не завершён. Можно отправить запрос заново.':'Готовлю ответ…')}</p>{entry.response?.confirmation==='pending'&&<div className="chat-confirm"><small>Изменения ещё не применены. Подтвердите действие.</small><div><button className="button primary" disabled={busy} onClick={()=>void decide(entry,true)}><Check size={15}/>Подтвердить</button><button className="button secondary" disabled={busy} onClick={()=>void decide(entry,false)}>Отмена</button></div></div>}<time>{new Date(entry.created_at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit',timeZone:user.timezone})}</time></div></div>)}
        {busy&&retry&&!entries.some(e=>e.message===retry.text)&&<div className="chat-bubble user-bubble sending-bubble"><span className="chat-speaker">Вы</span><p>{retry.text}</p>{retry.photo&&<img className="chat-history-photo" src={retry.photo.data} alt="Отправляемая фотография"/>}</div>}
        {busy&&<div className="chat-thinking" role="status"><span/><span/><span/>Помощник работает</div>}
      </div>
      <div className={`chat-bottom ${preferencesOpen?"editing-preferences":""}`}>
        {preferencesOpen&&<div className="chat-permission"><AssistantPreferences userId={user.id}/><button type="button" className="text-button" onClick={()=>setPreferencesOpen(false)}>Готово</button></div>}
        {!preferencesOpen&&<>
        {error&&<div className="chat-error" role="alert"><p>{error}</p>{retry&&<div><button disabled={busy} onClick={()=>void send(true)}><RefreshCw size={14}/>Проверить результат</button><button disabled={busy} onClick={()=>{setMessage(retry.text);setPhoto(retry.photo);setRetry(null);setError('');}}>Вернуть сообщение</button></div>}</div>}
        {isDemo()?<p className="chat-permission">Переписка с ИИ доступна после входа в аккаунт.</p>:!allowed?<p className="chat-permission">Для помощника нужен доступ к модулю «Планирование».</p>:!consent?<div className="chat-permission"><p>OpenAI получит сообщения, последние 20 сообщений диалога, задачи, списки и события календаря. Разрешение сохранится в аккаунте. Доступ к другим модулям можно включить в настройках.</p><button className="button primary" disabled={preferencesLoading} onClick={()=>{void savePreferences({...preferences,messages:true}).catch(e=>setError(errorMessage(e)));}}>Разрешить и начать</button></div>:<>
          {mediaConsent?<ChatMedia photo={photo} onPhoto={setPhoto} onVoice={transcribe} onError={setError} onActivity={setMediaActive} disabled={busy}/>:<div className="chat-media-permission"><p>Фото и голос обрабатывает OpenAI. Фото сохраняются в истории и доступны для последующих вопросов; аудиозапись не сохраняется в Life Hub.</p><button type="button" disabled={preferencesLoading} onClick={()=>{void savePreferences({...preferences,media:true}).catch(e=>setError(errorMessage(e)));}}>Включить фото и голос</button></div>}
          <form className="chat-compose" hidden={mediaActive} onSubmit={e=>{e.preventDefault();void send();}}><label className="sr-only" htmlFor="assistant-message">Сообщение помощнику</label><textarea id="assistant-message" ref={input} rows={2} maxLength={4000} placeholder="Напишите, чем помочь…" value={message} disabled={busy||mediaActive} onChange={e=>setMessage(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing&&window.matchMedia('(pointer: fine)').matches){e.preventDefault();void send();}}}/><button aria-label="Отправить сообщение" className="chat-send" disabled={busy||mediaActive||(!message.trim()&&!photo)}>{busy?<LoaderCircle className="spinner" size={20}/>:<ArrowUp size={21}/>}</button></form>
          <div className="chat-footnote"><span>{preferences.modules?'Помогаю во всех доступных модулях.':'Планирование · другие модули можно подключить в настройках.'}</span><button type="button" onClick={()=>setPreferencesOpen(v=>!v)}>Настройки доступа</button></div>
        </>}
        </>}
      </div>
    </Modal>}
  </>;
}
