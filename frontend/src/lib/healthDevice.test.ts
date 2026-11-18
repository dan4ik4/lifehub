import {describe,it,expect} from 'vitest';
import type {HealthSample} from '@capgo/capacitor-health';
import {sleepSeconds} from './healthDevice';
const date=(h:number)=>new Date(Date.UTC(2026,9,20,h)).toISOString();
const sample=(a:number,b:number,extra:Partial<HealthSample>={})=>({startDate:date(a),endDate:date(b),sleepState:'asleep',...extra} as HealthSample);
const start=Date.parse(date(0)),end=Date.parse(date(24));
describe('device sleep totals',()=>{
 it('merges overlapping devices instead of double counting',()=>expect(sleepSeconds([sample(1,7),sample(2,8)],start,end)).toBe(7*3600));
 it('clips to the selected day',()=>expect(sleepSeconds([sample(-2,6)],start,end)).toBe(6*3600));
 it('excludes awake and in-bed samples',()=>expect(sleepSeconds([sample(1,8,{sleepState:'inBed'}),sample(8,9,{sleepState:'awake'})],start,end)).toBeNull());
 it('uses actual stages instead of entire session',()=>expect(sleepSeconds([sample(1,8,{stages:[{startDate:date(1),endDate:date(4),stage:'deep',durationMinutes:180},{startDate:date(4),endDate:date(8),stage:'awake',durationMinutes:240}]})],start,end)).toBe(3*3600));
 it('supports Android sessions without stages as duration estimates',()=>expect(sleepSeconds([sample(1,8,{sleepState:undefined,hasStageData:false})],start,end)).toBe(7*3600));
 it('does not invent zero sleep when unavailable',()=>expect(sleepSeconds([],start,end)).toBeNull());
});
