import {describe,it,expect} from 'vitest';
import {financeMoney} from './FinanceAnalysis';

describe('financial totals preserve decimal strings',()=>{
  it('keeps cents and a negative sign below one whole unit',()=>{
    expect(financeMoney('-0.05')).toBe('-0,05');
    expect(financeMoney('0.00')).toBe('0,00');
    expect(financeMoney('1.20')).toBe('1,20');
  });
  it('formats totals above the exact Number range without losing cents',()=>{
    expect(financeMoney('999999999999999999.99').replace(/\s/g,'')).toBe('999999999999999999,99');
  });
});
