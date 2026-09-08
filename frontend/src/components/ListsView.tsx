import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowDown, ArrowUp, CheckCheck, Crown, ListChecks, LoaderCircle, MoreHorizontal, Pencil, Plus, ShoppingBasket, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { allPages } from '../lib/usePlanning';
import { plural } from '../lib/dates';
import type { ListItem, Notify, PlanningList } from '../lib/types';
import { CheckButton, ConfirmDialog, EmptyState, Modal } from './ui';

export function ListsView({ lists, pro, refresh, notify, onUpgrade }: { lists: PlanningList[]; pro: boolean; refresh: () => Promise<void>; notify: Notify; onUpgrade: () => void }) {
  const [selected, setSelected] = useState(''), [loadedItems, setItems] = useState<ListItem[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [adding, setAdding] = useState(false), [title, setTitle] = useState(''), [busy, setBusy] = useState<string[]>([]);
  const [listDialog, setListDialog] = useState<'new' | 'rename' | null>(null), [listName, setListName] = useState('');
  const [editItem, setEditItem] = useState<ListItem | null>(null), [bulk, setBulk] = useState(false), [bulkText, setBulkText] = useState('');
  const [deleting, setDeleting] = useState<{ type: 'list' | 'item'; id: string; title: string } | null>(null);
  const [showCompleted, setShowCompleted] = useState(true), [menu, setMenu] = useState(false);
  const current = lists.find(list => list.id === selected) || lists[0], currentId = current?.id;
  const requestId = useRef(0), activeId = useRef<string | undefined>(currentId);
  activeId.current = currentId;
  const items = loadedItems.filter(item => item.list_id === currentId);
  async function load(id: string) {
    if (id !== activeId.current) return;
    const request = ++requestId.current;
    const isCurrent = () => request === requestId.current && id === activeId.current;
    try { const values = await allPages<ListItem>(`/planning/lists/${id}/items`); if (isCurrent()) { setItems(values.sort((a, b) => a.position - b.position)); setError(''); } }
    catch (e) { if (isCurrent()) setError(errorMessage(e)); }
    finally { if (isCurrent()) setLoading(false); }
  }
  useEffect(() => {
    activeId.current = currentId; setError(''); setTitle(''); setItems([]);
    if (!currentId) { setLoading(false); return; }
    setLoading(true); void load(currentId);
    return () => { requestId.current++; if (activeId.current === currentId) activeId.current = undefined; };
  }, [currentId]);
  async function changed() { const id = activeId.current; if (id) await load(id); await refresh(); }
  async function add(event: FormEvent) {
    event.preventDefault(); if (!title.trim() || !current) return;
    const submittedTitle = title, submittedId = current.id;
    setAdding(true); try { await api(`/planning/lists/${submittedId}/items`, { method: 'POST', body: { title: submittedTitle.trim() } }); if (activeId.current === submittedId) setTitle(value => value === submittedTitle ? '' : value); await changed(); } catch (e) { notify(errorMessage(e), 'error'); } finally { setAdding(false); }
  }
  async function toggle(item: ListItem) {
    setBusy(value => [...value, item.id]);
    try { await api(`/planning/lists/${item.list_id}/items/${item.id}`, { method: 'PATCH', body: { checked: !item.checked, version: item.version } }); await changed(); }
    catch (e) { notify(errorMessage(e), 'error'); await changed(); }
    finally { setBusy(value => value.filter(id => id !== item.id)); }
  }
  async function move(item: ListItem, direction: number) {
    const index = items.findIndex(value => value.id === item.id), other = items[index + direction]; if (!other) return;
    setBusy(value => [...value, item.id]);
    try {
      await api(`/planning/lists/${item.list_id}/items/${item.id}`, { method: 'PATCH', body: { position: other.position, version: item.version } });
      await api(`/planning/lists/${other.list_id}/items/${other.id}`, { method: 'PATCH', body: { position: item.position, version: other.version } });
      await changed();
    } catch (e) { notify(errorMessage(e), 'error'); await changed(); }
    finally { setBusy(value => value.filter(id => id !== item.id)); }
  }
  const checked = items.filter(item => item.checked).length;
  return <div className="lists-layout"><aside className="list-collection"><div className="section-heading"><span className="eyebrow">МОИ СПИСКИ</span><button className="icon-button small" aria-label="Создать список" onClick={() => { if (!pro) { onUpgrade(); return; } setListName(''); setListDialog('new'); }}><Plus size={18} /></button></div>{lists.map(list => <button key={list.id} className={`collection-item ${currentId === list.id ? 'selected' : ''}`} onClick={() => { setSelected(list.id); setMenu(false); }}><span className={`collection-icon ${list.kind === 'shopping' ? 'peach' : 'green'}`}>{list.kind === 'shopping' ? <ShoppingBasket size={21} /> : <ListChecks size={21} />}</span><span><strong>{list.name}</strong><small>{list.completed_count} из {list.item_count} готово</small></span><span className="collection-count">{list.item_count - list.completed_count}</span></button>)}<button className="new-list-button" onClick={() => { if (!pro) { onUpgrade(); return; } setListName(''); setListDialog('new'); }}><Plus size={16} />Новый список {!pro && <Crown size={13} />}</button><div className="list-tip"><span>Чуть меньше в голове.</span><p>Списки помогут освободить место для того, что действительно важно.</p></div></aside>
    <section className="panel list-detail"><header className="list-detail-header"><div className="list-title-icon">{current?.kind === 'shopping' ? <ShoppingBasket size={25} /> : <ListChecks size={25} />}</div><div><h2>{current?.name || 'Списки'}</h2><p>{current?.kind === 'shopping' ? 'Всё нужное — под рукой.' : 'Большие планы из маленьких пунктов.'}</p></div>{current && !current.is_system && <div className="list-menu"><button className="icon-button" aria-label="Настройки списка" aria-expanded={menu} onClick={() => setMenu(!menu)}><MoreHorizontal size={20} /></button>{menu && <div className="action-menu"><button onClick={() => { setListName(current.name); setListDialog('rename'); setMenu(false); }}><Pencil size={14} />Переименовать</button><button className="danger-text" onClick={() => { setDeleting({ type: 'list', id: current.id, title: current.name }); setMenu(false); }}><Trash2 size={14} />Удалить список</button></div>}</div>}</header>
      {current && <><div className="list-progress"><span>{plural(checked, ['пункт выполнен', 'пункта выполнены', 'пунктов выполнено'])}</span><span>{checked} / {items.length}</span><div className="progress-track"><i style={{ width: `${items.length ? checked / items.length * 100 : 0}%` }} /></div></div>
      <form className="inline-add" onSubmit={add}><Plus size={19} /><input aria-label="Новый пункт списка" placeholder={current.kind === 'shopping' ? 'Например, овсяное молоко' : 'Добавить новый пункт'} value={title} maxLength={300} onChange={e => setTitle(e.target.value)} disabled={!current.is_editable} /><button className="button primary small" disabled={!title.trim() || adding || !current.is_editable}>{adding ? <LoaderCircle className="spinner" size={15} /> : 'Добавить'}</button></form>
      <div className="list-tools"><button className="text-button" onClick={() => setShowCompleted(!showCompleted)}><CheckCheck size={15} />{showCompleted ? 'Скрыть выполненные' : 'Показать выполненные'}</button><button className="text-button" disabled={!current.is_editable} onClick={() => setBulk(true)}><Plus size={15} />Добавить несколько</button></div></>}
      {loading ? <div className="loading-area"><LoaderCircle className="spinner" size={24} /><span>Загружаем список…</span></div> : error ? <div className="inline-error" role="alert"><p>{error}</p><button className="button secondary" onClick={() => currentId && load(currentId)}>Попробовать снова</button></div> : !items.length ? <EmptyState title="Здесь начинается ваш список" text="Добавьте первый пункт. Всё остальное можно дописать по ходу." icon={<ShoppingBasket size={27} />} /> : <div className="list-items">{items.filter(item => showCompleted || !item.checked).map(item => <div className={`list-item-row ${item.checked ? 'completed' : ''}`} key={item.id}><CheckButton checked={item.checked} busy={busy.includes(item.id) || !current?.is_editable} onClick={() => void toggle(item)} label={`${item.checked ? 'Снять отметку' : 'Отметить'}: ${item.title}`} /><button className="list-item-title" disabled={!current?.is_editable} onClick={() => setEditItem(item)}>{item.title}</button>{item.quantity && <span className="quantity-badge">{Number(item.quantity)} {item.unit || 'шт.'}</span>}<div className="item-actions"><button className="icon-button small" aria-label={`Поднять: ${item.title}`} disabled={items[0]?.id === item.id || busy.includes(item.id) || !current?.is_editable} onClick={() => void move(item, -1)}><ArrowUp size={14} /></button><button className="icon-button small" aria-label={`Опустить: ${item.title}`} disabled={items.at(-1)?.id === item.id || busy.includes(item.id) || !current?.is_editable} onClick={() => void move(item, 1)}><ArrowDown size={14} /></button><button className="icon-button small" aria-label={`Удалить: ${item.title}`} disabled={!current?.is_editable} onClick={() => setDeleting({ type: 'item', id: item.id, title: item.title })}><Trash2 size={14} /></button></div></div>)}{!showCompleted && checked === items.length && <EmptyState title="Всё готово" text="Все пункты этого списка выполнены. Можно выдохнуть." />}</div>}
    </section>
    {listDialog && <NameDialog title={listDialog === 'new' ? 'Новый список' : 'Переименовать список'} value={listName} onClose={() => setListDialog(null)} onSave={async name => { const result = await api<PlanningList>(`/planning/lists${listDialog === 'rename' ? '/' + currentId : ''}`, { method: listDialog === 'rename' ? 'PATCH' : 'POST', body: { name, ...(listDialog === 'rename' ? { version: current?.version } : {}) } }); setSelected(result.id); await refresh(); notify(listDialog === 'new' ? 'Список создан' : 'Название обновлено'); }} />}
    {editItem && <ListItemDialog item={editItem} onClose={() => setEditItem(null)} onSaved={async () => { await changed(); notify('Пункт обновлён'); }} />}
    {bulk && <BulkDialog value={bulkText} setValue={setBulkText} onClose={() => setBulk(false)} onSave={async () => { const titles = bulkText.split('\n').map(t => t.trim()).filter(Boolean); if (!titles.length || titles.length > 100) throw new Error('Добавьте от 1 до 100 строк.'); if (titles.some(t => t.length > 300)) throw new Error('Название пункта — до 300 символов.'); await api(`/planning/lists/${currentId}/items/bulk`, { method: 'POST', body: { items: titles.map(title => ({ title })) } }); setBulkText(''); await changed(); notify('Пункты добавлены'); }} />}
    {deleting && <ConfirmDialog title={deleting.type === 'list' ? 'Удалить список?' : 'Удалить пункт?'} description={`«${deleting.title}» ${deleting.type === 'list' ? 'и все его пункты будут удалены' : 'будет удалён'}. Это действие нельзя отменить.`} onClose={() => setDeleting(null)} onConfirm={async () => { await api(`/planning/lists/${deleting.type === 'list' ? deleting.id : currentId + '/items/' + deleting.id}`, { method: 'DELETE' }); if (deleting.type === 'list') { setSelected(''); await refresh(); } else await changed(); notify('Удалено'); }} />}
  </div>;
}

function NameDialog({ title, value, onClose, onSave }: { title: string; value: string; onClose: () => void; onSave: (value: string) => Promise<void> }) {
  const [name, setName] = useState(value), [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <Modal title={title} onClose={() => !busy && onClose()} className="compact-modal"><form onSubmit={async e => { e.preventDefault(); setBusy(true); try { await onSave(name.trim()); onClose(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } }}><div className="modal-body"><label className="field">Название<input className="input" autoFocus required maxLength={100} value={name} onChange={e => setName(e.target.value)} placeholder="Например, идеи для выходных" /></label>{error && <p className="field-error" role="alert">{error}</p>}</div><footer className="modal-footer"><button className="button secondary" type="button" disabled={busy} onClick={onClose}>Отмена</button><button className="button primary" disabled={busy || !name.trim()}>{busy && <LoaderCircle size={15} className="spinner" />}Сохранить</button></footer></form></Modal>;
}
function ListItemDialog({ item, onClose, onSaved }: { item: ListItem; onClose: () => void; onSaved: () => Promise<void> }) {
  const [title, setTitle] = useState(item.title), [quantity, setQuantity] = useState(item.quantity ? String(Number(item.quantity)) : ''), [unit, setUnit] = useState(item.unit || ''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <Modal title="Редактировать пункт" onClose={() => !busy && onClose()} className="compact-modal"><form onSubmit={async e => { e.preventDefault(); setBusy(true); try { await api(`/planning/lists/${item.list_id}/items/${item.id}`, { method: 'PATCH', body: { title: title.trim(), quantity: quantity ? Number(quantity) : null, unit: unit.trim() || null, version: item.version } }); await onSaved(); onClose(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } }}><div className="modal-body"><label className="field">Название<input className="input" value={title} maxLength={300} required autoFocus onChange={e => setTitle(e.target.value)} /></label><div className="form-grid"><label className="field">Количество<input className="input" type="number" min="0.0001" step="0.0001" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="1" /></label><label className="field">Единица<input className="input" value={unit} maxLength={40} onChange={e => setUnit(e.target.value)} placeholder="шт., кг, л" /></label></div>{error && <p className="field-error" role="alert">{error}</p>}</div><footer className="modal-footer"><button className="button secondary" type="button" disabled={busy} onClick={onClose}>Отмена</button><button className="button primary" disabled={busy || !title.trim()}>{busy && <LoaderCircle size={15} className="spinner" />}Сохранить</button></footer></form></Modal>;
}
function BulkDialog({ value, setValue, onClose, onSave }: { value: string; setValue: (text: string) => void; onClose: () => void; onSave: () => Promise<void> }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <Modal title="Добавить несколько пунктов" description="Каждый пункт — с новой строки." onClose={() => !busy && onClose()} className="compact-modal"><form onSubmit={async e => { e.preventDefault(); setBusy(true); try { await onSave(); onClose(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } }}><div className="modal-body"><label className="field">Ваш список<textarea className="input" autoFocus required rows={7} value={value} onChange={e => setValue(e.target.value)} placeholder={'Овсяное молоко\nАвокадо\nЦельнозерновой хлеб'} /></label>{error && <p className="field-error" role="alert">{error}</p>}</div><footer className="modal-footer"><button className="button secondary" type="button" disabled={busy} onClick={onClose}>Отмена</button><button className="button primary" disabled={busy || !value.trim()}>{busy && <LoaderCircle size={15} className="spinner" />}Добавить пункты</button></footer></form></Modal>;
}
