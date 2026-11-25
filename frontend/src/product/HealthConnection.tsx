import { t, locale } from '../lib/language';
import {useCallback,useEffect,useState} from 'react';
import {Footprints,Moon,RefreshCw,Smartphone} from 'lucide-react';
import {api,errorMessage} from '../lib/api';
import {connectHealth,forgetHealth,nativeHealth,providerName,savedHealth,syncHealth} from '../lib/healthDevice';
import type {DeviceStatus,Metric} from '../lib/healthDevice';
import type {User} from '../lib/types';
import {dayLabel} from '../lib/dates';
import {ConfirmDialog} from '../components/ui';
import './health-device.css';
export function HealthConnection({user}:{user:User}){
 const [data,setData]=useState<DeviceStatus|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [erasing,setErasing]=useState(false);
 const [metrics,setMetrics]=useState<Metric[]>(['steps','sleep']),[consent,setConsent]=useState(false);
 const load=useCallback(async()=>{try{setData(await api<DeviceStatus>('/health/device'));}catch(e){setError(errorMessage(e));}},[]);
 useEffect(()=>{void load();const refresh=()=>void load();window.addEventListener('lifehub:data-changed',refresh);return()=>window.removeEventListener('lifehub:data-changed',refresh);},[load]);
 async function run(connect=false){setBusy(true);setError('');try{if(connect)await connectHealth(user,metrics);await syncHealth(user);await load();}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
 async function disconnect(){setBusy(true);setError('');try{await api('/health/device',{method:'DELETE'});forgetHealth(user.id);await load();window.dispatchEvent(new Event('lifehub:data-changed'));}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
 const connected=data?.connection?.enabled,local=!!savedHealth(user.id),latest=data?.days.at(-1);
 return <section id="health-device" className="health-device-card"><header><span className="device-icon"><Smartphone size={23}/></span><div><h2>{t("Здоровье с телефона")}</h2><p>{t("Шаги и сон из Apple Health или Health Connect")}</p></div>{busy&&<RefreshCw size={18} className="spinner"/>}</header>
 {error&&<p className="device-error" role="alert">{error}</p>}
 {data?.connection&&<p className="device-status">{providerName(data.connection.provider)} · {connected?t("Синхронизация включена"):t("Синхронизация отключена")}{data.connection.last_synced_at&&<> {t("· Обновлено")} {new Date(data.connection.last_synced_at).toLocaleString(locale)}</>}</p>}
 {!nativeHealth()?<p className="device-info">{t("Подключите здоровье в установленном приложении Life Hub на iPhone или Android. В браузере можно смотреть уже синхронизированные данные.")}</p>:!connected||!local?<><div className="device-permissions">{(['steps','sleep'] as Metric[]).map(m=><label key={m}><input type="checkbox" checked={metrics.includes(m)} disabled={busy} onChange={e=>setMetrics(old=>e.target.checked?[...old,m]:old.filter(x=>x!==m))}/>{m==='steps'?t("Шаги"):t("Сон")}</label>)}</div><label className="device-consent"><input type="checkbox" checked={consent} disabled={busy} onChange={e=>setConsent(e.target.checked)}/>{t("Разрешаю чтение выбранных показателей и сохранение в моём аккаунте Life Hub. Данные не передаются в ИИ.")}</label><button className="button primary" disabled={busy||!consent||!metrics.length} onClick={()=>void run(true)}>{t("Подключить здоровье")}</button></>:<button className="button primary" disabled={busy} onClick={()=>void run()}><RefreshCw size={16}/>{t("Обновить с телефона")}</button>}
 {connected&&<button className="button secondary" disabled={busy} onClick={()=>void disconnect()}>{t("Отключить синхронизацию")}</button>}
 {!!data?.days.length&&<><div className="device-metrics"><div><Footprints size={19}/><strong>{latest?.steps?.toLocaleString(locale)??'—'}</strong><span>{t("шагов ·")} {latest&&dayLabel(latest.day,{day:'numeric',month:'short'})}</span></div><div><Moon size={19}/><strong>{latest?.sleep_seconds==null?'—':(latest.sleep_seconds/3600).toLocaleString(locale,{maximumFractionDigits:1})+t(" ч")}</strong><span>{t("сна за сутки")}</span></div></div><div className="device-week">{data.days.map(d=><div key={d.day}><span>{dayLabel(d.day,{weekday:'short'})}</span><i style={{height:Math.max(3,Math.min(64,(d.steps??0)/150))}}/><strong>{d.steps?.toLocaleString(locale)??'—'}</strong></div>)}</div></>}
 {data?.connection&&<button className="button secondary" disabled={busy} onClick={()=>setErasing(true)}>{t("Удалить загруженные данные")}</button>}
 {erasing&&<ConfirmDialog title={t("Удалить импортированные данные?")} description={t("Синхронизация отключится. Все импортированные шаги и сон будут удалены из Life Hub. Записи в Apple Health, Health Connect и ручные записи Life Hub останутся.")} onClose={()=>setErasing(false)} onConfirm={async()=>{await api('/health/device?erase=true',{method:'DELETE'});forgetHealth(user.id);await load();window.dispatchEvent(new Event('lifehub:data-changed'));}}/>}
 <small>{t("Чтение за последние 7 дней. Нет показателя — нет доступных записей или разрешения. Сон за сутки учитывается без повторного подсчёта пересекающихся интервалов. Если Android не передаёт фазы, используется длительность сеанса сна. Обновление — при открытии приложения и вручную. Отключение сохраняет ранее загруженные значения.")}</small>
 </section>;
}
