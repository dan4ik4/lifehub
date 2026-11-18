import {shiftDay} from '../lib/dates';
export type Habit = {id:string;title:string;kind:string;target:string|number;unit:string;weekdays:number[];created_at:string;archived:boolean;version:number;goal_id:string|null;contributes:boolean;reminder_time:string|null};
export type Checkin = {day:string;value:string|number};
export function scheduled(h:Habit,day:string,today:string,timezone:string){
  const created=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(h.created_at));
  return day<=today&&day>=created&&h.weekdays.includes((new Date(day+'T12:00:00Z').getUTCDay()+6)%7);
}
export function dayStats(habits:Habit[],history:Record<string,Checkin[]>,day:string,today:string,timezone:string){
  const due=habits.filter(h=>!h.archived&&scheduled(h,day,today,timezone));
  const done=due.filter(h=>Number(history[h.id]?.find(c=>c.day===day)?.value||0)>=Number(h.target)).length;
  return {due:due.length,done,percent:due.length?Math.round(100*done/due.length):null};
}
export function monthDays(month:string){
  const result:string[]=[];let day=month+'-01';while(day.startsWith(month)){result.push(day);day=shiftDay(day,1);}return result;
}
