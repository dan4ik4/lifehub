import {useState} from 'react';
import {useAssistantPreferences} from '../lib/assistantPreferences';
import {errorMessage} from '../lib/api';
export function AssistantPreferences({userId}:{userId:string}){
 const {preferences,loading,failure,save}=useAssistantPreferences(userId);
 const [error,setError]=useState('');
 return <section className="assistant-preferences-panel"><h3>Доступ помощника</h3><p>Настройки сохраняются в аккаунте и действуют после повторного входа. Разрешения можно отозвать в любой момент.</p>
 {([['messages','Сообщения, история и планирование'],['media','Фотографии и голос'],['modules','Здоровье, финансы, цели, привычки, книги и дневник']] as const).map(([key,label])=><label className="field" key={key}><span><input type="checkbox" checked={preferences[key]} disabled={loading} onChange={e=>{setError('');void save({...preferences,[key]:e.target.checked}).catch(e=>setError(errorMessage(e)));}}/> {label}</span></label>)}
 <p>OpenAI получает разрешённые данные для ответа и выполнения ваших команд. Последние фото доступны помощнику для обсуждения. Аудиозапись не сохраняется в Life Hub.</p>
 {Boolean(error||failure)&&<p role="alert">{error||errorMessage(failure)}</p>}</section>;
}
