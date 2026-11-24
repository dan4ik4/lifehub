import {describe,expect,it} from 'vitest';
import {availableWindows,busyIntervals,windowsForDay} from './FreeTime';

const at=(hour:number,minute=0)=>(hour*60+minute)*60_000;
describe('available windows',()=>{
  it('merges overlap, clips the buffer at day boundaries and marks short slots',()=>{
    const result=availableWindows(at(8),at(18),[{start:at(8),end:at(10),title:'One'},
      {start:at(9),end:at(12),title:'Two'},{start:at(13),end:at(14),title:'Three'}],60,15,0);
    expect(result.map(({start,end,kind})=>[start,end,kind])).toEqual([
      [at(8),at(12,15),'busy'],[at(12,15),at(12,45),'short'],[at(12,45),at(14,15),'busy'],[at(14,15),at(18),'free'],
    ]);
  });
  it('keeps only the future portion of today',()=>{
    expect(availableWindows(at(8),at(18),[],60,0,at(11))).toEqual([
      {start:at(8),end:at(11),title:'Прошло',kind:'past'},{start:at(11),end:at(18),title:'Свободно',kind:'free'},
    ]);
  });
  it('has no free hour during a task spanning yesterday to tomorrow even when the agenda is empty',()=>{
    const busy=busyIntervals({tasks:[],events:[]},[],[{
      start_at:'2026-11-23T19:00:00+01:00',end_at:'2026-11-25T09:00:00+01:00',title:'Travel',
    }]);
    const today=windowsForDay('2026-11-24','Europe/Warsaw',busy,{start:'08:00',end:'22:00',buffer:15},60,
      Date.parse('2026-11-24T10:00:00+01:00'));
    expect(today.free).toEqual([]);
  });
});
