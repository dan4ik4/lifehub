type MoneyRow = {currency:string;kind:'income'|'expense';amount:string};
export function csvCents(value:string):bigint|null {
  if(!/^\d{1,14}(?:\.\d{1,2})?$/.test(value))return null;
  const [whole,fraction='']=value.split('.');
  const cents=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
  return cents>0n?cents:null;
}
export function csvTotals(rows:MoneyRow[]) {
  const totals:Record<string,{income:bigint;expense:bigint}>={};
  for(const row of rows){const cents=csvCents(row.amount);if(cents===null)continue;const total=totals[row.currency]??={income:0n,expense:0n};total[row.kind]+=cents;}
  return totals;
}
export function formatCents(cents:bigint):string {
  return (cents/100n).toLocaleString('ru-RU')+','+(cents%100n).toString().padStart(2,'0');
}
