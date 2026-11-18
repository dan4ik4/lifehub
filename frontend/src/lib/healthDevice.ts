import {Capacitor} from '@capacitor/core';
import type {HealthSample, HealthDataType} from '@capgo/capacitor-health';
import {api,getSession} from './api';
import {shiftDay,startOfDay,todayKey} from './dates';
import type {User} from './types';
export type Metric='steps'|'sleep';
export type Provider='apple_health'|'health_connect';
export type DeviceDay={day:string;steps:number|null;sleep_seconds:number|null;provider:Provider};
export type Connection={provider:Provider;enabled:boolean;revision:number;last_synced_at:string|null};
export type DeviceStatus={connection:Connection|null;days:DeviceDay[]};
type Saved={sync_token:string;provider:Provider;metrics:Metric[]};
const key=(id:string)=>'lifehub.device-health.v1.'+id;
export const nativeHealth=()=>Capacitor.isNativePlatform();
export const providerName=(p:Provider)=>p==='apple_health'?'Apple Health':'Health Connect';
export function savedHealth(id:string):Saved|null{try{return JSON.parse(localStorage.getItem(key(id))||'null');}catch{return null;}}
export function forgetHealth(id:string){localStorage.removeItem(key(id));}

// Union of sleeping intervals, never sum overlapping watch/phone/stage samples.
export function sleepSeconds(samples:HealthSample[],start:number,end:number):number|null{
  const intervals:[number,number][]=[];
  const asleep=new Set(['asleep','rem','deep','light']);
  for(const sample of samples){
    const segments=sample.stages?.length?sample.stages:[{startDate:sample.startDate,endDate:sample.endDate,stage:sample.sleepState??(sample.hasStageData===false?'asleep':undefined)}];
    for(const segment of segments){
      if(!segment.stage||!asleep.has(segment.stage))continue;
      const a=Math.max(start,Date.parse(segment.startDate)),b=Math.min(end,Date.parse(segment.endDate));
      if(Number.isFinite(a)&&Number.isFinite(b)&&b>a)intervals.push([a,b]);
    }
  }
  if(!intervals.length)return null;
  intervals.sort((a,b)=>a[0]-b[0]);let total=0,[a,b]=intervals[0];
  for(const [c,d] of intervals.slice(1)){if(c<=b)b=Math.max(b,d);else{total+=b-a;a=c;b=d;}}
  return Math.round((total+b-a)/1000);
}
function assertAccount(id:string){if(getSession()?.user.id!==id)throw new Error('Аккаунт изменился. Повторите подключение.');}
export async function connectHealth(user:User,metrics:Metric[]){
  if(!nativeHealth())throw new Error('Подключение доступно в установленном приложении для телефона.');
  if(!metrics.length)throw new Error('Выберите сон или шаги.');
  if(Intl.DateTimeFormat().resolvedOptions().timeZone!==user.timezone)throw new Error('Для синхронизации часовой пояс профиля должен совпадать с часовым поясом телефона.');
  const {Health}=await import('@capgo/capacitor-health');
  if(!(await Health.isAvailable()).available)throw new Error('Данные здоровья недоступны. На Android проверьте установку Health Connect.');
  const permission=await Health.requestAuthorization({read:metrics,write:[]});
  // HealthKit deliberately does not disclose whether read permission was denied.
  const accepted=Capacitor.getPlatform()==='android'?metrics.filter(m=>permission.readAuthorized.includes(m)):metrics;
  if(!accepted.length)throw new Error('Доступ не предоставлен. Разрешите чтение выбранных показателей в настройках здоровья.');
  assertAccount(user.id);
  const provider:Provider=Capacitor.getPlatform()==='ios'?'apple_health':'health_connect';
  const connected=await api<Connection&{sync_token:string}>('/health/device/connect',{method:'POST',body:{provider,consent:true}});
  assertAccount(user.id);
  localStorage.setItem(key(user.id),JSON.stringify({provider,sync_token:connected.sync_token,metrics:accepted}));
}
let flight:Promise<void>|null=null;
export async function syncHealth(user:User):Promise<void>{
  if(flight)return flight;
  flight=runSync(user).finally(()=>{flight=null;});return flight;
}
async function runSync(user:User){
  const saved=savedHealth(user.id);if(!saved||!nativeHealth())return;
  assertAccount(user.id);
  if(Intl.DateTimeFormat().resolvedOptions().timeZone!==user.timezone)throw new Error('Сверьте часовой пояс профиля и телефона перед синхронизацией.');
  const current=await api<DeviceStatus>('/health/device');
  if(!current.connection?.enabled||current.connection.provider!==saved.provider){forgetHealth(user.id);return;}
  const {Health}=await import('@capgo/capacitor-health');
  if(!(await Health.isAvailable()).available)throw new Error('Приложение здоровья недоступно.');
  if(Capacitor.getPlatform()==='android'){
    const permissions=await Health.checkAuthorization({read:saved.metrics as HealthDataType[],write:[]});
    if(saved.metrics.some(m=>!permissions.readAuthorized.includes(m)))throw new Error('Разрешение на чтение здоровья отозвано. Подключите показатели заново.');
  }
  const today=todayKey(user.timezone),first=shiftDay(today,-6),startDate=startOfDay(first,user.timezone),endDate=new Date().toISOString();
  const dayKeys=Array.from({length:7},(_,i)=>shiftDay(first,i));
  // Separate local-day requests also cover 23/25-hour DST days. Android's day bucket is a fixed 24 hours.
  const steps=saved.metrics.includes('steps')?await Promise.all(dayKeys.map(day=>Health.queryAggregated({dataType:'steps',startDate:startOfDay(day,user.timezone),endDate:new Date(Math.min(Date.parse(startOfDay(shiftDay(day,1),user.timezone)),Date.parse(endDate))).toISOString(),bucket:'day',aggregation:'sum'}))):null;
  const sleep=saved.metrics.includes('sleep')?await Health.readSamples({dataType:'sleep',startDate:new Date(Date.parse(startDate)-86400000).toISOString(),endDate,limit:10000,ascending:true}):null;
  if(sleep&&sleep.samples.length>=10000)throw new Error('Слишком много записей сна. Синхронизация не выполнена, чтобы не потерять часть данных.');
  const days=dayKeys.map((day,i)=>{
    const start=Date.parse(startOfDay(day,user.timezone)),end=Math.min(Date.parse(startOfDay(shiftDay(day,1),user.timezone)),Date.parse(endDate));
    const buckets=steps?.[i].samples||[];
    return {day,steps:buckets.length?Math.round(buckets.reduce((sum,s)=>sum+s.value,0)):null,sleep_seconds:sleep?sleepSeconds(sleep.samples,start,end):null};
  });
  assertAccount(user.id);
  // Disconnect while the native read was running must not upload afterward.
  if(savedHealth(user.id)?.sync_token!==saved.sync_token)return;
  await api('/health/device/sync',{method:'POST',body:{...saved,revision:current.connection.revision,timezone:user.timezone,days}});
  window.dispatchEvent(new Event('lifehub:data-changed'));
}
