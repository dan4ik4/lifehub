export const financeGroups = [
  ['overview', 'analysis'],
  ['transactions'],
  ['budgets', 'subscriptions'],
  ['savings', 'saving-goals'],
  ['debts'],
] as const;

export function financeGroup(tab = 'overview'): readonly string[] {
  return financeGroups.find(group => group.some(key => key === tab)) ?? [];
}
