import {useCallback, useEffect, useState} from 'react';
import {api, isDemo} from './api';
export type AssistantPreferences = {messages:boolean; media:boolean; modules:boolean};
const empty:AssistantPreferences={messages:false,media:false,modules:false};
export function useAssistantPreferences(userId:string, enabled=true){
  const [preferences,setPreferences]=useState<AssistantPreferences>(empty);
  const [loading,setLoading]=useState(true);
  const [failure,setFailure]=useState<unknown>(null);
  useEffect(()=>{
    let alive=true;setLoading(enabled);setPreferences(empty);setFailure(null);
    if(!enabled)return;
    const load=()=>{if(isDemo()){setLoading(false);return;} api<AssistantPreferences>('/users/me/assistant-preferences').then(p=>{if(alive){setPreferences(p);setFailure(null);}}).catch(e=>{if(alive)setFailure(e);}).finally(()=>{if(alive)setLoading(false);});};
    load();window.addEventListener('lifehub:assistant-preferences',load);
    return()=>{alive=false;window.removeEventListener('lifehub:assistant-preferences',load);};
  },[userId,enabled]);
  const save=useCallback(async (next:AssistantPreferences)=>{
    setLoading(true);
    try{const value=await api<AssistantPreferences>('/users/me/assistant-preferences',{method:'PATCH',body:next});setPreferences(value);setFailure(null);window.dispatchEvent(new Event('lifehub:assistant-preferences'));}
    finally{setLoading(false);}
  },[userId]);
  return {preferences,loading,failure,save};
}
