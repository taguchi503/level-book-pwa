(() => {
  'use strict';
  const APP_VERSION='0.1.0';
  const KEY='moriken_level_book_v0_1';
  const MIRROR_KEY='moriken_level_book_mirror_v1';
  const BACKUP_KEY='moriken_level_book_backup_v1';
  const PRE_IMPORT_KEY='moriken_level_book_pre_import_v1';
  const $=(s,r=document)=>r.querySelector(s);
  const $$=(s,r=document)=>[...r.querySelectorAll(s)];
  const num=v=>{const n=parseFloat(String(v??'').replace(',','.'));return Number.isFinite(n)?n:null};
  const fmt=v=>Number.isFinite(v)?v.toFixed(3):'—';
  const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
  const isTP=name=>/^\s*TP(?:\s*[-_]?[A-Z0-9一二三四五六七八九十]+)?\s*$/i.test(String(name||''))||/^\s*TP\b/i.test(String(name||''));
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const state={data:null,activeView:'measure',selectedMode:'BS',pendingVoice:null,editRef:null,listening:false};

  const el={
    stationNo:$('#stationNo'),currentHI:$('#currentHI'),nextAction:$('#nextAction'),pointInput:$('#pointInput'),readingInput:$('#readingInput'),recordBtn:$('#recordBtn'),voiceBtn:$('#voiceBtn'),clearReadingBtn:$('#clearReadingBtn'),
    voicePanel:$('#voiceConfirmPanel'),voiceConfirmText:$('#voiceConfirmText'),voiceApplyBtn:$('#voiceApplyBtn'),voiceRetryBtn:$('#voiceRetryBtn'),lastRecord:$('#lastRecord'),statusMessage:$('#statusMessage'),
    historyLast:$('#historyLast'),recentBody:$('#recentBody'),sumBS:$('#sumBS'),sumFS:$('#sumFS'),diff:$('#diff'),elevDiff:$('#elevDiff'),checkResult:$('#checkResult'),
    ledgerSite:$('#ledgerSite'),ledgerCount:$('#ledgerCount'),ledgerSumBS:$('#ledgerSumBS'),ledgerSumFS:$('#ledgerSumFS'),ledgerDiff:$('#ledgerDiff'),ledgerBody:$('#ledgerBody'),
    settingsDialog:$('#settingsDialog'),settingSiteName:$('#settingSiteName'),settingSurveyDate:$('#settingSurveyDate'),settingStartPoint:$('#settingStartPoint'),settingStartElev:$('#settingStartElev'),settingConfirmVoice:$('#settingConfirmVoice'),
    editDialog:$('#editDialog'),editTypeLabel:$('#editTypeLabel'),editPoint:$('#editPoint'),editReading:$('#editReading'),editNote:$('#editNote'),editNoteWrap:$('#editNoteWrap'),outputDialog:$('#outputDialog'),jsonImportFile:$('#jsonImportFile'),
    updateBanner:$('#updateBanner'),updateTitle:$('#updateTitle'),updateText:$('#updateText'),updateNowBtn:$('#updateNowBtn'),updateLaterBtn:$('#updateLaterBtn')
  };

  function blankData(){return{version:APP_VERSION,savedAt:new Date().toISOString(),siteName:'',surveyDate:today(),startPoint:'BM1',startElev:'100.000',confirmVoice:true,initialBS:'',rows:[]}}
  function normalizeData(d){
    const b=blankData(); if(!d||typeof d!=='object') return b;
    return {...b,...d,version:APP_VERSION,rows:Array.isArray(d.rows)?d.rows.map(r=>({point:String(r?.point||''),fs:r?.fs??'',nextBS:r?.nextBS??'',note:String(r?.note||'')})):[]};
  }
  function parseStored(raw){if(!raw)return null;try{const d=JSON.parse(raw);return d&&typeof d==='object'?d:null}catch{return null}}
  function safeWrite(reason='save'){
    state.data.version=APP_VERSION;state.data.savedAt=new Date().toISOString();
    const next=JSON.stringify(state.data),prev=localStorage.getItem(KEY);
    try{if(prev&&prev!==next)localStorage.setItem(BACKUP_KEY,prev);localStorage.setItem(KEY,next);try{localStorage.setItem(MIRROR_KEY,next)}catch(_){ }return true}catch(err){console.error('save failed',reason,err);return false}
  }
  function recover(){
    const p=parseStored(localStorage.getItem(KEY));if(p)return p;
    for(const k of [MIRROR_KEY,BACKUP_KEY]){const raw=localStorage.getItem(k),d=parseStored(raw);if(d){try{localStorage.setItem(KEY,raw)}catch(_){ }return d}}
    return null;
  }

  function calculate(){
    const d=state.data,start=num(d.startElev),firstBS=num(d.initialBS);let hi=(start!==null&&firstBS!==null)?start+firstBS:null;
    let sumBSAll=firstBS||0,sumFSAll=0,lastElev=start,setup=1;const timeline=[];
    if(firstBS!==null){timeline.push({id:'initialBS',source:{type:'initialBS'},kind:'BS',point:d.startPoint||'BM1',reading:firstBS,elev:start,hi:hi,setup,note:'起点',tp:false})}
    d.rows.forEach((r,i)=>{
      const fs=num(r.fs),tp=isTP(r.point),hiBefore=hi;let elev=null;
      if(fs!==null&&hiBefore!==null){elev=hiBefore-fs;sumFSAll+=fs;lastElev=elev}
      if(fs!==null){timeline.push({id:`fs:${i}`,source:{type:'rowFS',index:i},kind:'FS',point:r.point||'',reading:fs,elev,hi:hiBefore,setup,note:r.note||'',tp})}
      const bs=num(r.nextBS);
      if(tp){
        if(elev!==null&&bs!==null){sumBSAll+=bs;setup+=1;hi=elev+bs;timeline.push({id:`bs:${i}`,source:{type:'rowBS',index:i},kind:'BS',point:r.point||'',reading:bs,elev,hi,setup,note:'器械据替え',tp:false})}
        else if(elev!==null){hi=null}
      }
    });
    const fsEvents=timeline.filter(x=>x.kind==='FS');
    const lastFS=fsEvents.at(-1)||null;
    let checkSumBS=0,checkSumFS=0,elevDiff=null,error=null;
    if(lastFS){
      const lastIndex=timeline.indexOf(lastFS);
      timeline.forEach((e,i)=>{
        if(i>lastIndex)return;
        if(e.kind==='BS')checkSumBS+=e.reading;
        if(e.kind==='FS'&&e.tp)checkSumFS+=e.reading;
      });
      if(!lastFS.tp)checkSumFS+=lastFS.reading;
      elevDiff=(start!==null&&Number.isFinite(lastFS.elev))?lastFS.elev-start:null;
      const diff=checkSumBS-checkSumFS;
      error=elevDiff!==null?diff-elevDiff:null;
    }
    const diff=checkSumBS-checkSumFS;
    const pendingTP=d.rows.map((r,i)=>({r,i})).reverse().find(x=>isTP(x.r.point)&&num(x.r.fs)!==null&&num(x.r.nextBS)===null);
    const phase=firstBS===null?{mode:'BS',point:d.startPoint||'BM1',label:'BS（後視）'}:pendingTP?{mode:'BS',point:pendingTP.r.point,label:'BS（後視）',pendingIndex:pendingTP.i}:{mode:'FS',point:'',label:'FS（前視）'};
    return{start,firstBS,hi,sumBS:checkSumBS,sumFS:checkSumFS,sumBSAll,sumFSAll,lastElev,diff,elevDiff,error,timeline,setup,phase,fsCount:fsEvents.length};
  }

  function latestEntry(calc=calculate()){return calc.timeline.at(-1)||null}
  function nextTPName(){const n=state.data.rows.filter(r=>isTP(r.point)).length+1;return `TP${n}`}

  function setMessage(msg,type='normal'){el.statusMessage.textContent=msg;el.statusMessage.dataset.type=type}
  function selectMode(mode,opts={}){
    const c=calculate();
    if(c.phase.mode==='BS'&&mode!=='BS'){setMessage('まずBS（後視）を記録してください。');mode='BS'}
    if(mode==='TP'&&c.phase.mode!=='BS'&&!isTP(el.pointInput.value)){el.pointInput.value=nextTPName()}
    state.selectedMode=mode;$$('.mode-btn').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));updateRecordButton();
    if(!opts.silent&&mode==='BS'&&c.phase.point&&!el.pointInput.value)el.pointInput.value=c.phase.point;
  }
  function updateRecordButton(){const mode=state.selectedMode;const label=mode==='TP'?'TP（FS）':mode;const val=num(el.readingInput.value);el.recordBtn.textContent=`✓ ${label}${val!==null?' '+val.toFixed(3):''}を記録`}

  function render(){
    const c=calculate();
    el.stationNo.textContent=String(c.setup);el.currentHI.textContent=fmt(c.hi);el.nextAction.textContent=c.phase.label;
    if(c.phase.mode==='BS'&&state.selectedMode!=='BS')selectMode('BS',{silent:true});
    if(c.phase.mode==='FS'&&state.selectedMode==='BS')selectMode(isTP(el.pointInput.value)?'TP':'FS',{silent:true});
    updateRecordButton();renderLast(c);renderHistory(c);renderLedger(c);
  }
  function entryHtml(e){if(!e)return'<span>まだ記録がありません</span>';const tp=e.tp?' <span class="tp-mini">TP</span>':'';return `<strong>${esc(e.point||'—')}　<span class="type-badge ${e.kind}">${e.kind}</span>${tp}　${fmt(e.reading)}</strong><span class="elev">標高 = ${fmt(e.elev)} m</span>`}
  function renderLast(c){const e=latestEntry(c);el.lastRecord.classList.toggle('empty',!e);el.lastRecord.innerHTML=entryHtml(e);el.historyLast.classList.toggle('empty',!e);el.historyLast.innerHTML=entryHtml(e)}
  function renderHistory(c){
    const recent=c.timeline.slice(-5).reverse();el.recentBody.innerHTML=recent.length?recent.map((e,i)=>`<tr><td>${c.timeline.length-i}</td><td><span class="type-badge ${e.kind}">${e.kind}</span>${e.tp?' <span class="tp-mini">TP</span>':''}</td><td>${esc(e.point)}</td><td>${fmt(e.reading)}</td><td>${fmt(e.elev)}</td></tr>`).join(''):`<tr><td colspan="5">記録なし</td></tr>`;
    el.sumBS.textContent=`${c.sumBS.toFixed(3)} m`;el.sumFS.textContent=`${c.sumFS.toFixed(3)} m`;el.diff.textContent=`${c.diff>=0?'+':''}${c.diff.toFixed(3)} m`;el.elevDiff.textContent=c.elevDiff===null?'—':`${c.elevDiff>=0?'+':''}${c.elevDiff.toFixed(3)} m`;
    if(c.error===null){el.checkResult.className='check-result neutral';el.checkResult.textContent='FSを記録すると整合を確認します'}else if(Math.abs(c.error)<0.0005){el.checkResult.className='check-result good';el.checkResult.textContent=`整合OK（差 ${c.error.toFixed(3)} m）`}else{el.checkResult.className='check-result bad';el.checkResult.textContent=`要確認（計算差 ${c.error.toFixed(3)} m）`}
  }
  function renderLedger(c){
    el.ledgerSite.textContent=`${state.data.siteName||'現場名未設定'}　／　${state.data.surveyDate||''}`;el.ledgerCount.textContent=String(c.timeline.length);el.ledgerSumBS.textContent=`${c.sumBS.toFixed(3)} m`;el.ledgerSumFS.textContent=`${c.sumFS.toFixed(3)} m`;el.ledgerDiff.textContent=`${c.diff>=0?'+':''}${c.diff.toFixed(3)} m`;
    el.ledgerBody.innerHTML=c.timeline.length?c.timeline.map((e,i)=>`<tr data-entry="${e.id}" class="${e.tp?'tp-row':''}"><td>${i+1}</td><td><span class="type-badge ${e.kind}">${e.kind}</span>${e.tp?' <span class="tp-mini">TP</span>':''}</td><td>${esc(e.point)}</td><td>${fmt(e.reading)}</td><td>${fmt(e.hi)}</td><td>${fmt(e.elev)}</td><td>${esc((e.tp?'←TP ':'')+(e.note||''))}</td></tr>`).join(''):`<tr><td colspan="7">記録なし</td></tr>`;
  }

  function record(){
    const c=calculate(),reading=num(el.readingInput.value);let point=el.pointInput.value.trim();
    if(reading===null){setMessage('読み値を入力してください。');el.readingInput.focus();return}
    if(reading<0||reading>20){if(!confirm(`読み値 ${reading.toFixed(3)} m を記録しますか？`))return}
    if(c.phase.mode==='BS'||state.selectedMode==='BS'){
      if(c.firstBS===null){if(point)state.data.startPoint=point;state.data.initialBS=reading.toFixed(3);setMessage(`開始BS ${reading.toFixed(3)} m を記録しました。`)}
      else if(c.phase.pendingIndex!==undefined){const r=state.data.rows[c.phase.pendingIndex];r.nextBS=reading.toFixed(3);setMessage(`${r.point} の次BS ${reading.toFixed(3)} m を記録しました。`)}
      else{setMessage('現在はBS入力のタイミングではありません。');return}
      el.pointInput.value='';el.readingInput.value='';state.selectedMode='FS';
    }else{
      if(!point){setMessage('点名を入力してください。');el.pointInput.focus();return}
      if(state.selectedMode==='TP'&&!isTP(point))point=nextTPName();
      const tp=isTP(point);state.data.rows.push({point,fs:reading.toFixed(3),nextBS:'',note:''});
      setMessage(`${point}　${tp?'TP（FS）':'FS'} ${reading.toFixed(3)} m を記録しました。`);
      el.readingInput.value='';if(tp){el.pointInput.value=point;state.selectedMode='BS'}else{el.pointInput.value='';state.selectedMode='FS'}
    }
    safeWrite('record');render();if(state.selectedMode==='BS'&&!el.pointInput.value){const n=calculate();el.pointInput.value=n.phase.point||''}el.pointInput.focus();
  }

  function undoLast(){
    const c=calculate(),last=c.timeline.at(-1);if(!last){setMessage('戻す記録がありません。');return}if(!confirm(`直前の「${last.point} ${last.kind} ${fmt(last.reading)}」を取り消しますか？`))return;
    if(last.source.type==='initialBS')state.data.initialBS='';else if(last.source.type==='rowBS')state.data.rows[last.source.index].nextBS='';else if(last.source.type==='rowFS')state.data.rows.splice(last.source.index,1);
    safeWrite('undo');el.pointInput.value='';el.readingInput.value='';state.selectedMode=calculate().phase.mode;render();setMessage('直前の記録を取り消しました。')
  }

  function switchView(view){state.activeView=view;$$('.app-view').forEach(v=>v.classList.toggle('active-view',v.id===`${view}View`));$$('.view-tab').forEach(b=>b.classList.toggle('active',b.dataset.view===view));if(view==='ledger')renderLedger(calculate());window.scrollTo({top:0,behavior:'smooth'})}

  function openSettings(){el.settingSiteName.value=state.data.siteName||'';el.settingSurveyDate.value=state.data.surveyDate||today();el.settingStartPoint.value=state.data.startPoint||'BM1';el.settingStartElev.value=state.data.startElev||'100.000';el.settingConfirmVoice.checked=state.data.confirmVoice!==false;el.settingsDialog.showModal()}
  function saveSettings(){state.data.siteName=el.settingSiteName.value.trim();state.data.surveyDate=el.settingSurveyDate.value||today();state.data.startPoint=el.settingStartPoint.value.trim()||'BM1';state.data.startElev=el.settingStartElev.value||'100.000';state.data.confirmVoice=el.settingConfirmVoice.checked;safeWrite('settings');el.settingsDialog.close();render();setMessage('測量設定を保存しました。')}

  function findEntry(id){return calculate().timeline.find(e=>e.id===id)||null}
  function openEdit(entry){if(!entry)return;state.editRef=entry.source;el.editTypeLabel.textContent=`${entry.kind}　${entry.point||''}`;el.editPoint.value=entry.point||'';el.editReading.value=fmt(entry.reading).replace('—','');el.editNote.value=entry.note||'';el.editNoteWrap.classList.toggle('hidden',entry.source.type!=='rowFS');el.editPoint.disabled=entry.source.type==='rowBS';el.editDialog.showModal()}
  function saveEdit(){const ref=state.editRef,reading=num(el.editReading.value),point=el.editPoint.value.trim();if(!ref||reading===null){return}
    if(ref.type==='initialBS'){state.data.startPoint=point||state.data.startPoint;state.data.initialBS=reading.toFixed(3)}
    else if(ref.type==='rowFS'){const r=state.data.rows[ref.index];r.point=point||r.point;r.fs=reading.toFixed(3);r.note=el.editNote.value.trim()}
    else if(ref.type==='rowBS'){state.data.rows[ref.index].nextBS=reading.toFixed(3)}
    safeWrite('edit');el.editDialog.close();state.editRef=null;render();setMessage('記録を修正しました。')}

  function exportJSON(){safeWrite('export');const blob=new Blob([JSON.stringify(state.data,null,2)],{type:'application/json'});downloadBlob(blob,`level-book_${state.data.surveyDate||today()}.json`)}
  function downloadBlob(blob,name){const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1000)}
  async function importJSON(file){try{const text=await file.text(),d=JSON.parse(text);try{localStorage.setItem(PRE_IMPORT_KEY,JSON.stringify(state.data))}catch(_){ }state.data=normalizeData(d);safeWrite('import');render();setMessage('バックアップを読み込みました。')}catch(err){console.error(err);setMessage('バックアップの読み込みに失敗しました。')}}
  function excelXml(){
    const c=calculate(),rows=c.timeline.map((e,i)=>[i+1,e.kind,e.point,e.reading,e.hi,e.elev,(e.tp?'←TP ':'')+(e.note||'')]);
    const cell=(v,type='String')=>`<Cell><Data ss:Type="${type}">${type==='String'?esc(v):v}</Data></Cell>`;
    const header=['No.','種別','点名','読み値[m]','HI[m]','標高[m]','備考'];
    const dataRows=rows.map(r=>`<Row>${cell(r[0],'Number')}${cell(r[1])}${cell(r[2])}${cell(r[3],'Number')}${cell(Number.isFinite(r[4])?r[4]:'')}${cell(Number.isFinite(r[5])?r[5]:'')}${cell(r[6])}</Row>`).join('');
    return `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="野帳"><Table><Row>${header.map(h=>cell(h)).join('')}</Row>${dataRows}</Table></Worksheet></Workbook>`;
  }
  function exportExcel(){const blob=new Blob(['\ufeff',excelXml()],{type:'application/vnd.ms-excel'});downloadBlob(blob,`水準野帳_${state.data.surveyDate||today()}.xls`)}
  function printLedger(){switchView('ledger');setTimeout(()=>window.print(),120)}
  async function shareData(){
    const text=`${state.data.siteName||'水準測量'} ${state.data.surveyDate||''}\n測点数 ${calculate().timeline.length}\nΣBS ${calculate().sumBS.toFixed(3)} m / ΣFS ${calculate().sumFS.toFixed(3)} m`;
    if(navigator.share){try{await navigator.share({title:'水準測量 野帳',text});return}catch(err){if(err?.name==='AbortError')return}}
    try{await navigator.clipboard.writeText(text);setMessage('測量概要をクリップボードにコピーしました。')}catch{setMessage('この端末では共有機能を使用できません。')}
  }

  function normalizeSpeech(t){return String(t||'').trim().replace(/[，、]/g,' ').replace(/(\d)\s*点\s*(\d)/g,'$1.$2').replace(/メートル|ｍ/gi,'').replace(/ビー\s*エス|びーえす/gi,'BS').replace(/エフ\s*エス|えふえす/gi,'FS').replace(/ティー\s*ピー|てぃーぴー/gi,'TP').replace(/後視/g,'BS').replace(/前視/g,'FS').replace(/転点/g,'TP')}
  function parseSpeech(raw){
    const t=normalizeSpeech(raw);let mode=null;if(/\bBS\b/i.test(t))mode='BS';else if(/\bTP\b/i.test(t))mode='TP';else if(/\bFS\b/i.test(t))mode='FS';
    const matches=[...t.matchAll(/-?\d+(?:\.\d+)?/g)];if(!matches.length)return{raw,mode,point:t.replace(/\b(?:BS|FS)\b/ig,'').trim(),reading:null};
    const m=matches.at(-1),reading=m[0];let point=(t.slice(0,m.index)+t.slice(m.index+m[0].length)).replace(/\b(?:BS|FS)\b/ig,'').trim();
    point=point.replace(/^(点名)\s*/,'').trim();if(mode==='TP'&&!/TP/i.test(point))point=point?`TP${point}`:'';return{raw,mode,point,reading};
  }
  function applyVoice(p){if(!p)return;if(p.point)el.pointInput.value=p.point;if(p.reading!==null)el.readingInput.value=p.reading;const c=calculate();if(c.phase.mode==='BS')selectMode('BS',{silent:true});else if(p.mode)selectMode(p.mode,{silent:true});else selectMode(isTP(el.pointInput.value)?'TP':'FS',{silent:true});updateRecordButton();state.pendingVoice=null;el.voicePanel.classList.add('hidden');setMessage('音声認識結果を入力しました。内容を確認して「記録」を押してください。')}
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;let recognition=null;
  if(SR){recognition=new SR();recognition.lang='ja-JP';recognition.interimResults=false;recognition.maxAlternatives=3}
  function startVoice(){if(!recognition){setMessage('このブラウザは音声認識に対応していません。Chrome等で確認してください。');return}if(state.listening)return;state.listening=true;setMessage('🎤 聞き取り中…');try{recognition.start()}catch{state.listening=false}}
  if(recognition){recognition.onresult=e=>{state.listening=false;const raw=e.results[0][0].transcript,p=parseSpeech(raw);state.pendingVoice=p;const pieces=[];if(p.point)pieces.push(p.point);if(p.reading!==null)pieces.push(p.reading);el.voiceConfirmText.textContent=pieces.join('　')||raw;if(state.data.confirmVoice!==false)el.voicePanel.classList.remove('hidden');else applyVoice(p)};recognition.onerror=e=>{state.listening=false;setMessage(`音声認識エラー：${e.error}`)};recognition.onend=()=>{state.listening=false}}

  function compareVersions(a,b){const pa=String(a||'0').replace(/^v/,'').split('.').map(x=>parseInt(x,10)||0),pb=String(b||'0').replace(/^v/,'').split('.').map(x=>parseInt(x,10)||0);for(let i=0;i<Math.max(pa.length,pb.length);i++){const d=(pa[i]||0)-(pb[i]||0);if(d)return d>0?1:-1}return 0}
  async function checkUpdate(){if(location.protocol==='file:')return;try{const r=await fetch(`./app-info.json?ts=${Date.now()}`,{cache:'no-store'});if(!r.ok)return;const info=await r.json(),remote=String(info.version||'').replace(/^v/,'');if(remote&&compareVersions(remote,APP_VERSION)>0){el.updateTitle.textContent=`最新版 v${remote} があります`;el.updateText.textContent=info.releaseNotes||'保存データを残したまま更新できます。';el.updateBanner.classList.remove('hidden')}}catch(_){}}
  async function performUpdate(){if(!safeWrite('before-update')){setMessage('安全バックアップを作成できないため更新を中止しました。');return}el.updateNowBtn.disabled=true;el.updateNowBtn.textContent='更新中…';try{const reg=await navigator.serviceWorker?.getRegistration();if(reg)await reg.update().catch(()=>{})}catch(_){ }setTimeout(()=>location.reload(),500)}

  function bind(){
    $$('.view-tab').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view)));$$('.mode-btn').forEach(b=>b.addEventListener('click',()=>selectMode(b.dataset.mode)));
    el.pointInput.addEventListener('input',()=>{const c=calculate();if(c.phase.mode==='FS')selectMode(isTP(el.pointInput.value)?'TP':'FS',{silent:true});updateRecordButton()});el.readingInput.addEventListener('input',updateRecordButton);el.readingInput.addEventListener('keydown',e=>{if(e.key==='Enter')record()});
    el.recordBtn.addEventListener('click',record);el.clearReadingBtn.addEventListener('click',()=>{el.readingInput.value='';updateRecordButton();el.readingInput.focus()});el.voiceBtn.addEventListener('click',startVoice);el.voiceApplyBtn.addEventListener('click',()=>applyVoice(state.pendingVoice));el.voiceRetryBtn.addEventListener('click',()=>{el.voicePanel.classList.add('hidden');state.pendingVoice=null;setTimeout(startVoice,120)});
    $('#undoBtn').addEventListener('click',undoLast);$('#editLastBtn').addEventListener('click',()=>openEdit(latestEntry()));$('#openLedgerBtn').addEventListener('click',()=>switchView('ledger'));$('#openOutputBtn').addEventListener('click',()=>el.outputDialog.showModal());
    $('#settingsBtn').addEventListener('click',openSettings);$('#changeStationBtn').addEventListener('click',openSettings);$('#saveSettingsBtn').addEventListener('click',saveSettings);$('#saveEditBtn').addEventListener('click',saveEdit);
    el.ledgerBody.addEventListener('click',e=>{const tr=e.target.closest('tr[data-entry]');if(tr)openEdit(findEntry(tr.dataset.entry))});
    $('#pdfBtn').addEventListener('click',printLedger);$('#excelBtn').addEventListener('click',exportExcel);$('#shareBtn').addEventListener('click',shareData);$('#outputPdfBtn').addEventListener('click',()=>{el.outputDialog.close();printLedger()});$('#outputExcelBtn').addEventListener('click',exportExcel);
    $('#manualSaveBtn').addEventListener('click',()=>{if(safeWrite('manual'))setMessage('端末に保存しました。');else setMessage('保存できませんでした。')});$('#jsonExportBtn').addEventListener('click',exportJSON);el.jsonImportFile.addEventListener('change',async e=>{const f=e.target.files?.[0];if(f)await importJSON(f);e.target.value=''});
    el.updateNowBtn.addEventListener('click',performUpdate);el.updateLaterBtn.addEventListener('click',()=>el.updateBanner.classList.add('hidden'));
  }

  function init(){state.data=normalizeData(recover()||blankData());safeWrite('startup-migrate');bind();const c=calculate();state.selectedMode=c.phase.mode;if(c.phase.mode==='BS')el.pointInput.value=c.phase.point||'';render();selectMode(c.phase.mode,{silent:true});if(!state.data.siteName)setMessage('最初に右上の⚙から現場名・開始点・開始標高を確認してください。');if('serviceWorker'in navigator&&location.protocol!=='file:')addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').then(r=>r.update()).catch(()=>{}));checkUpdate();document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkUpdate()});setInterval(checkUpdate,5*60*1000)}
  init();
})();
