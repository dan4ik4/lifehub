import {describe,expect,it} from 'vitest';
import {availableWindows} from './FreeTime';

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
});
