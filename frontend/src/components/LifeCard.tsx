import type {ReactNode} from 'react';
import {ArrowRight} from 'lucide-react';

export function LifeCard({children,className=''}:{children:ReactNode;className?:string}) {
  return <section className={`life-card ${className}`}>{children}</section>;
}

export function LifeLink({children,action}:{children:ReactNode;action:()=>void}) {
  return <button type="button" className="life-text-link" onClick={action}>{children}<ArrowRight size={15}/></button>;
}

export function LifeRings({values,size=120,label}:{values:{value:number;color:string;track?:string}[];size?:number;label:string}) {
  return <svg className="life-ring" width={size} height={size} viewBox="0 0 128 128" role="img" aria-label={label}>
    {values.map(({value,color,track},index)=>{
      const radius=57-index*14;
      const circumference=2*Math.PI*radius;
      return <g key={index}><circle cx="64" cy="64" r={radius} stroke={track??'#dae7dd'} strokeWidth="10" fill="none"/>
        {value>0 && <circle className="life-ring-value" cx="64" cy="64" r={radius} stroke={color} strokeWidth="10" fill="none" strokeLinecap="round" strokeDasharray={`${Math.min(value,1)*circumference} ${circumference}`}/>}</g>;
    })}
  </svg>;
}

export function LifeBars({values,format}:{values:(number|null)[];format:(value:number)=>string}) {
  const max=Math.max(1,...values.map(x=>x??0));
  const min=Math.min(...values.filter((x):x is number=>x!==null));
  const last=values.reduce((index,value,current)=>value===null?index:current,-1);
  return <span className="life-bars" role="img" aria-label={values.map(x=>x===null?'нет данных':format(x)).join(', ')}>
    {values.map((value,index)=><i key={index} className={index===last?'latest':''} data-empty={value===null||undefined}
      style={{height:value===null?'12%':(min===max?80:25+75*(value-min)/(max-min))+'%'}} title={value===null?'Нет данных':format(value)}/>)}
  </span>;
}
