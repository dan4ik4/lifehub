import { t } from '../lib/language';
import {Plus, Search} from 'lucide-react';
import {openQuickAdd} from '../lib/workspace';
import type {User} from '../lib/types';
import {Avatar} from './Avatar';

export function WorkspaceBar({user,title,onProfile,onSearch}: {
  user:User; title:string; onHome:()=>void; onProfile:()=>void; onSearch?:()=>void;
}) {
  const isToday = title === t('Сегодня');
  return <header className="life-mobile-header">
    <strong>{isToday ? '' : title}</strong>
    <div>
      {onSearch && <button className="icon-button" onClick={onSearch} aria-label={t("Найти в планах")}><Search size={18}/></button>}
      {!isToday && <button className="life-header-add" aria-label={t("Добавить")} onClick={()=>openQuickAdd()}><Plus size={19}/></button>}
      {isToday && <button className="life-rail-avatar" onClick={onProfile} aria-label={t("Настройки профиля")}><Avatar user={user}/></button>}
    </div>
  </header>;
}
