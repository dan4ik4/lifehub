import {useEffect} from 'react';
import {nativeHealth,savedHealth,syncHealth} from '../lib/healthDevice';
import {isDemo} from '../lib/api';
import type {User} from '../lib/types';
export function NativeHealthSync({user}:{user:User}){
 useEffect(()=>{
  if(!nativeHealth()||isDemo())return;
  const refresh=()=>{if(document.visibilityState==='visible'&&savedHealth(user.id))void syncHealth(user).catch(()=>{/* The health screen offers explicit retry and permission recovery. */});};
  refresh();document.addEventListener('visibilitychange',refresh);
  return()=>document.removeEventListener('visibilitychange',refresh);
 },[user]);return null;
}
