import { t } from '../lib/language';
import {useEffect, useState} from 'react';
import {ArrowRight, BookOpen, CalendarDays, ChevronDown, CircleCheck, Dumbbell, Moon, Scale, Wallet} from 'lucide-react';
import {api, isDemo} from '../lib/api';
import {todayKey} from '../lib/dates';
import type {Notify, User} from '../lib/types';
import {refreshWorkspace} from '../lib/workspace';
import {isPro} from '../product/recordPresentation';
import {RecordEditor} from '../product/RecordEditor';
import {SleepForm,WeightForm} from '../product/health/Forms';
import {sections} from '../product/schema';
import {EntityEditor} from './EntityEditor';
import {Modal} from './ui';

const actions = [
  {key:'task', label:t("Задачу"), hint:t("Планы и сроки"), icon:CircleCheck, module:'planning'},
  {key:'transactions', label:t("Операцию"), hint:t("Расход или доход"), icon:Wallet, module:'finance'},
  {key:'workouts', label:t("Тренировку"), hint:t("Название и минуты"), icon:Dumbbell, module:'health'},
  {key:'diary', label:t("Запись в дневник"), hint:t("Мысли и события"), icon:BookOpen, module:'books'},
  {key:'event', label:t("Событие"), hint:t("Встреча или занятие"), icon:CalendarDays, module:'planning'},
  {key:'sleep', label:t("Сон"), hint:t("Время сна и пробуждения"), icon:Moon, module:'health'},
  {key:'weight', label:t("Вес"), hint:t("Измерение и дата"), icon:Scale, module:'health'},
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
    notify(t("Запись сохранена"));
    close();
  };
  if (step==='choose') {
    const shown = expanded ? available : available.slice(0,4);
    return <Modal title={t("Что добавить?")} className="quick-add-modal" onClose={close}>
      <div className="modal-body quick-add-options">
        {shown.map(({key,label,hint,icon:Icon}) => <button key={key} type="button" onClick={() => setStep(key)}>
          <span className="quick-add-icon"><Icon size={21}/></span>
          <span><strong>{label}</strong><small>{hint}</small></span>
          <ArrowRight size={17} aria-hidden="true"/>
        </button>)}
        {!shown.length && <p>{t("Сначала выберите доступный модуль в настройках.")}</p>}
        {!expanded && available.length>4 && <button className="quick-add-more" type="button" onClick={() => setExpanded(true)}>{t("Ещё записи")} <ChevronDown size={16}/></button>}
      </div>
    </Modal>;
  }
  if (!available.some(action => action.key===step)) return null;
  if (step==='sleep') return <SleepForm user={user} onClose={close} onSaved={saved}/>;
  if (step==='weight') return <WeightForm user={user} onClose={close} onSaved={saved}/>;
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
