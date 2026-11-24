import { t } from '../lib/language';
import {useEffect, useRef, useState} from 'react';
import {ImagePlus, Mic, ArrowUp, LoaderCircle, X} from 'lucide-react';

export type PhotoDraft = {data:string; name:string};
type Props = {
  photo: PhotoDraft|null;
  onPhoto:(photo:PhotoDraft|null)=>void;
  onVoice:(audio:Blob, signal:AbortSignal)=>Promise<void>;
  onError:(message:string)=>void;
  onActivity:(active:boolean)=>void;
  disabled:boolean;
};

async function preparePhoto(file:File):Promise<PhotoDraft> {
  if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error(t("Выберите фото JPG, PNG или WebP."));
  if(file.size>20*1024*1024)throw new Error(t("Фото слишком большое. Выберите изображение до 20 МБ."));
  const url=URL.createObjectURL(file);
  try {
    const img=new Image(); img.src=url; await img.decode();
    if(img.naturalWidth*img.naturalHeight>16000000)throw new Error(t("Выберите фото до 16 мегапикселей."));
    const scale=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
    const ctx=canvas.getContext('2d'); if(!ctx)throw new Error(t("Не удалось подготовить фото."));
    ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
    for(const quality of [.85,.7,.55,.4]){
      const data=canvas.toDataURL('image/jpeg',quality);
      if(data.length<860000)return {data,name:file.name};
    }
    throw new Error(t("Не удалось уменьшить фото. Выберите изображение поменьше."));
  } finally {URL.revokeObjectURL(url);}
}

export function ChatMedia({photo,onPhoto,onVoice,onError,onActivity,disabled}:Props){
  const [phase,setPhase]=useState<'idle'|'starting'|'recording'|'finishing'|'ready'|'working'>('idle');
  const [seconds,setSeconds]=useState(0),[audio,setAudio]=useState<Blob|null>(null);
  const [levels,setLevels]=useState<number[]>(Array(24).fill(3)),[preparing,setPreparing]=useState(false);
  const file=useRef<HTMLInputElement>(null),recorder=useRef<MediaRecorder|null>(null),stream=useRef<MediaStream|null>(null);
  const generation=useRef(0),mounted=useRef(true),chunks=useRef<Blob[]>([]),bytes=useRef(0),sendOnStop=useRef(false);
  const request=useRef<AbortController|null>(null),meter=useRef<AudioContext|null>(null),meterTimer=useRef<number|null>(null);
  const release=()=>{
    stream.current?.getTracks().forEach(track=>track.stop());stream.current=null;
    if(meterTimer.current!==null)clearInterval(meterTimer.current);meterTimer.current=null;
    if(meter.current)void meter.current.close().catch(()=>{});meter.current=null;
  };
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;request.current?.abort();if(recorder.current?.state==='recording')recorder.current.stop();release();};},[]);
  useEffect(()=>{onActivity(phase!=='idle'||preparing);},[phase,preparing,onActivity]);
  useEffect(()=>{
    if(phase!=='recording')return;
    const timer=window.setInterval(()=>setSeconds(value=>Math.min(60,value+1)),1000);
    const end=window.setTimeout(()=>{if(recorder.current?.state==='recording'){setSeconds(60);setPhase('finishing');recorder.current.stop();}},60000);
    return()=>{clearInterval(timer);clearTimeout(end);};
  },[phase]);
  function cancel(){
    generation.current++;request.current?.abort();sendOnStop.current=false;
    if(recorder.current?.state==='recording')recorder.current.stop();release();setAudio(null);setPhase('idle');onError('');
  }
  async function submit(blob:Blob,token:number){
    if(token!==generation.current)return;
    setPhase('working');onError('');const controller=new AbortController();request.current=controller;
    try{await onVoice(blob,controller.signal);if(mounted.current&&token===generation.current){setAudio(null);setPhase('idle');}}
    catch(e){if(mounted.current&&token===generation.current&&!controller.signal.aborted){setAudio(blob);setPhase('ready');onError(e instanceof Error?e.message:t("Не удалось распознать речь."));}}
  }
  function finish(){
    if(disabled)return;
    if(phase==='recording'&&recorder.current?.state==='recording'){
      sendOnStop.current=true;setPhase('finishing');recorder.current.stop();
    }else if(phase==='ready'&&audio)void submit(audio,generation.current);
  }
  async function start(){
    if(disabled||phase!=='idle')return;
    onError('');
    if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined'){onError(t("Запись недоступна в этом браузере. Откройте приложение через HTTPS и разрешите микрофон."));return;}
    const token=++generation.current;setPhase('starting');sendOnStop.current=false;
    try{
      const microphone=await navigator.mediaDevices.getUserMedia({audio:{channelCount:{ideal:1},echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
      if(!mounted.current||token!==generation.current){microphone.getTracks().forEach(t=>t.stop());return;}
      stream.current=microphone;
      const mime=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(type=>MediaRecorder.isTypeSupported(type));
      if(!mime)throw new Error(t("Этот браузер не поддерживает формат записи. Попробуйте Chrome или Safari."));
      const capture=new MediaRecorder(microphone,{mimeType:mime,audioBitsPerSecond:64000});
      recorder.current=capture;chunks.current=[];bytes.current=0;setSeconds(0);setLevels(Array(24).fill(3));
      // Metering is optional: unsupported Web Audio must not prevent recording.
      try{
        const context=new AudioContext();meter.current=context;
        const analyser=context.createAnalyser();analyser.fftSize=256;
        context.createMediaStreamSource(microphone).connect(analyser);
        const samples=new Uint8Array(analyser.frequencyBinCount);
        meterTimer.current=window.setInterval(()=>{
          analyser.getByteTimeDomainData(samples);
          if(mounted.current&&token===generation.current)setLevels(Array.from({length:24},(_,i)=>Math.max(3,Math.min(28,Math.abs(samples[i*5]-128)*1.8))));
        },100);
      }catch{/* The recorder works without a level meter. */}
      capture.ondataavailable=e=>{if(token!==generation.current)return;if(e.data.size){chunks.current.push(e.data);bytes.current+=e.data.size;if(bytes.current>650000&&capture.state==='recording')capture.stop();}};
      capture.onerror=()=>{if(token!==generation.current)return;cancel();onError(t("Запись прервалась. Проверьте микрофон и попробуйте снова."));};
      capture.onstop=()=>{
        if(token!==generation.current)return;release();if(!mounted.current)return;
        const blob=new Blob(chunks.current,{type:capture.mimeType.split(';')[0]});
        if(blob.size===0||blob.size>650000){setPhase('idle');onError(t("Запись слишком большая или пустая. Запишите более короткое сообщение."));return;}
        setAudio(blob);
        if(sendOnStop.current)void submit(blob,token);else setPhase('ready');
      };
      capture.start(1000);setPhase('recording');
    }catch(e){if(token!==generation.current)return;release();if(mounted.current){setPhase('idle');onError(e instanceof DOMException&&e.name==='NotAllowedError'?t("Нет доступа к микрофону. Разрешите его в настройках браузера."):e instanceof Error?e.message:t("Не удалось включить микрофон."));}}
  }
  return <div className="chat-media">
    {photo&&<div className="chat-photo-draft"><img src={photo.data} alt={t("Фото перед отправкой")}/><div><strong>{t("Фото прикреплено")}</strong><small>{t("Добавьте вопрос к фотографии")}</small></div><button type="button" disabled={disabled||phase!=='idle'} aria-label={t("Убрать фото")} onClick={()=>onPhoto(null)}><X size={17}/></button></div>}
    {phase==='idle'?<div className="chat-media-tools">
      <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={async e=>{
        const selected=e.target.files?.[0];e.target.value='';if(!selected)return;setPreparing(true);
        try{const prepared=await preparePhoto(selected);if(mounted.current)onPhoto(prepared);}catch(error){if(mounted.current)onError(error instanceof Error?error.message:t("Не удалось открыть фото."));}finally{if(mounted.current)setPreparing(false);}
      }}/>
      <button type="button" disabled={disabled||preparing} onClick={()=>file.current?.click()}>{preparing?<LoaderCircle size={17} className="spinner"/>:<ImagePlus size={17}/>}<span>{photo?t("Заменить фото"):t("Фото")}</span></button>
      <button type="button" disabled={disabled||preparing} onClick={()=>void start()}><Mic size={17}/><span>{t("Голос")}</span></button><small>{t("Фото или запись до 1 минуты")}</small>
    </div>:<div className="chat-voice-inline">
      <button type="button" className="voice-cancel" aria-label={t("Отменить голосовое сообщение")} onClick={cancel}><X size={20}/></button>
      <div className="voice-center">
        {phase==='recording'||phase==='ready'?<><div className="voice-wave" aria-hidden="true">{levels.map((height,i)=><i key={i} style={{height}}/>)}</div><span className="voice-time">{Math.floor(seconds/60)}:{String(seconds%60).padStart(2,'0')}{phase==='ready'?t(" · Готово к отправке"):''}</span></>:<span className="voice-status" role="status"><LoaderCircle size={17} className="spinner"/>{phase==='starting'?t("Включаю микрофон…"):t("Распознаю речь…")}</span>}
      </div>
      <button type="button" className="voice-send" aria-label={t("Отправить голосовое сообщение")} disabled={disabled||(phase!=='recording'&&phase!=='ready')} onClick={finish}><ArrowUp size={22}/></button>
      <span className="sr-only" role="status">{phase==='recording'?t("Идёт запись. Отправьте сообщение или отмените."):''}</span>
    </div>}
  </div>;
}
