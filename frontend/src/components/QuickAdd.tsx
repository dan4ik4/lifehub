import {useEffect, useState} from 'react';
import {ArrowRight, BookOpen, CalendarDays, ChevronDown, CircleCheck, Dumbbell, Moon, Scale, Wallet} from 'lucide-react';
import {api, isDemo} from '../lib/api';
import {todayKey} from '../lib/dates';
import type {Notify, User} from '../lib/types';
import {refreshWorkspace} from '../lib/workspace';
import {isPro, RecordEditor} from '../product/Product';
import {sections} from '../product/schema';
import {EntityEditor} from './EntityEditor';
import {Modal} from './ui';

const actions = [
  {key:'task', label:'Задачу', hint:'Планы и сроки', icon:CircleCheck, module:'planning'},
  {key:'transactions', label:'Операцию', hint:'Расход или доход', icon:Wallet, module:'finance'},
  {key:'workouts', label:'Тренировку', hint:'Название и минуты', icon:Dumbbell, module:'health'},
  {key:'diary', label:'Запись в дневник', hint:'Мысли и события', icon:BookOpen, module:'books'},
  {key:'event', label:'Событие', hint:'Встреча или занятие', icon:CalendarDays, module:'planning'},
  {key:'sleep', label:'Сон', hint:'Время сна и пробуждения', icon:Moon, module:'health'},
  {key:'weight', label:'Вес', hint:'Измерение и дата', icon:Scale, module:'health'},
] as const;

export function QuickAdd({user, notify}: {user:User; notify:Notify}) {
  const [step,setStep] = useState<string|null>(null);
  const [expanded,setExpanded] = useState(false);
  const pro = isPro(user);
  const available = actions.filter(action => isDemo()
    ? action.module==='planning'
    : pro || user.free_modules.includes(action.module));

  useEffect(() => {
    const open = (event:Event) => {
      setExpanded(false);
      setStep((event as CustomEvent<string|undefined>).detail??'choose');
    };
    window.addEventListener('lifehub:quick-add',open);
    return () => window.removeEventListener('lifehub:quick-add',open);
  }, []);

  if (!step) return null;
  const close = () => setStep(null);
  const saved = () => {
    refreshWorkspace();
    notify('Запись сохранена');
    close();
  };
  if (step==='choose') {
    const shown = expanded ? available : available.slice(0,4);
    return <Modal title="Что добавить?" className="quick-add-modal" onClose={close}>
      <div className="modal-body quick-add-options">
        {shown.map(({key,label,hint,icon:Icon}) => <button key={key} type="button" onClick={() => setStep(key)}>
          <span className="quick-add-icon"><Icon size={21}/></span>
          <span><strong>{label}</strong><small>{hint}</small></span>
          <ArrowRight size={17} aria-hidden="true"/>
        </button>)}
        {!shown.length && <p>Сначала выберите доступный модуль в настройках.</p>}
        {!expanded && available.length>4 && <button className="quick-add-more" type="button" onClick={() => setExpanded(true)}>Ещё записи <ChevronDown size={16}/></button>}
      </div>
    </Modal>;
  }
  if (!available.some(action => action.key===step)) return null;
  if (step==='task' || step==='event') {
    return <EntityEditor key={step} kind={step} day={todayKey(user.timezone)} timezone={user.timezone}
      pro={pro} onClose={close} onSaved={saved} onUpgrade={() => {
        close();
        window.dispatchEvent(new Event('lifehub:show-plan'));
      }}/>;
  }
  const section = Object.values(sections).flat().find(item => item.key===step);
  if (!section) return null;
  return <RecordEditor key={step} section={section} initial={{}} user={user} onClose={close} onSave={async body => {
    await api(section.path,{method:'POST',body});
    saved();
  }}/>;
}
