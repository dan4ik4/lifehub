import {useEffect, useRef, useState} from 'react';
import {FileSpreadsheet, LoaderCircle, RefreshCw} from 'lucide-react';
import {api, ApiError, errorMessage} from '../lib/api';
import {Modal} from './ui';
import {csvCents,csvTotals,formatCents} from '../lib/csvImport';
import './csv-import.css';

type Transaction = {day:string;title:string;kind:'income'|'expense';amount:string;currency:string;category:string;notes:string};
type Row = {row:number;source:string;pages?:number[];warning:string;error:string|null;selected:boolean;duplicate:boolean;transaction:Transaction|null};
type Preview = {id:string;account:string;source_format:'csv'|'pdf';status:string;expired:boolean;rows:Row[];result:{added:number;skipped_duplicates:number}|null};
type Draft = Row & {include:boolean;allow_duplicate:boolean};
const categories = {food:'Еда',transport:'Транспорт',home:'Дом',health:'Здоровье',leisure:'Досуг',other:'Другое',income:'Доход'};

export function CsvImportButton({disabled,modulesAllowed}:{disabled:boolean;modulesAllowed:boolean}) {
  const [open,setOpen]=useState(false);
  return <><button className="csv-open" type="button" disabled={disabled} onClick={()=>setOpen(true)}><FileSpreadsheet size={17}/>Выписка CSV / PDF</button>{open&&<CsvImportDialog modulesAllowed={modulesAllowed} onClose={()=>setOpen(false)}/>}</>;
}

function CsvImportDialog({onClose,modulesAllowed}:{onClose:()=>void;modulesAllowed:boolean}) {
  const [file,setFile]=useState<File|null>(null),[account,setAccount]=useState(''),[currency,setCurrency]=useState('PLN');
  const [encoding,setEncoding]=useState('utf-8-sig'),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [preview,setPreview]=useState<Preview|null>(null),[rows,setRows]=useState<Draft[]>([]),[recent,setRecent]=useState<Preview[]>([]);
  const key=useRef<string|null>(null), alive=useRef(true);
  const isPdf=file?.name.toLowerCase().endsWith('.pdf')??false;
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  function editRequest(){key.current=null;}
  function choose(value:Preview){setPreview(value);setRows(value.rows.map(r=>({...r,include:r.selected&&!r.duplicate&&!r.error,allow_duplicate:false})));setError('');}
  async function reload(){try{const result=await api<{items:Preview[]}>('/finance/csv-imports');if(alive.current)setRecent(result.items);}catch(e){if(alive.current)setError(errorMessage(e));}}
  useEffect(()=>{if(modulesAllowed)void reload();},[modulesAllowed]);
  async function prepare(){
    if(!file||busy||!consent)return;setBusy(true);setError('');
    try{
      if(!/\.(csv|pdf)$/i.test(file.name)||file.size>(isPdf?5000000:128000))throw new Error('Выберите CSV до 128 КБ или PDF до 5 МБ. В одном файле может быть до 100 операций.');
      const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('Не удалось прочитать файл.'));reader.readAsDataURL(file);});
      key.current??=crypto.randomUUID();
      const result=await api<Preview>(isPdf?'/finance/pdf-imports':'/finance/csv-imports',{method:'POST',headers:{'Idempotency-Key':key.current},body:{data,account:account.trim(),currency,...(isPdf?{}:{encoding}),consent:true}});
      if(alive.current){choose(result);setConsent(false);key.current=null;void reload();}
    }catch(e){if(e instanceof ApiError&&['model_error','invalid_csv','invalid_pdf','csv_failed'].includes(e.code))key.current=null;if(alive.current){setError(errorMessage(e));void reload();}}
    finally{if(alive.current)setBusy(false);}
  }
  function change(index:number,changes:Partial<Draft>){setRows(old=>old.map((r,i)=>i===index?{...r,...changes}:r));}
  function value(index:number,changes:Partial<Transaction>){const row=rows[index];if(row.transaction)change(index,{transaction:{...row.transaction,...changes}});}
  async function confirm(){
    if(!preview||busy)return;setBusy(true);setError('');
    try{
      const result=await api<Preview>(`/finance/csv-imports/${preview.id}/confirm`,{method:'POST',body:{rows:rows.filter(r=>r.include&&r.transaction).map(r=>({row:r.row,transaction:r.transaction,allow_duplicate:r.allow_duplicate}))}});
      if(alive.current){choose(result);window.dispatchEvent(new Event('lifehub:data-changed'));void reload();}
    }catch(e){if(alive.current)setError(errorMessage(e));}finally{if(alive.current)setBusy(false);}
  }
  const editable=preview?.status==='pending'&&!preview.expired;
  const selected=rows.filter(r=>r.include&&r.transaction);
  const totals=csvTotals(selected.map(r=>r.transaction!));
  const invalid=selected.some(r=>csvCents(r.transaction!.amount)===null||!r.transaction!.title.trim()||!/^[A-Z]{3}$/.test(r.transaction!.currency)||!r.transaction!.day);
  return <Modal title="Банковская выписка" description="Загрузите CSV или PDF, проверьте операции и подтвердите сохранение." onClose={()=>{if(!busy)onClose();}} className="csv-modal">
    <div className="modal-body csv-body">
      {!modulesAllowed&&<p className="field-error">Включите доступ к модулям в настройках помощника, чтобы разбирать выписки.</p>}
      <div className="csv-upload-grid">
        <label>Счёт<input maxLength={100} value={account} disabled={busy} placeholder="Например: mBank · основной" onChange={e=>{setAccount(e.target.value);editRequest();}}/></label>
        <label>Валюта, если её нет в файле<input value={currency} maxLength={3} disabled={busy} onChange={e=>{setCurrency(e.target.value.toUpperCase());editRequest();}}/></label>
        {!isPdf&&<label>Кодировка CSV<select value={encoding} disabled={busy} onChange={e=>{setEncoding(e.target.value);editRequest();}}><option value="utf-8-sig">UTF-8</option><option value="cp1250">Windows-1250 (польский)</option><option value="cp1251">Windows-1251 (кириллица)</option><option value="utf-16">UTF-16</option></select></label>}
        <label>Файл<input type="file" accept=".csv,.pdf,text/csv,application/pdf" disabled={busy} onChange={e=>{setFile(e.target.files?.[0]??null);setConsent(false);editRequest();}}/></label>
      </div>
      <p className="csv-help">До 100 операций. CSV: до 128 КБ, разделитель ; , или табуляция. PDF: до 5 МБ, 15 страниц, с выделяемым текстом, без пароля; сканы пока не поддерживаются. Для повторных выписок используйте то же название счёта. Валюта должна совпадать с валютой счёта.</p>
      <label className="csv-consent"><input type="checkbox" checked={consent} disabled={busy} onChange={e=>setConsent(e.target.checked)}/>Разрешаю передать текст выбранной выписки в OpenAI для распознавания операций и категорий. Предпросмотр сохраняется в Life Hub на 24 часа; подтверждённые операции — в моих финансах.</label>
      <button className="button primary" disabled={busy||!modulesAllowed||!consent||!file||!account.trim()||!/^[A-Z]{3}$/.test(currency)} onClick={()=>void prepare()}>{busy?<LoaderCircle size={16} className="spinner"/>:<FileSpreadsheet size={16}/>}Разобрать выписку</button>
      {error&&<p className="field-error" role="alert">{error}</p>}
      {recent.length>0&&<div className="csv-recent"><strong>Последние разборы</strong><button type="button" disabled={busy} className="text-button" onClick={()=>void reload()}><RefreshCw size={14}/>Обновить</button>{recent.map(p=><button className="button secondary small" disabled={busy||p.status==='processing'||p.status==='failed'} key={p.id} onClick={()=>choose(p)}>{p.account} · {(p.source_format??'csv').toUpperCase()} · {p.status==='applied'?'Сохранён':p.status==='pending'?'Просмотр':p.status==='failed'?'Ошибка':'Разбирается'}</button>)}</div>}
      {preview&&<section className="csv-preview" aria-label="Предпросмотр импорта">
        <h3>{preview.account} · {rows.length} строк</h3>
        {preview.source_format==='pdf'&&<p className="csv-warning">Операции из PDF изначально не выбраны. Сверьте дату, сумму, валюту и тип каждой операции с выпиской, затем отметьте её. Итоги, остатки и заголовки показаны отдельно и не сохраняются.</p>}
        <p className="csv-help">Категории и возможные переводы определил ИИ — проверьте их. Совпадения с ранее сохранёнными операциями не выбраны. Без ID банка одинаковые операции могут считаться совпадениями; разрешайте повтор только после проверки. Возврат отображается как поступление. Снятие флажка исключает строку.</p>
        {preview.result&&<p role="status">Сохранено: {preview.result.added}. Пропущено совпадений: {preview.result.skipped_duplicates}.</p>}
        {preview.expired&&<p className="field-error">Предпросмотр устарел. Загрузите выписку заново.</p>}
        <div className="csv-rows">{rows.map((r,index)=><article className="csv-row" key={r.row}>
          <header><label><input type="checkbox" checked={r.include} disabled={busy||!editable||!r.transaction||!!r.error||(r.duplicate&&!r.allow_duplicate)} onChange={e=>change(index,{include:e.target.checked})}/>Строка {r.row+1}{r.pages?.length?` · стр. ${r.pages.join(', ')}`:''}</label>{r.duplicate&&<span>Возможный повтор</span>}</header>
          {r.warning&&<p className="csv-warning">{r.warning}</p>}{r.error&&<p className="field-error">{r.error}</p>}
          {r.transaction&&<div className="csv-row-fields">
            <label>Дата<input type="date" value={r.transaction.day} disabled={busy||!editable} onChange={e=>value(index,{day:e.target.value})}/></label>
            <label>Описание<input maxLength={300} value={r.transaction.title} disabled={busy||!editable} onChange={e=>value(index,{title:e.target.value})}/></label>
            <label>Тип<select value={r.transaction.kind} disabled={busy||!editable} onChange={e=>value(index,{kind:e.target.value as Transaction['kind']})}><option value="expense">Расход</option><option value="income">Поступление / возврат</option></select></label>
            <label>Сумма<input inputMode="decimal" value={r.transaction.amount} disabled={busy||!editable} onChange={e=>value(index,{amount:e.target.value.replace(',','.')})}/></label>
            <label>Валюта<input maxLength={3} value={r.transaction.currency} disabled={busy||!editable} onChange={e=>value(index,{currency:e.target.value.toUpperCase()})}/></label>
            <label>Категория<select value={r.transaction.category} disabled={busy||!editable} onChange={e=>value(index,{category:e.target.value})}>{Object.entries(categories).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
          </div>}
          {r.duplicate&&r.transaction&&editable&&<label className="csv-consent"><input type="checkbox" checked={r.allow_duplicate} disabled={busy} onChange={e=>change(index,{allow_duplicate:e.target.checked,include:e.target.checked})}/>Я проверил эту строку: добавить, несмотря на совпадение</label>}
          <details><summary>{preview.source_format==='pdf'?'Текст из PDF':'Исходная строка'}</summary><p>{r.source}</p></details>
        </article>)}</div>
        {editable&&<div className="csv-totals">{Object.entries(totals).map(([code,total])=><p key={code}>{code}: поступления {formatCents(total.income)}, расходы {formatCents(total.expense)}</p>)}{invalid&&<p className="field-error">Проверьте заполнение выбранных операций: дату, описание, положительную сумму до двух знаков после запятой и валюту.</p>}</div>}
      </section>}
    </div>
    <footer className="modal-footer"><button className="button secondary" disabled={busy} onClick={onClose}>Закрыть</button>{editable&&<button className="button primary" disabled={busy||invalid||selected.length===0} onClick={()=>void confirm()}>Сохранить выбранные ({selected.length})</button>}</footer>
  </Modal>;
}
