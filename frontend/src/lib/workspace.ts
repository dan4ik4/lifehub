import { t } from './language';
import type { PlanningList } from './types';

export function listDisplayName(list: PlanningList) {
  return list.is_system && list.kind === 'shopping' && list.name === 'Покупки'
    ? t('Покупки')
    : list.name;
}

export function openQuickAdd(kind?: string) {
  window.dispatchEvent(new CustomEvent('lifehub:quick-add',{detail:kind}));
}

export function openAssistant(prompt?: string) {
  window.dispatchEvent(new CustomEvent('lifehub:open-assistant',{detail:prompt}));
}

export function refreshWorkspace() {
  window.dispatchEvent(new Event('lifehub:data-changed'));
}
