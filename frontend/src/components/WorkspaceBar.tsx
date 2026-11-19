import {Plus, Search} from 'lucide-react';
import {openQuickAdd} from '../lib/workspace';
import type {User} from '../lib/types';
import {Avatar} from './Avatar';

export function WorkspaceBar({user,title,onProfile,onSearch}: {
  user:User; title:string; onHome:()=>void; onProfile:()=>void; onSearch?:()=>void;
}) {
  return <header className="life-mobile-header">
    <strong>{title==='Сегодня'?'':title}</strong>
    <div>
      {onSearch && <button className="icon-button" onClick={onSearch} aria-label="Найти в планах"><Search size={18}/></button>}
      {title!=='Сегодня' && <button className="life-header-add" aria-label="Добавить" onClick={()=>openQuickAdd()}><Plus size={19}/></button>}
      {title==='Сегодня' && <button className="life-rail-avatar" onClick={onProfile} aria-label="Настройки профиля"><Avatar user={user}/></button>}
    </div>
  </header>;
}
