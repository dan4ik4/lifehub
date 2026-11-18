import {beforeEach,afterEach,describe,expect,it,vi} from 'vitest';
import type {User} from './types';
const mocks=vi.hoisted(()=>({api:vi.fn(),session:vi.fn(),available:vi.fn(),request:vi.fn(),check:vi.fn(),aggregate:vi.fn(),samples:vi.fn()}));
vi.mock('@capacitor/core',()=>({Capacitor:{isNativePlatform:()=>true,getPlatform:()=> 'android'}}));
vi.mock('./api',()=>({api:mocks.api,getSession:mocks.session}));
vi.mock('@capgo/capacitor-health',()=>({Health:{isAvailable:mocks.available,requestAuthorization:mocks.request,checkAuthorization:mocks.check,queryAggregated:mocks.aggregate,readSamples:mocks.samples}}));
import {connectHealth,syncHealth,forgetHealth} from './healthDevice';
const user={id:'device-test-user',timezone:Intl.DateTimeFormat().resolvedOptions().timeZone} as User;
beforeEach(()=>{
 vi.clearAllMocks();const storage=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v),removeItem:(k:string)=>storage.delete(k)});
 vi.stubGlobal('window',{dispatchEvent:vi.fn()});mocks.session.mockReturnValue({user});
 mocks.available.mockResolvedValue({available:true});mocks.request.mockResolvedValue({readAuthorized:['steps','sleep']});mocks.check.mockResolvedValue({readAuthorized:['steps','sleep']});
 mocks.aggregate.mockResolvedValue({samples:[{value:123}]});mocks.samples.mockResolvedValue({samples:[]});
 mocks.api.mockImplementation(async(path:string)=>path.endsWith('/connect')?{sync_token:'token',provider:'health_connect',revision:0}:{connection:{provider:'health_connect',enabled:true,revision:0}});
});
afterEach(()=>vi.unstubAllGlobals());
describe('native health consent and upload',()=>{
 it('requests only selected read permissions and uploads daily snapshots',async()=>{
  await connectHealth(user,['steps']);await syncHealth(user);
  expect(mocks.request).toHaveBeenCalledWith({read:['steps'],write:[]});expect(mocks.aggregate).toHaveBeenCalledTimes(7);expect(mocks.samples).not.toHaveBeenCalled();
  const upload=mocks.api.mock.calls.find(c=>c[0].endsWith('/sync'))![1].body;
  expect(upload.metrics).toEqual(['steps']);expect(upload.days).toHaveLength(7);expect(upload.days[0].steps).toBe(123);
 });
 it('does not connect after permission denial',async()=>{
  mocks.request.mockResolvedValue({readAuthorized:[]});await expect(connectHealth(user,['steps'])).rejects.toThrow('Доступ не предоставлен');expect(mocks.api).not.toHaveBeenCalled();
 });
 it('does not upload if disconnected during native reads',async()=>{
  await connectHealth(user,['steps']);mocks.aggregate.mockImplementation(async()=>{forgetHealth(user.id);return {samples:[]};});await syncHealth(user);
  expect(mocks.api.mock.calls.some(c=>c[0].endsWith('/sync'))).toBe(false);
 });
 it('does not upload into a different logged-in account',async()=>{
  await connectHealth(user,['steps']);mocks.aggregate.mockImplementation(async()=>{mocks.session.mockReturnValue({user:{id:'other'}});return {samples:[]};});
  await expect(syncHealth(user)).rejects.toThrow('Аккаунт изменился');expect(mocks.api.mock.calls.some(c=>c[0].endsWith('/sync'))).toBe(false);
 });
 it('stops when native read permission is revoked',async()=>{
  await connectHealth(user,['steps']);mocks.check.mockResolvedValue({readAuthorized:[]});await expect(syncHealth(user)).rejects.toThrow('отозвано');expect(mocks.aggregate).not.toHaveBeenCalled();
 });
});
