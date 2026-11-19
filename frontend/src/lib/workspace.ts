export function openQuickAdd(kind?: string) {
  window.dispatchEvent(new CustomEvent('lifehub:quick-add',{detail:kind}));
}

export function openAssistant(prompt?: string) {
  window.dispatchEvent(new CustomEvent('lifehub:open-assistant',{detail:prompt}));
}

export function refreshWorkspace() {
  window.dispatchEvent(new Event('lifehub:data-changed'));
}
