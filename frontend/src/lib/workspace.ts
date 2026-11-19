export function openQuickAdd(kind?: string) {
  window.dispatchEvent(new CustomEvent('lifehub:quick-add',{detail:kind}));
}

export function openAssistant() {
  window.dispatchEvent(new Event('lifehub:open-assistant'));
}

export function refreshWorkspace() {
  window.dispatchEvent(new Event('lifehub:data-changed'));
}
