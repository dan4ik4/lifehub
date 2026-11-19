import {MessageCircle, Plus, Search} from 'lucide-react';
import {openAssistant, openQuickAdd} from '../lib/workspace';
import type {User} from '../lib/types';
import {Avatar} from './Avatar';
import {Logo} from './ui';

export function WorkspaceBar({user, title, onHome, onProfile, onSearch}: {
  user:User;
  title:string;
  onHome:()=>void;
  onProfile:()=>void;
  onSearch?:()=>void;
}) {
  return <header className="hub-topbar">
    <button className="brand-button hub-topbar-brand" onClick={onHome} aria-label="LifeHub — главная"><Logo/></button>
    <span className="hub-topbar-title">{title}</span>
    <div className="hub-topbar-actions">
      {onSearch && <button className="button hub-bar-button" onClick={onSearch} aria-label="Найти в планах">
        <Search size={18}/><span>Поиск</span>
      </button>}
      <button className="button hub-bar-button" onClick={openAssistant} aria-label="Открыть чат с помощником" aria-haspopup="dialog">
        <MessageCircle size={18}/><span>Помощник</span>
      </button>
      <button className="button primary hub-desktop-add" onClick={() => openQuickAdd()}><Plus size={18}/>Добавить</button>
      <button className="hub-profile" onClick={onProfile} aria-label="Настройки профиля"><Avatar user={user}/></button>
    </div>
  </header>;
}
