import { t } from '../lib/language';
import {useEffect, useRef, useState} from 'react';
import {FileSpreadsheet, LoaderCircle, RefreshCw} from 'lucide-react';
import {api, ApiError, errorMessage} from '../lib/api';
import {Modal} from './ui';
import {csvCents,csvTotals,formatCents} from '../lib/csvImport';
import './csv-import.css';

type Transaction = {day:string;title:string;kind:'income'|'expense';amount:string;currency:string;category:string;notes:string};
type Row = {row:number;source:string;pages?:number[];warning:string;error:string|null;selected:boolean;duplicate:boolean;transaction:Transaction|null};
type Preview = {id:string;account:string;source_format:'csv'|'pdf';status:string;expired:boolean;rows:Row[];
  result:{added?:number;skipped_duplicates?:number;error_code?:string}|null};
type Draft = Row & {include:boolean;allow_duplicate:boolean};
const categories = {food:t("Еда"),transport:t("Транспорт"),home:t("Дом"),health:t("Здоровье"),leisure:t("Досуг"),other:t("Другое"),income:t("Доход")};
const pageSize = 25;
const pdfLimit = 25_000_000;
const importPath = '/finance/csv-imports';
const pdfErrors: Record<string, string> = {
  pdf_too_large:t('Файл PDF больше 25 МБ.'),
  pdf_too_many_pages:t('В PDF больше 100 страниц.'),
  pdf_content_too_large:t('Текст выписки превышает предел обработки PDF.'),
  pdf_extraction_timeout:t('Не удалось извлечь текст из PDF вовремя. Попробуйте выгрузить файл из банка ещё раз.'),
};

export function CsvImportButton({disabled,modulesAllowed}:{disabled:boolean;modulesAllowed:boolean}) {
  const [open,setOpen]=useState(false);
  return <><button className="csv-open" type="button" disabled={disabled} onClick={()=>setOpen(true)}><FileSpreadsheet size={17}/>{t("Выписка CSV / PDF")}</button>{open&&<CsvImportDialog modulesAllowed={modulesAllowed} onClose={()=>setOpen(false)}/>}</>;
}

export function CsvImportDialog({onClose,modulesAllowed,missingPlanning=false}:{onClose:()=>void;modulesAllowed:boolean;missingPlanning?:boolean}) {
  const [file,setFile]=useState<File|null>(null),[account,setAccount]=useState(''),[currency,setCurrency]=useState('PLN');
  const [encoding,setEncoding]=useState('utf-8-sig'),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [preview,setPreview]=useState<Preview|null>(null),[rows,setRows]=useState<Draft[]>([]),[recent,setRecent]=useState<Preview[]>([]);
  const [page,setPage]=useState(0);
  const key=useRef<string|null>(null), alive=useRef(true);
  const isPdf=file?.name.toLowerCase().endsWith('.pdf')??false;
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  function editRequest(){key.current=null;}
  function choose(value:Preview){setPreview(value);setRows(value.rows.map(r=>({...r,include:r.selected&&!r.duplicate&&!r.error,allow_duplicate:false})));setPage(0);setError('');}
  async function reload(){try{const result=await api<{items:Preview[]}>(`${importPath}?summary=true`);if(alive.current)setRecent(result.items);}catch(e){if(alive.current)setError(errorMessage(e));}}
  useEffect(()=>{if(modulesAllowed)void reload();},[modulesAllowed]);
  const processing = preview?.status==='processing' ? preview.id : null;
  useEffect(()=>{
    if(!processing)return;
    const controller=new AbortController();
    let timer=0;
    const check=async()=>{
      try{
        const result=await api<Preview>(`${importPath}/${processing}`,{signal:controller.signal});
        if(controller.signal.aborted)return;
        if(result.status!=='processing'){choose(result);void reload();return;}
        setError('');
      }catch(cause){
        if(controller.signal.aborted)return;
        setError(errorMessage(cause));
        if(cause instanceof ApiError && cause.status===404){setPreview(null);void reload();return;}
      }
      timer=window.setTimeout(check,3000);
    };
    timer=window.setTimeout(check,1500);
    return()=>{window.clearTimeout(timer);controller.abort();};
  },[processing]);
  async function openImport(id:string){
    setBusy(true);setError('');
    try{const result=await api<Preview>(`${importPath}/${id}`);if(alive.current)choose(result);}
    catch(cause){if(alive.current)setError(errorMessage(cause));}
    finally{if(alive.current)setBusy(false);}
  }
  async function prepare(){
    if(!file||busy||!consent)return;setBusy(true);setError('');
    try{
      if(!/\.(csv|pdf)$/i.test(file.name))throw new Error(t('Выберите файл CSV или PDF.'));
      if(file.size>(isPdf?pdfLimit:128000))throw new Error(isPdf?pdfErrors.pdf_too_large:t('Файл CSV больше 128 КБ.'));
      const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error(t("Не удалось прочитать файл.")));reader.readAsDataURL(file);});
      key.current??=crypto.randomUUID();
      const result=await api<Preview>(isPdf?'/finance/pdf-imports':'/finance/csv-imports',{method:'POST',headers:{'Idempotency-Key':key.current},body:{data,account:account.trim(),currency,...(isPdf?{}:{encoding}),consent:true}});
      if(alive.current){choose(result);setConsent(false);key.current=null;void reload();}
    }catch(e){if(e instanceof ApiError&&['model_error','invalid_csv','invalid_pdf','csv_failed'].includes(e.code))key.current=null;if(alive.current){setError(e instanceof ApiError?(pdfErrors[e.code]??errorMessage(e)):errorMessage(e));void reload();}}
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
  const previewReady=preview?.status==='pending'||preview?.status==='applied';
  const pageStart=page*pageSize, pageCount=Math.ceil(rows.length/pageSize);
  const pageRows=rows.slice(pageStart,pageStart+pageSize);
  const selected=rows.filter(r=>r.include&&r.transaction);
  const totals=csvTotals(selected.map(r=>r.transaction!));
  const invalid=selected.some(r=>csvCents(r.transaction!.amount)===null||!r.transaction!.title.trim()||!/^[A-Z]{3}$/.test(r.transaction!.currency)||!r.transaction!.day);
  return <Modal title={t("Банковская выписка")} description={t("Загрузите CSV или PDF, проверьте операции и подтвердите сохранение.")} onClose={()=>{if(!busy)onClose();}} className="csv-modal">
    <div className="modal-body csv-body">
      {!modulesAllowed&&<p className="field-error">{missingPlanning
        ? t("Для разбора выписок через помощника нужен доступ к модулю «Планирование».")
        : t("Откройте помощника и включите обработку сообщений и данных модулей в его настройках.")}</p>}
      <div className="csv-upload-grid">
        <label>{t("Счёт")}<input maxLength={100} value={account} disabled={busy} placeholder={t("Например: mBank · основной")} onChange={e=>{setAccount(e.target.value);editRequest();}}/></label>
        <label>{t("Валюта, если её нет в файле")}<input value={currency} maxLength={3} disabled={busy} onChange={e=>{setCurrency(e.target.value.toUpperCase());editRequest();}}/></label>
        {!isPdf&&<label>{t("Кодировка CSV")}<select value={encoding} disabled={busy} onChange={e=>{setEncoding(e.target.value);editRequest();}}><option value="utf-8-sig">UTF-8</option><option value="cp1250">{t("Windows-1250 (польский)")}</option><option value="cp1251">{t("Windows-1251 (кириллица)")}</option><option value="utf-16">UTF-16</option></select></label>}
        <label>{t("Файл")}<input type="file" accept=".csv,.pdf,text/csv,application/pdf" disabled={busy} onChange={e=>{setFile(e.target.files?.[0]??null);setConsent(false);editRequest();}}/></label>
      </div>
      <p className="csv-help">{t('Загрузите месячную выписку одним PDF с выделяемым текстом, до 25 МБ и 100 страниц. Для CSV действует предел 128 КБ и 100 операций.')}</p>
      <label className="csv-consent"><input type="checkbox" checked={consent} disabled={busy} onChange={e=>setConsent(e.target.checked)}/>{t("Разрешаю передать текст выбранной выписки в OpenAI для распознавания операций и категорий. Предпросмотр сохраняется в Life Hub на 24 часа; подтверждённые операции — в моих финансах.")}</label>
      <button className="button primary" disabled={busy||!modulesAllowed||!consent||!file||!account.trim()||!/^[A-Z]{3}$/.test(currency)} onClick={()=>void prepare()}>{busy?<LoaderCircle size={16} className="spinner"/>:<FileSpreadsheet size={16}/>}{t("Разобрать выписку")}</button>
      {error&&<p className="field-error" role="alert">{error}</p>}
      {recent.length>0&&<div className="csv-recent"><strong>{t("Последние разборы")}</strong><button type="button" disabled={busy} className="text-button" onClick={()=>void reload()}><RefreshCw size={14}/>{t("Обновить")}</button>{recent.map(p=><button className="button secondary small" disabled={busy} key={p.id} onClick={()=>void openImport(p.id)}>{p.account} · {(p.source_format??'csv').toUpperCase()} · {p.status==='applied'?t("Сохранён"):p.status==='pending'?t("Просмотр"):p.status==='failed'?t("Ошибка"):t("Разбирается")}</button>)}</div>}
      {processing&&<p role="status" className="csv-help">{t('Выписка обрабатывается по частям. Можно закрыть окно и вернуться к ней в списке последних разборов.')}</p>}
      {preview?.status==='failed'&&<p role="alert" className="field-error">{pdfErrors[preview.result?.error_code??'']??t('Не удалось разобрать выписку целиком. Повторите загрузку. Операции пока не сохранены.')}</p>}
      {preview&&previewReady&&<section className="csv-preview" aria-label={t("Предпросмотр импорта")}>
        <h3>{preview.account} · {rows.length} {t("строк")}</h3>
        {preview.source_format==='pdf'&&<p className="csv-warning">{t("Операции из PDF изначально не выбраны. Сверьте дату, сумму, валюту и тип каждой операции с выпиской, затем отметьте её. Итоги, остатки и заголовки показаны отдельно и не сохраняются.")}</p>}
        <p className="csv-help">{t("Категории и возможные переводы определил ИИ — проверьте их. Совпадения с ранее сохранёнными операциями не выбраны. Без ID банка одинаковые операции могут считаться совпадениями; разрешайте повтор только после проверки. Возврат отображается как поступление. Снятие флажка исключает строку.")}</p>
        {preview.status==='applied'&&preview.result&&<p role="status">{t("Сохранено:")} {preview.result.added}{t(". Пропущено совпадений:")} {preview.result.skipped_duplicates}.</p>}
        {preview.expired&&<p className="field-error">{t("Предпросмотр устарел. Загрузите выписку заново.")}</p>}
        {pageCount>1&&<nav className="csv-pages" aria-label={t('Страницы предпросмотра')}>
          <button type="button" className="button secondary" disabled={page===0} onClick={()=>setPage(page-1)}>{t('Назад')}</button>
          <span>{t('Страница {0} из {1}',page+1,pageCount)}</span>
          <button type="button" className="button secondary" disabled={page+1===pageCount} onClick={()=>setPage(page+1)}>{t('Вперёд')}</button>
          {editable&&preview.source_format==='pdf'&&<button type="button" className="text-button" disabled={busy||!pageRows.some(r=>r.transaction&&!r.duplicate&&!r.error&&!r.include)}
            onClick={()=>setRows(current=>current.map((row,i)=>i>=pageStart&&i<pageStart+pageSize&&row.transaction&&!row.duplicate&&!row.error?{...row,include:true}:row))}>
            {t('Отметить операции на этой странице')}
          </button>}
        </nav>}
        <div className="csv-rows" key={page}>{pageRows.map((r,localIndex)=>{const index=pageStart+localIndex;return <article className="csv-row" key={r.row}>
          <header><label><input type="checkbox" checked={r.include} disabled={busy||!editable||!r.transaction||!!r.error||(r.duplicate&&!r.allow_duplicate)} onChange={e=>change(index,{include:e.target.checked})}/>{t("Строка")} {r.row+1}{r.pages?.length?t(" · стр. {0}", r.pages.join(', ')):''}</label>{r.duplicate&&<span>{t("Возможный повтор")}</span>}</header>
          {r.warning&&<p className="csv-warning">{r.warning}</p>}{r.error&&<p className="field-error">{r.error}</p>}
          {r.transaction&&<div className="csv-row-fields">
            <label>{t("Дата")}<input type="date" value={r.transaction.day} disabled={busy||!editable} onChange={e=>value(index,{day:e.target.value})}/></label>
            <label>{t("Описание")}<input maxLength={300} value={r.transaction.title} disabled={busy||!editable} onChange={e=>value(index,{title:e.target.value})}/></label>
            <label>{t("Тип")}<select value={r.transaction.kind} disabled={busy||!editable} onChange={e=>value(index,{kind:e.target.value as Transaction['kind']})}><option value="expense">{t("Расход")}</option><option value="income">{t("Поступление / возврат")}</option></select></label>
            <label>{t("Сумма")}<input inputMode="decimal" value={r.transaction.amount} disabled={busy||!editable} onChange={e=>value(index,{amount:e.target.value.replace(',','.')})}/></label>
            <label>{t("Валюта")}<input maxLength={3} value={r.transaction.currency} disabled={busy||!editable} onChange={e=>value(index,{currency:e.target.value.toUpperCase()})}/></label>
            <label>{t("Категория")}<select value={r.transaction.category} disabled={busy||!editable} onChange={e=>value(index,{category:e.target.value})}>{Object.entries(categories).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
          </div>}
          {r.duplicate&&r.transaction&&editable&&<label className="csv-consent"><input type="checkbox" checked={r.allow_duplicate} disabled={busy} onChange={e=>change(index,{allow_duplicate:e.target.checked,include:e.target.checked})}/>{t("Я проверил эту строку: добавить, несмотря на совпадение")}</label>}
          <details><summary>{preview.source_format==='pdf'?t("Текст из PDF"):t("Исходная строка")}</summary><p>{r.source}</p></details>
        </article>;})}</div>
        {editable&&<div className="csv-totals">{Object.entries(totals).map(([code,total])=><p key={code}>{code}{t(": поступления")} {formatCents(total.income)}{t(", расходы")} {formatCents(total.expense)}</p>)}{invalid&&<p className="field-error">{t("Проверьте заполнение выбранных операций: дату, описание, положительную сумму до двух знаков после запятой и валюту.")}</p>}</div>}
      </section>}
    </div>
    <footer className="modal-footer"><button className="button secondary" disabled={busy} onClick={onClose}>{t("Закрыть")}</button>{editable&&<button className="button primary" disabled={busy||invalid||selected.length===0} onClick={()=>void confirm()}>{t("Сохранить выбранные (")}{selected.length})</button>}</footer>
  </Modal>;
}
