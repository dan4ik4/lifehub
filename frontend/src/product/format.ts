import { locale, decimalSeparator } from '../lib/language';
export function formatAmount(value:unknown):string {
 if(typeof value==='string'&&/^-?\d+(\.\d{1,2})?$/.test(value)){
  const negative=value.startsWith('-'),[whole,fraction='']=value.replace(/^-/, '').split('.');
  const tail=fraction.replace(/0+$/,'');
  return (negative&&(BigInt(whole)!==0n||!!tail)?'-':'')+new Intl.NumberFormat(locale).format(BigInt(whole))+(tail?decimalSeparator+tail:'');
 }
 return new Intl.NumberFormat(locale,{maximumFractionDigits:2}).format(Number(value||0));
}
