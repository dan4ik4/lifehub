import {useCallback,useEffect,useState} from 'react';
import type {ReactNode} from 'react';
import {api,errorMessage} from '../../lib/api';
import {dayLabel,shiftDay} from '../../lib/dates';
import {locale,t} from '../../lib/language';
import {refreshWorkspace} from '../../lib/workspace';
import {formatAmount} from '../format';

const assets = import.meta.glob('./icons/*.svg',{eager:true,query:'?url',import:'default'}) as Record<string,string>;
export type HealthIconName = 'leaf'|'home'|'calendar'|'target'|'heart'|'wallet'|'book'|'sparkles'|'settings'|'search'|
 'moon'|'scale'|'activity'|'list'|'apple'|'pill'|'sun'|'smile'|'arrow'|'pencil'|'cr'|'trend'|'plus'|
 'trash'|'crown'|'more'|'zap'|'grip'|'check'|'alert'|'x'|'clock'|'keyboard';
export function HIcon({name,size=16}:{name:HealthIconName;size?:number}) {
  return <span className="health-icon" data-health-icon={name} aria-hidden="true"
    style={{width:size,height:size,maskImage:'url("'+assets['./icons/'+name+'.svg']+'")'}}/>;
}
export type HealthTab = 'sleep'|'weight'|'programs'|'nutrition'|'medications';
export type HealthEntity = {id:string;version:number;created_at?:string};
export type Sleep = HealthEntity & {start_at:string;end_at:string;quality:number;hours?:number};
export type Weight = HealthEntity & {day:string;kg:string;notes?:string};
export type WeightGoal = HealthEntity & {kg:string;mode:'gain'|'maintain'|'lose'};
export type Exercise = {name:string;sets:number;reps:number;kg:number|null};
export type Program = HealthEntity & {title:string;exercises:Exercise[]};
export type Workout = HealthEntity & {day:string;title:string;program_id?:string|null;minutes:number;efforts:{name:string;kg:number|null;reps:number}[]};
export type Meal = 'breakfast'|'lunch'|'dinner'|'snack';
export type Macros = {calories:number;protein:number;fat:number;carbs:number};
export type Food = HealthEntity & {day:string;meal:Meal;title:string} & Record<keyof Macros,string>;
export type FoodGoal = HealthEntity & Macros;
export type Medication = HealthEntity & {title:string;dosage:string;times:string[];weekdays:number[];course_end:string|null;stock:number|null;remaining?:number|null};
export type MedicationSlot = {row:HealthEntity & {title:string;dosage:string};time:string;taken:boolean;skipped:boolean;taken_at:string|null};
export type MedicationTracking = {courses:Medication[];days:{day:string;taken:number;total:number}[]};
export type HealthSummary = {sleep:Sleep[];weight:Weight[];workouts:Workout[];nutrition?:Food[];device_days?:{day:string;sleep_seconds:number|null;provider:string}[]};
const root='/modules/health';
export const healthRoot=root;
export const healthTabs = [
  ['overview',t('Обзор'),'heart'],['sleep',t('Сон'),'moon'],['weight',t('Вес'),'scale'],['workouts',t('Тренировки'),'activity'],
  ['programs',t('Программы'),'list'],['nutrition',t('Питание'),'apple'],['medications',t('Лекарства'),'pill'],
] as const;
export const healthRoutes = Object.fromEntries(healthTabs.map(([key,label,icon])=>[root+(key==='overview'?'':'/'+key),{key,label,icon}]));
export const healthMeals = [
  ['breakfast',t('Завтрак'),'sun'],['lunch',t('Обед'),'apple'],['dinner',t('Ужин'),'moon'],['snack',t('Перекус'),'zap'],
] as const;
export const macroNames={calories:t('Калории'),protein:t('Белки'),fat:t('Жиры'),carbs:t('Углеводы')};
export const macroKeys=['calories','protein','fat','carbs'] as const;
export const zeroMacros:Macros={calories:0,protein:0,fat:0,carbs:0};
export function totals(rows:Food[]):Macros {
  return rows.reduce((sum,row)=>({calories:sum.calories+Number(row.calories),protein:sum.protein+Number(row.protein),
    fat:sum.fat+Number(row.fat),carbs:sum.carbs+Number(row.carbs)}),zeroMacros);
}
export function useHealthData<T>(path:string|null) {
  const [state,setState]=useState<{path:string;data?:T;error?:string}>();
  const [revision,setRevision]=useState(0);
  const reload=useCallback(()=>setRevision(value=>value+1),[]);
  useEffect(()=>{
    window.addEventListener('lifehub:data-changed',reload);
    return()=>window.removeEventListener('lifehub:data-changed',reload);
  },[reload]);
  useEffect(()=>{
    if(!path)return;
    const controller=new AbortController();
    api<T>(path,{signal:controller.signal}).then(data=>{
      if(!controller.signal.aborted)setState({path,data});
    }).catch(cause=>{if(!controller.signal.aborted)setState({path,error:errorMessage(cause)});});
    return()=>controller.abort();
  },[path,revision]);
  const fresh=state?.path===path?state:undefined;
  return {data:fresh?.data,error:fresh?.error,reload};
}
export function summaryPath(day:string,days:number) {
  return '/health/summary?'+new URLSearchParams({from:shiftDay(day,1-days),to:day});
}
export function saveHealth(path:string,body:Record<string,unknown>,row?:HealthEntity) {
  return api(path+(row?'/'+row.id:''),{method:row?'PATCH':'POST',body:{...body,...(row?{version:row.version}:{})}})
    .then(()=>refreshWorkspace());
}
export async function deleteHealth(path:string,row:HealthEntity) {
  await api(path+'/'+row.id+'?version='+row.version,{method:'DELETE'});
  refreshWorkspace();
}
export function clock(minutes:number) {
  const integer=Math.round(minutes);
  return Math.floor(integer/60)+':'+String(integer%60).padStart(2,'0');
}
export function wallClock(minutes:number) {
  return clock((Math.round(minutes)%1440+1440)%1440).padStart(5,'0');
}
export function signed(value:number) {
  const rounded=Math.round(value*10)/10;
  return (rounded>=0?'+':'−')+formatAmount(Math.abs(rounded));
}
const weightNumber = new Intl.NumberFormat(locale,{minimumFractionDigits:1,maximumFractionDigits:1,useGrouping:false});
export const decimalWeight=(value:number)=>weightNumber.format(value);
export const shortHealthDay=(day:string)=>dayLabel(day,{day:'numeric',month:'short'});
export function HealthButton({children,icon,onClick,primary=false,disabled=false}:{children:ReactNode;icon?:HealthIconName;
  onClick:()=>void;primary?:boolean;disabled?:boolean}) {
  return <button type="button" className={'health-button'+(primary?' health-primary':'')} onClick={onClick} disabled={disabled}>
    {icon&&<HIcon name={icon}/>} {children}</button>;
}
export function IconAction({icon,label,onClick,disabled=false}:{icon:HealthIconName;label:string;onClick:()=>void;disabled?:boolean}) {
  return <button type="button" className="health-icon-action" aria-label={label} title={label} onClick={onClick} disabled={disabled}><HIcon name={icon}/></button>;
}
export function HealthSegment<T extends string|number>({choices,value,onSelect,label}:{choices:readonly (readonly [T,string])[];value:T;onSelect:(value:T)=>void;label:string}) {
  return <div className="health-segments" role="group" aria-label={label}>{choices.map(([key,title])=>
    <button type="button" key={key} aria-pressed={key===value} onClick={()=>onSelect(key)}>{title}</button>)}</div>;
}
export function HealthTitle({title,subtitle,children}:{title:string;subtitle:string;children?:ReactNode}) {
  return <header className="health-title"><div><div className="health-kicker">{t('Здоровье')}</div><h1>{title}</h1><p>{subtitle}</p></div>
    {children&&<div className="health-title-actions">{children}</div>}</header>;
}
export function HealthState({error,reload}:{error?:string;reload?:()=>void}) {
  return error ? <div className="health-state" role="alert">{error} {reload&&<HealthButton onClick={reload}>{t('Повторить')}</HealthButton>}</div>
    : <p className="health-state" role="status">{t('Загрузка…')}</p>;
}
export function HealthBar({value,label}:{value:number;label:string}) {
  return <span className="health-bar" role="progressbar" aria-label={label} aria-valuenow={Math.round(Math.min(1,Math.max(0,value))*100)}>
    <i style={{width:Math.min(100,Math.max(0,value*100))+'%'}}/></span>;
}
export function HealthTile({icon,children}:{icon:HealthIconName;children?:ReactNode}) {
  return <span className="health-tile"><HIcon name={icon} size={18}/>{children}</span>;
}
export function csvWeightDownload(rows:Weight[],unit:string,value:(row:Weight)=>number) {
  const quote=(field:string)=>'"'+field.replaceAll('"','""')+'"';
  const safe=(field:string)=>/^\s*[=+\-@]/.test(field)?"'"+field:field;
  const csv=[['date','weight','unit','notes'],...rows.map(row=>[row.day,String(value(row)),unit,safe(row.notes??'')])]
    .map(row=>row.map(quote).join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob(['\ufeff',csv],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download='lifehub-weight.csv';a.click();
  window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}
