import {Children, createContext, isValidElement, useContext, useRef, useState} from 'react';
import type {ReactElement, ReactNode} from 'react';
import {ChevronDown, ChevronUp, GripVertical, Layers} from 'lucide-react';
import {t} from '../lib/language';
import {Modal} from './ui';
import './overview-widgets.css';

type Order = Record<string, string[]>;
type Group = {id: string; title: string; widgets: Record<string, string>};
type LayoutProps = {account: string; page: string; groups: Group[]; children: ReactNode};
const WidgetOrder = createContext<Order>({});

function readOrder(key: string): Order {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, ids]) =>
      Array.isArray(ids) && ids.every(id => typeof id === 'string')));
  } catch { return {}; }
}

export function widgetOrder(saved: string[] | undefined, ids: string[]): string[] {
  return [...new Set([...(saved ?? []).filter(id => ids.includes(id)), ...ids])];
}

export function moveWidget(order: string[], id: string, target: string): string[] {
  const from = order.indexOf(id), to = order.indexOf(target);
  if (from < 0 || to < 0 || from === to) return order;
  const next = order.filter(item => item !== id);
  next.splice(to, 0, id);
  return next;
}

export function OverviewWidgets(props: LayoutProps) {
  const storageKey = 'lifehub.widget-order.' + props.page + '.' + props.account;
  return <Layout key={storageKey} storageKey={storageKey} {...props}/>;
}

function Layout({storageKey, groups, children}: LayoutProps & {storageKey: string}) {
  const [saved, setSaved] = useState(() => readOrder(storageKey));
  const [editing, setEditing] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const drag = useRef<{group: string; id: string} | null>(null);
  const order = Object.fromEntries(groups.map(group => [
    group.id, widgetOrder(saved[group.id], Object.keys(group.widgets)),
  ]));
  const move = (group: Group, id: string, target: string) => {
    const original = order[group.id], next = moveWidget(original, id, target);
    if (next === original) return;
    const result = {...saved, [group.id]: next};
    setSaved(result);
    try { localStorage.setItem(storageKey, JSON.stringify(result)); } catch { /* Keep this tab usable. */ }
    setAnnouncement(t("{0}, позиция {1} из {2}", group.widgets[id], next.indexOf(id) + 1, next.length));
  };
  return <WidgetOrder.Provider value={order}>
    {groups.some(group => order[group.id].length > 1) && <div className="overview-widget-toolbar"><button type="button" className="life-text-link" onClick={() => setEditing(true)}>
      <Layers size={16}/>{t("Настроить виджеты")}
    </button></div>}
    {children}
    {editing && <Modal title={t("Настроить виджеты")} onClose={() => setEditing(false)}>
      <div className="modal-body overview-widget-order">
        {groups.filter(group => order[group.id].length > 1).map(group => <section key={group.id}>
          <h3>{group.title}</h3>
          <ol>{order[group.id].map((id, index, ids) => {
            const title = group.widgets[id];
            return <li key={id} draggable onDragStart={event => {
              drag.current = {group: group.id, id};
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', title);
            }} onDragOver={event => { if (drag.current?.group === group.id) event.preventDefault(); }}
              onDrop={event => {
                event.preventDefault();
                if (drag.current?.group === group.id) move(group, drag.current.id, id);
                drag.current = null;
              }} onDragEnd={() => { drag.current = null; }}
              onKeyDown={event => {
                if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
                event.preventDefault();
                move(group, id, ids[index + (event.key === 'ArrowUp' ? -1 : 1)]);
              }}>
              <GripVertical size={16} aria-hidden="true"/><span>{title}</span>
              <button type="button" className="icon-button" aria-label={t("Поднять: {0}", title)}
                aria-disabled={index === 0} onClick={() => move(group, id, ids[index - 1])}><ChevronUp size={17}/></button>
              <button type="button" className="icon-button" aria-label={t("Опустить: {0}", title)}
                aria-disabled={index === ids.length - 1} onClick={() => move(group, id, ids[index + 1])}><ChevronDown size={17}/></button>
            </li>;
          })}</ol>
        </section>)}
        <span role="status" className="sr-only">{announcement}</span>
        <p>{t("Выбор хранится на этом устройстве.")}</p>
      </div>
      <footer className="modal-footer"><button className="button primary" onClick={() => setEditing(false)}>{t("Готово")}</button></footer>
    </Modal>}
  </WidgetOrder.Provider>;
}

// Keep the cards themselves as grid children so their sizing, focus and form state survive reordering.
export function WidgetGroup({name, children}: {name: string; children: ReactNode}) {
  const order = useContext(WidgetOrder)[name];
  const cards = new Map<string, ReactElement>();
  Children.forEach(children, card => {
    if (isValidElement(card) && card.key !== null) cards.set(String(card.key), card);
  });
  return widgetOrder(order, Array.from(cards.keys())).map(id => cards.get(id));
}
