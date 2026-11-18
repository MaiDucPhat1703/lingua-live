'use strict';
const $ = id => document.getElementById(id);
const SpeechAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
const seeds = [
  {term:'Cần Thơ',aliases:['can tho','cần thơ']},
  {term:'UEH',aliases:['u e h']},
  {term:'UII',aliases:['u i i']},
  {term:'Võ Thị Sáu',aliases:['vo thi sau']},
];
function readLocal(key,fallback){try{return JSON.parse(localStorage.getItem(key))||fallback}catch{return fallback}}
let terms = readLocal('lingua-terms',seeds);
let sessions = readLocal('lingua-sessions',[]);
let current = freshSession();
let active=false,recognition=null,recorder=null,stream=null,startClock=0,elapsed=0,timer=null,chunks=[],audioUrl=null;
let pending = Promise.resolve();
let recognitionFailures=0;
let finalizing=false;
let localCapture=null, audioPending=0, localReady=false, audioQueue=Promise.resolve();
const dbPromise = new Promise(resolve=>{
  if(!window.indexedDB){resolve(null);return}
  const request=indexedDB.open('lingua-audio',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('recordings');
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>resolve(null);
});
async function storeAudio(id,blob){const db=await dbPromise;if(!db)return false;return new Promise(resolve=>{const tx=db.transaction('recordings','readwrite');tx.objectStore('recordings').put(blob,id);tx.oncomplete=()=>resolve(true);tx.onerror=()=>resolve(false)})}
async function getAudio(id){const db=await dbPromise;if(!db)return null;return new Promise(resolve=>{const req=db.transaction('recordings').objectStore('recordings').get(id);req.onsuccess=()=>resolve(req.result);req.onerror=()=>resolve(null)})}
async function removeAudio(id){const db=await dbPromise;if(!db)return;db.transaction('recordings','readwrite').objectStore('recordings').delete(id)}
function freshSession(){return{id:crypto.randomUUID(),name:'Cuộc trò chuyện mới',date:new Date().toISOString(),lang:'vi',segments:[],elapsed:0}}
function message(text){$('message').textContent=text;$('message').hidden=!text}
function save(){
  current.name=$('sessionName').value.trim()||'Cuộc trò chuyện mới';
  if(!current.segments.length&&!current.elapsed)return;
  const copy=structuredClone(current);
  const index=sessions.findIndex(item=>item.id===copy.id);
  if(index<0)sessions.unshift(copy);else sessions[index]=copy;
  try{localStorage.setItem('lingua-sessions',JSON.stringify(sessions))}catch{message('Bộ nhớ trình duyệt đã đầy. Hãy xuất bản chép lời để lưu lại.')}
}
function node(tag,text,className){const el=document.createElement(tag);el.textContent=text;if(className)el.className=className;return el}
function timeLabel(seconds){return String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(Math.floor(seconds%60)).padStart(2,'0')}
function normalizedKey(text){return text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D').toLowerCase()}
function phraseRegex(value){return new RegExp('(?<![\\p{L}\\p{N}])'+value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?![\\p{L}\\p{N}])','giu')}
function canonicalize(text){
  let result=text;
  const entries=terms.flatMap(item=>[item.term,...item.aliases].map(alias=>({alias,term:item.term}))).sort((a,b)=>b.alias.length-a.alias.length);
  for(const {alias,term} of entries){if(alias.trim())result=result.replace(phraseRegex(alias),()=>term)}
  return result;
}
function renderTerms(){
  $('glossaryChips').replaceChildren(...terms.slice(0,7).map(item=>node('span',item.term)));
  const list=$('termsList');list.replaceChildren();
  for(const item of terms){
    const row=node('div','','term-row'),info=node('div','');
    info.append(node('strong',item.term),node('small',item.aliases.join(' · ')||'Giữ nguyên trong bản dịch'));
    const remove=node('button','Xóa');remove.type='button';remove.onclick=()=>{
      terms=terms.filter(term=>term!==item);
      try{localStorage.setItem('lingua-terms',JSON.stringify(terms))}catch{message('Không lưu được từ điển trên thiết bị.')}
      renderTerms();
    };
    row.append(info,remove);list.append(row);
  }
}
function translationView(segment){
  const card=node('article','','segment'),meta=node('div','','meta');
  meta.append(node('span',timeLabel(segment.at)),node('span',current.lang==='vi'?'ENGLISH':'TIẾNG VIỆT'));
  card.append(meta);
  if(segment.translated)card.append(node('p',segment.translated));
  else if(segment.error){
    card.append(node('p',segment.error,'failed'));
    const retry=node('button','Thử dịch lại');retry.onclick=()=>{segment.error='';render();queueTranslation(current,segment)};card.append(retry);
  }else card.append(node('p',segment.pending?'Đang dịch…':'Chưa bật dịch cho đoạn này.','translating'));
  return card;
}
function render(){
  $('srcBadge').textContent=current.lang.toUpperCase();
  $('dstBadge').textContent=current.lang==='vi'?'EN':'VI';
  $('targetLabel').textContent=current.lang==='vi'?'English':'Tiếng Việt';
  $('segmentCount').textContent=current.segments.length+' đoạn';
  if(!current.segments.length)return;
  const source=$('sourceSegments'),target=$('targetSegments');
  const nearBottom=source.scrollTop+source.clientHeight>=source.scrollHeight-100;
  source.replaceChildren();target.replaceChildren();
  for(const segment of current.segments){
    const card=node('article','','segment'),meta=node('div','','meta'),edit=node('button','Sửa');
    edit.onclick=()=>{
      const textarea=document.createElement('textarea');textarea.value=segment.text;textarea.setAttribute('aria-label','Sửa lời gốc');
      const apply=node('button','Lưu và dịch lại');
      apply.onclick=()=>{
        const text=textarea.value.trim();if(!text)return;
        segment.text=canonicalize(text);segment.revision=(segment.revision||0)+1;
        segment.translated='';segment.error='';render();save();queueTranslation(current,segment);
      };
      card.replaceChildren(meta,textarea,apply);textarea.focus();
    };
    meta.append(node('span',timeLabel(segment.at)),node('span','Người nói'),edit);
    card.append(meta,node('p',segment.text));source.append(card);target.append(translationView(segment));
  }
  if(nearBottom){source.scrollTop=source.scrollHeight;target.scrollTop=target.scrollHeight}
}
function enqueueText(text,at){
  const clean=canonicalize(text.trim());if(!clean)return;
  const segment={id:crypto.randomUUID(),text:clean,translated:'',at,revision:0,pending:false,error:''};
  current.segments.push(segment);render();save();queueTranslation(current,segment);
}
function splitBytes(text,limit=450){
  const parts=[];let piece='';
  for(const character of text){if(new TextEncoder().encode(piece+character).length>limit){parts.push(piece);piece=''}piece+=character}
  if(piece)parts.push(piece);
  return parts;
}
function decodeHtml(text){const parsed=new DOMParser().parseFromString(text,'text/html');return parsed.body.textContent||''}
async function translateChunk(text,lang){
  const query=new URLSearchParams({q:text,langpair:lang==='vi'?'vi|en':'en|vi'});
  const response=await fetch('https://api.mymemory.translated.net/get?'+query,{signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('Dịch vụ dịch tạm thời không phản hồi.');
  const data=await response.json();
  if(Number(data.responseStatus)!==200||data.quotaFinished)throw Error(data.quotaFinished?'Đã hết hạn mức dịch miễn phí trong ngày.':String(data.responseDetails||'Dịch vụ chưa dịch được câu này.'));
  if(!data.responseData?.translatedText)throw Error('Dịch vụ trả về bản dịch trống.');
  return decodeHtml(data.responseData.translatedText);
}
async function translateText(text,lang,engine=$('engine').value){
  if(engine==='local'){
    const response=await fetch('/api/translate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,lang,terms:terms.map(item=>item.term)}),signal:AbortSignal.timeout(120000)});
    const data=await response.json();
    if(!response.ok)throw Error(data.detail||'Chưa dịch được trên máy. Kiểm tra cửa sổ xử lý.');
    return canonicalize(data.text);
  }
  const protectedTerms=[...terms].sort((a,b)=>b.term.length-a.term.length);
  const replacements=[];
  let masked=text;
  for(const item of protectedTerms){
    masked=masked.replace(phraseRegex(item.term),()=>{
      const token='ZXQN'+replacements.length+'QXZ';replacements.push({token,term:item.term});return token;
    });
  }
  const translated=[];
  for(const part of splitBytes(masked))translated.push(await translateChunk(part,lang));
  let output=translated.join('');
  for(const item of replacements){
    const pattern=new RegExp(item.token,'gi');
    if(!pattern.test(output))throw Error('Bản dịch chưa giữ được tên riêng. Hãy sửa câu ngắn hơn và thử lại.');
    output=output.replace(pattern,()=>item.term);
  }
  return canonicalize(output);
}
function queueTranslation(session,segment){
  if(!$('translateToggle').checked)return;
  const revision=segment.revision,lang=session.lang;
  const engine=$('engine').value;
  segment.pending=true;if(current.id===session.id)render();
  pending=pending.then(async()=>{
    try{
      const result=await translateText(segment.text,lang,engine);
      if(segment.revision!==revision)return;
      segment.translated=result;segment.error='';
    }catch(error){if(segment.revision===revision)segment.error=error.message||'Không dịch được. Kiểm tra mạng rồi thử lại.'}
    finally{
      if(segment.revision===revision)segment.pending=false;
      if(current.id===session.id){render();save()}
      else {
        const saved=sessions.find(item=>item.id===session.id),row=saved?.segments.find(item=>item.id===segment.id);
        if(row&&row.revision===revision){Object.assign(row,segment);try{localStorage.setItem('lingua-sessions',JSON.stringify(sessions))}catch{}}
      }
    }
  });
}
function elapsedSeconds(){return elapsed+(active?(Date.now()-startClock)/1000:0)}
function updateRecordUI(){
  $('recordBtn').hidden=active;$('stopBtn').hidden=!active;
  $('sourceLang').disabled=active||current.segments.length>0;
  $('engine').disabled=active||audioPending>0;
  $('newSession').disabled=audioPending>0;
  document.body.classList.toggle('recording',active);
  $('recordState').textContent=active?'Đang lắng nghe':'Sẵn sàng cho cuộc trò chuyện';
  $('recordHint').textContent=active?'Nói rõ ràng, để micro gần người đang nói.':'Micro sẽ được bật khi bạn bắt đầu.';
}
async function begin(){
  if($('engine').value==='cloud'&&!SpeechAPI){message('Trình duyệt này chưa hỗ trợ nhận dạng giọng nói. Hãy mở bằng Chrome hoặc Edge trên máy tính. Bạn vẫn có thể thử dịch bằng văn bản.');return}
  if($('engine').value==='local'&&!localReady){message('Mở bản chạy trên máy và bấm Chuẩn bị mô hình trước khi ghi âm.');return}
  if(finalizing){message('Đang hoàn tất bản ghi âm. Vui lòng đợi một chút.');return}
  $('recordBtn').disabled=true;message('');
  try{
    stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
    recognitionFailures=0;active=true;startClock=Date.now();chunks=[];
    if(window.MediaRecorder){
      recorder=new MediaRecorder(stream);
      const recordingSession=current;
      recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data)};
      const recordingMime=recorder.mimeType||'audio/webm';
      const recordingChunks=chunks;
      recorder.onstop=async()=>{
        try {
          const blob=new Blob(recordingChunks,{type:recordingMime});
          if(blob.size){
            if(current.id===recordingSession.id)showAudio(blob);
            if(!await storeAudio(recordingSession.id,blob))message('Ghi âm đã sẵn sàng. Hãy tải xuống vì thiết bị chưa lưu được âm thanh.');
          }
        } finally {finalizing=false;$('recordBtn').disabled=false}
      };
      recorder.start(1000);
    }else message('Thiết bị có thể chép lời nhưng chưa hỗ trợ lưu âm thanh.');
    if($('engine').value==='local'){
      const capturedSession=current;
      let offset=elapsed;
      localCapture=new LinguaLocalCapture((wav,seconds)=>{
        const at=offset;offset+=seconds;
        queueLocalAudio(wav,at,capturedSession);
      });
      await localCapture.start(stream);
    }else startRecognition();
    timer=setInterval(()=>{$('duration').textContent=timeLabel(elapsedSeconds());current.elapsed=elapsedSeconds()},500);
    updateRecordUI();
  }catch(error){end();message(error.name==='NotAllowedError'?'Chưa được cấp quyền micro. Bấm biểu tượng cạnh địa chỉ web để cho phép micro.':'Không mở được micro: '+error.message)}
  finally{$('recordBtn').disabled=finalizing}
}
function startRecognition(){
  if(!active)return;
  recognition=new SpeechAPI();
  recognition.lang=current.lang==='vi'?'vi-VN':'en-US';
  recognition.continuous=true;recognition.interimResults=true;
  if('phrases' in recognition&&window.SpeechRecognitionPhrase){
    try{recognition.phrases=terms.map(item=>new SpeechRecognitionPhrase(item.term,5))}catch{}
  }
  recognition.onresult=event=>{
    recognitionFailures=0;let interim='';
    for(let i=event.resultIndex;i<event.results.length;i++){
      if(event.results[i].isFinal)enqueueText(event.results[i][0].transcript,elapsedSeconds());
      else interim+=event.results[i][0].transcript;
    }
    $('interim').textContent=canonicalize(interim);
  };
  recognition.onerror=event=>{
    if(!active)return;
    if(['not-allowed','service-not-allowed','audio-capture','language-not-supported'].includes(event.error)){
      end();message('Nhận dạng giọng nói bị dừng ('+event.error+'). Kiểm tra quyền micro, ngôn ngữ và trình duyệt.');
    }else if(event.error!=='no-speech'&&event.error!=='aborted'){
      recognitionFailures++;
      message('Kết nối nhận dạng giọng nói gặp lỗi. Đang thử lại ('+recognitionFailures+'/3).');
      if(recognitionFailures>=3){end();message('Đã dừng sau ba lỗi nhận dạng. Bản ghi âm đã thu vẫn có thể tải xuống.')}
    }
  };
  recognition.onend=()=>{if(active)setTimeout(()=>{if(active)startRecognition()},700)};
  try{recognition.start()}catch(error){end();message('Không bắt đầu được nhận dạng: '+error.message)}
}
function end(){
  if(active){elapsed=elapsedSeconds();current.elapsed=elapsed}
  active=false;clearInterval(timer);recognition?.stop();
  const capture=localCapture;localCapture=null;capture?.stop().catch(error=>message('Đã dừng micro: '+error.message));
  if(recorder&&recorder.state!=='inactive'){finalizing=true;$('recordBtn').disabled=true;recorder.stop()}
  stream?.getTracks().forEach(track=>track.stop());stream=null;
  $('interim').textContent='';$('duration').textContent=timeLabel(elapsed);updateRecordUI();save();
}
function showAudio(blob){
  if(audioUrl)URL.revokeObjectURL(audioUrl);
  audioUrl=URL.createObjectURL(blob);$('audioPlayback').src=audioUrl;
  $('downloadAudio').href=audioUrl;$('downloadAudio').download='lingua-'+current.date.slice(0,10)+(blob.type.includes('mp4')?'.m4a':'.webm');
  $('audioPanel').hidden=false;
}
function showPage(page){
  for(const name of ['studio','history','glossary'])$(name).hidden=name!==page;
  for(const name of ['studio','history','glossary'])$(name+'Tab').classList.toggle('selected',name===page);
  $('pageLabel').textContent={studio:'Studio trực tiếp',history:'Lịch sử phiên',glossary:'Từ điển tên riêng'}[page];
  if(page==='history')renderHistory();
}
function resetEmpty(){
  $('sourceSegments').replaceChildren(node('div','Bấm ghi âm hoặc nhập văn bản để bắt đầu.','empty'));
  $('targetSegments').replaceChildren(node('div','Bản dịch sẽ xuất hiện tại đây.','empty'));
  $('interim').textContent='';$('audioPanel').hidden=true;
  if(audioUrl){URL.revokeObjectURL(audioUrl);audioUrl=null}
}
function newSession(){
  if(active||audioPending||localCapture||finalizing){message('Kết thúc ghi âm và chờ xử lý các đoạn còn lại trước khi mở phiên mới.');showPage('studio');return}
  save();current=freshSession();elapsed=0;
  $('sessionName').value=current.name;$('sourceLang').value=current.lang;$('sourceLang').disabled=false;
  $('duration').textContent='00:00';resetEmpty();render();showPage('studio');message('');
}
function renderHistory(){
  const list=$('sessionList');list.replaceChildren();
  if(!sessions.length)list.append(node('p','Chưa có phiên đã lưu. Bắt đầu ghi âm hoặc thử một câu trong Studio.','subtitle'));
  for(const item of sessions){
    const row=node('article','','history-row'),info=node('div',''),actions=node('div','','buttons');
    info.append(node('strong',item.name),node('small',new Date(item.date).toLocaleString('vi-VN')+' · '+item.segments.length+' đoạn · '+timeLabel(item.elapsed)));
    const open=node('button','Mở phiên','outline');
    open.onclick=async()=>{
      if(active||audioPending||finalizing){showPage('studio');message('Kết thúc ghi âm và chờ xử lý xong trước khi mở phiên khác.');return}
      save();current=structuredClone(item);elapsed=current.elapsed;
      $('sessionName').value=current.name;$('sourceLang').value=current.lang;$('duration').textContent=timeLabel(elapsed);
      resetEmpty();render();updateRecordUI();$('sourceLang').disabled=current.segments.length>0;showPage('studio');
      const openedId=current.id,blob=await getAudio(openedId);
      if(blob&&current.id===openedId)showAudio(blob);
    };
    const remove=node('button','Xóa','outline');remove.onclick=()=>{
      if(active||audioPending||finalizing){message('Kết thúc ghi âm và chờ xử lý xong trước khi xóa phiên.');showPage('studio');return}
      if(!confirm('Xóa phiên “'+item.name+'” và bản ghi âm trên thiết bị này?'))return;
      sessions=sessions.filter(session=>session.id!==item.id);localStorage.setItem('lingua-sessions',JSON.stringify(sessions));removeAudio(item.id);
      if(item.id===current.id){current=freshSession();elapsed=0;$('sessionName').value=current.name;$('sourceLang').value='vi';resetEmpty();render()}
      renderHistory();
    };
    actions.append(open,remove);row.append(info,actions);list.append(row);
  }
}
function download(name,content,type){
  const url=URL.createObjectURL(new Blob([content],{type}));
  const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
function srtTime(value){const ms=Math.round(value*1000);return String(Math.floor(ms/3600000)).padStart(2,'0')+':'+String(Math.floor(ms/60000)%60).padStart(2,'0')+':'+String(Math.floor(ms/1000)%60).padStart(2,'0')+','+String(ms%1000).padStart(3,'0')}
function exportFile(format){
  const name=(current.name||'ban-chep-loi').replace(/[\\/:*?"<>|]/g,'-');
  if(format==='json')download(name+'.json',JSON.stringify(current,null,2),'application/json');
  if(format==='txt')download(name+'.txt',current.name+'\n'+new Date(current.date).toLocaleString('vi-VN')+'\n\n'+current.segments.map(s=>'['+timeLabel(s.at)+'] '+s.text+'\n'+(s.translated||'Chưa có bản dịch')).join('\n\n'),'text/plain;charset=utf-8');
  if(format==='srt')download(name+'.srt',current.segments.map((s,i)=>{
    const end=current.segments[i+1]?.at||Math.max(current.elapsed,s.at+4);
    return (i+1)+'\n'+srtTime(s.at)+' --> '+srtTime(Math.max(s.at+1,end))+'\n'+s.text+(s.translated?'\n'+s.translated:'');
  }).join('\n\n'),'text/plain;charset=utf-8');
  $('exportDialog').close();
}
$('recordBtn').onclick=begin;$('stopBtn').onclick=end;
$('newSession').onclick=newSession;
for(const page of ['studio','history','glossary'])$(page+'Tab').onclick=()=>showPage(page);
$('openGlossary').onclick=()=>showPage('glossary');
$('sessionName').onchange=save;
$('sourceLang').onchange=()=>{current.lang=$('sourceLang').value;render()};
$('manualForm').onsubmit=event=>{event.preventDefault();enqueueText($('manualText').value,elapsedSeconds());$('manualText').value='';$('sourceLang').disabled=true};
$('translateToggle').onchange=()=>{if($('translateToggle').checked)for(const segment of current.segments)if(!segment.translated&&!segment.pending)queueTranslation(current,segment)};
$('glossaryForm').onsubmit=event=>{
  event.preventDefault();
  const term=$('term').value.trim(),aliases=$('aliases').value.split(',').map(s=>s.trim()).filter(Boolean);
  if(!term)return;
  const found=terms.find(item=>normalizedKey(item.term)===normalizedKey(term));
  if(found){found.term=term;found.aliases=aliases}else terms.push({term,aliases});
  try{localStorage.setItem('lingua-terms',JSON.stringify(terms))}catch{message('Không lưu được từ điển trên thiết bị.')}
  $('glossaryForm').reset();renderTerms();
};
$('exportBtn').onclick=()=>{if(!current.segments.length){message('Thêm ít nhất một đoạn trước khi xuất.');return}$('exportDialog').showModal()};
$('txtExport').onclick=()=>exportFile('txt');$('srtExport').onclick=()=>exportFile('srt');$('jsonExport').onclick=()=>exportFile('json');
window.addEventListener('beforeunload',event=>{if(active){event.preventDefault();event.returnValue=''}});
renderTerms();render();
if(!SpeechAPI&&$('engine').value==='cloud')message('Trình duyệt hiện tại chưa có nhận dạng giọng nói. Mở bằng Chrome hoặc Edge trên máy tính để ghi âm và chép lời.');

function queueLocalAudio(wav,at,session){
  audioPending++;
  if(audioPending>4){
    audioPending--;
    end();
    message('Máy đang xử lý chậm hơn âm thanh thu. Đã dừng ghi để hoàn tất các đoạn đang chờ. Bản ghi âm vẫn có thể tải xuống.');
    return;
  }
  updateRecordUI();
  const glossary=terms.map(item=>item.term);
  audioQueue=audioQueue.then(async()=>{
    try{
      const response=await fetch('/api/transcribe?lang='+session.lang,{
        method:'POST',headers:{'Content-Type':'audio/wav','x-glossary':encodeURIComponent(JSON.stringify(glossary))},
        body:wav,signal:AbortSignal.timeout(180000)
      });
      const data=await response.json();
      if(!response.ok)throw Error(data.detail||'Không chép được đoạn âm thanh.');
      if(data.text.trim()){
        if(current.id===session.id)enqueueText(data.text,at);
        else message('Một đoạn đã xử lý cho phiên trước. Giữ nguyên phiên khi xử lý âm thanh.');
      }
    }catch(error){message('Đoạn '+timeLabel(at)+' chưa chép được: '+error.message+'. Hãy giữ bản ghi âm để xử lý lại.')}
    finally{audioPending--;$('engineStatus').textContent=audioPending?'Đang xử lý '+audioPending+' đoạn âm thanh':'Mô hình đã sẵn sàng';updateRecordUI()}
  });
}
async function inspectLocal(){
  try{
    const response=await fetch('/api/health',{signal:AbortSignal.timeout(4000)});
    if(!response.ok)throw Error();
    const data=await response.json();
    localReady=data.ready;
    $('engineStatus').textContent=data.ready?'Mô hình đã sẵn sàng':'Đã kết nối máy. Bấm Chuẩn bị mô hình.';
    $('localHelp').textContent='Âm thanh và bản dịch xử lý trên máy này. Lần chuẩn bị đầu tiên cần mạng để tải mô hình; giữ cửa sổ khởi động mở khi dùng.';
    return true;
  }catch{
    localReady=false;
    $('engineStatus').textContent='Cần mở chương trình trên máy';
    return false;
  }
}
$('engine').onchange=()=>{if($('engine').value==='local')inspectLocal();else $('engineStatus').textContent='MyMemory miễn phí có hạn mức 5.000 ký tự/ngày.'};
$('prepareLocal').onclick=async()=>{
  if(!await inspectLocal()){message('Hãy tải bản chạy trên máy, giải nén và mở start-windows.bat. Dùng trang http://127.0.0.1:8765 do chương trình mở.');return}
  $('prepareLocal').disabled=true;$('engineStatus').textContent='Đang tải mô hình. Lần đầu có thể mất nhiều phút…';
  try{
    const response=await fetch('/api/prepare',{method:'POST'});
    const data=await response.json();
    if(!response.ok)throw Error(data.detail||'Không chuẩn bị được mô hình.');
    localReady=data.ready;$('engineStatus').textContent='Mô hình đã sẵn sàng';message('');
  }catch(error){message(error.message);$('engineStatus').textContent='Chuẩn bị chưa thành công'}
  finally{$('prepareLocal').disabled=false}
};
inspectLocal();
