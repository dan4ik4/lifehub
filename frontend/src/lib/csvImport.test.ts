import {describe,expect,it} from 'vitest';
import {csvCents,csvTotals,formatCents} from './csvImport';
describe('CSV preview amounts',()=>{
  it('keeps large monetary values exact and totals currencies separately',()=>{
    const result=csvTotals([{currency:'PLN',kind:'expense',amount:'99999999999999.99'},{currency:'PLN',kind:'expense',amount:'0.01'},{currency:'EUR',kind:'income',amount:'12.10'}]);
    expect(result.PLN.expense).toBe(10000000000000000n);
    expect(result.EUR.income).toBe(1210n);
    expect(formatCents(1210n)).toBe('12,10');
  });
  it.each(['','0','-1','1e3','NaN','12.345','100000000000000.00'])('rejects invalid editable amount %s',value=>expect(csvCents(value)).toBeNull());
});
