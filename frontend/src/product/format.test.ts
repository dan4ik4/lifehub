import {it,expect} from 'vitest';
import {formatAmount} from './format';
it('preserves cents beyond the safe integer range',()=>{expect(formatAmount('99999999999999.99').replace(/\s/g,'')).toBe('99999999999999,99');expect(formatAmount('-0.01')).toBe('-0,01');expect(formatAmount('10.00')).toBe('10');});
