import {describe,it,expect} from 'vitest';
import {dayStats,monthDays} from './habitStats';
import type {Habit} from './habitStats';
const h:Habit={id:'1',title:'Walk',kind:'boolean',target:1,unit:'',weekdays:[0,1,2,3,4],created_at:'2026-10-20T22:30:00Z',archived:false,version:1,goal_id:null,contributes:false,reminder_time:null};
describe('habit statistics',()=>{
 it('excludes future, unscheduled and pre-creation days in user timezone',()=>{
  expect(dayStats([h],{},'2026-10-20','2026-10-22','Europe/Warsaw').due).toBe(0);
  expect(dayStats([h],{},'2026-10-23','2026-10-22','Europe/Warsaw').percent).toBeNull();
  expect(dayStats([h],{},'2026-10-24','2026-10-25','Europe/Warsaw').percent).toBeNull();
 });
 it('counts complete and partial marks correctly',()=>{
  const n={...h,target:20};
  expect(dayStats([n],{'1':[{day:'2026-10-22',value:10}]},'2026-10-22','2026-10-22','Europe/Warsaw').percent).toBe(0);
  expect(dayStats([n],{'1':[{day:'2026-10-22',value:20}]},'2026-10-22','2026-10-22','Europe/Warsaw').percent).toBe(100);
 });
 it('handles leap months and excludes archived habits',()=>{
  expect(monthDays('2024-02')).toHaveLength(29);
  expect(dayStats([{...h,archived:true}],{},'2026-10-22','2026-10-22','Europe/Warsaw').due).toBe(0);
 });
});
