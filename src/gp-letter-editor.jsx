import React,{useEffect,useRef,useState} from 'react';
import {Check,Edit3,Plus,RefreshCw,Save,X} from 'lucide-react';
import {api} from './api';
import {useInterfaceLanguage} from './interface-locale.mjs';
import './gp-letter-editor.css';

const EDIT=/^gpedit_[a-f0-9]{32}$/,STYLE=/^gpstyle_[a-f0-9]{32}$/;
const values=pkg=>{
 const canonical=pkg?.readyForReview===true||EDIT.test(pkg?.editedDraftId||''),body=canonical?pkg?.body||'':pkg?.previewBody||pkg?.body||'',parts=body.split(/\n\s*\n/),p=canonical?pkg?.paragraphs:pkg?.previewParagraphs||pkg?.paragraphs;
 return {clinicParagraph:p?.clinicReason||p?.clinic||parts[2]||'',valueParagraph:p?.candidateValue||p?.value||parts[3]||''};
};
const equal=(a,b)=>a.subject===b.subject&&a.clinicParagraph===b.clinicParagraph&&a.valueParagraph===b.valueParagraph;
const focusOptions=[['clinical_breadth','تجربه و قضاوت بالینی','Clinical experience and judgement'],['teamwork','همکاری و هماهنگی تیمی','Teamwork and coordination'],['continuity','پیگیری و تداوم مراقبت','Follow-up and continuity'],['acute','رسیدگی به شرایط حاد','Acute clinical care'],['training','یادگیری و آموزش‌پذیری','Learning and development']];

/** Only this reviewed letter is edited. Templates retain preferences, not old clinic facts. */
export function GpLetterEditor({opportunityId,pkg,selection,subjectIndex=0,ready=false,disabled=false,requireSave=false,onSaved,onStateChange,onNeedReview,onDiscard,notify=()=>{}}){
 const language=useInterfaceLanguage(),t=(fa,en)=>language==='en'?en:fa;
 const original={subject:pkg?.subjects?.[subjectIndex]||'',...values(pkg)};
 const [draft,setDraft]=useState(original),[open,setOpen]=useState(requireSave),[busy,setBusy]=useState(''),[error,setError]=useState('');
 const [templates,setTemplates]=useState([]),[templatesLoaded,setTemplatesLoaded]=useState(false),[templateId,setTemplateId]=useState(STYLE.test(pkg?.savedTemplate?.id||pkg?.savedTemplateId||'')?pkg.savedTemplate?.id||pkg.savedTemplateId:''),[templateName,setTemplateName]=useState('');
 const [style,setStyle]=useState({focus:pkg?.savedTemplate?.style?.focus||'clinical_breadth',tone:pkg?.savedTemplate?.style?.tone||'warm_professional'});
 const mounted=useRef(true),request=useRef(0),lock=useRef(false),callbacks=useRef({onStateChange,onSaved,notify});
 callbacks.current={onStateChange,onSaved,notify};
 const dirty=requireSave||!equal(draft,original),validText=Boolean(draft.subject.trim()&&draft.clinicParagraph.trim()&&draft.valueParagraph.trim());
 const report=(changed,working)=>callbacks.current.onStateChange?.({dirty:changed,busy:Boolean(working)});
 useEffect(()=>{mounted.current=true;report(requireSave,false);if(requireSave)loadTemplates();return()=>{mounted.current=false;request.current++;lock.current=false;};},[]);
 function change(field,value){const next={...draft,[field]:value};setDraft(next);setError('');report(requireSave||!equal(next,original),busy);}
 function discard(){setDraft(original);setError('');report(false,busy);onDiscard?.();}
 function failure(code){
  const messages={
   edited_letter_context_changed:['اطلاعات مرکز یا رزومه تغییر کرده است؛ نامهٔ تازه را باز کنید.','The clinic information or CV has changed. Open a fresh letter.'],
   gp_letter_edit_context_changed:['اطلاعات مرکز یا رزومه تغییر کرده است؛ نامهٔ تازه را باز کنید.','The clinic information or CV has changed. Open a fresh letter.'],
   gp_application_evidence_required:['ابتدا اطلاعات مرکز و رزومه را بررسی و تأیید کنید.','Review and confirm the clinic information and CV first.'],
   gp_package_not_ready:['اطلاعات لازمِ نامه هنوز کامل نیست؛ بخش شواهد را بررسی کنید.','The letter requirements are incomplete. Check the evidence section.'],
   gp_edit_storage_required:['ذخیرهٔ ویرایش هنوز روی سرور آماده نیست؛ متن شما در همین صفحه حفظ شده است.','Letter editing storage is not ready on the server. Your changes are preserved on this page.'],
  };
  return messages[code]?.[language==='en'?1:0]||t('ذخیره انجام نشد. متن شما در همین صفحه باقی مانده؛ اطلاعات را بررسی و دوباره تلاش کنید.','The changes were not saved. Your text remains on this page; check the details and try again.');
 }
 async function loadTemplates(){
  if(lock.current||templatesLoaded)return;
  const seq=++request.current;lock.current=true;setBusy('templates');report(dirty,true);
  try{const result=await api('gp-writing/templates?profile=arash');if(!mounted.current||seq!==request.current)return;setTemplates((Array.isArray(result?.items)?result.items:[]).filter(item=>STYLE.test(item?.id||'')&&typeof item.name==='string'));setTemplatesLoaded(true);}
  catch(e){if(mounted.current&&seq===request.current)setError(failure(e.message));}
  finally{if(mounted.current&&seq===request.current){lock.current=false;setBusy('');report(dirty,false);}}
 }
 function edit(){setOpen(true);loadTemplates();}
 async function save(mode){
  if(lock.current||disabled||!validText||mode==='new_template'&&!templateName.trim())return;
  if(!ready){onNeedReview?.();return;}
  const seq=++request.current;let saved=false;lock.current=true;setBusy(mode);setError('');report(dirty,true);
  const body={selection,subjectIndex,subject:draft.subject.trim(),clinicParagraph:draft.clinicParagraph.trim(),valueParagraph:draft.valueParagraph.trim(),saveMode:mode,style,...(templateId?{templateId}:{}),...(mode==='new_template'?{templateName:templateName.trim()}:{}),...(EDIT.test(pkg?.editedDraftId||'')?{editedDraftId:pkg.editedDraftId}:{})};
  try{
   const result=await api('gp-writing/'+opportunityId+'/manual-edit?profile=arash',{method:'POST',body:JSON.stringify(body)});
   if(!mounted.current||seq!==request.current)return;
   if(result?.profileId!=='arash'||result.opportunityId!==opportunityId||result.cvVersionId!==selection.cvVersionId||!EDIT.test(result.editedDraftId||'')||typeof result.body!=='string')throw Error('edited_letter_context_changed');
   saved=true;setDraft({subject:result.subjects?.[subjectIndex]||draft.subject,...values(result)});report(false,false);callbacks.current.onSaved?.(result);callbacks.current.notify(t('نسخهٔ ویرایش‌شده ذخیره شد؛ متن و رزومه را در مرحلهٔ ارسال دوباره مرور کنید.','Your edited version was saved. Review the letter and CV again in the sending step.'));
  }catch(e){if(mounted.current&&seq===request.current)setError(failure(e.message));}
  finally{if(mounted.current&&seq===request.current){lock.current=false;setBusy('');report(saved?false:dirty,false);}}
 }
 async function applyTemplate(){
  if(lock.current||disabled||dirty||!STYLE.test(templateId))return;
  if(!ready){onNeedReview?.();return;}
  const seq=++request.current;lock.current=true;setBusy('apply');setError('');report(false,true);
  try{
   const result=await api('gp-writing/'+opportunityId+'/apply-template?profile=arash',{method:'POST',body:JSON.stringify({selection,templateId,subjectIndex})});
   if(!mounted.current||seq!==request.current)return;
   if(result?.profileId!=='arash'||result.opportunityId!==opportunityId||result.cvVersionId!==selection.cvVersionId||!EDIT.test(result.editedDraftId||'')||typeof result.body!=='string')throw Error('edited_letter_context_changed');
   report(false,false);callbacks.current.onSaved?.(result);callbacks.current.notify(t('قالب با اطلاعات تازهٔ همین مرکز و رزومه آماده شد؛ متن را مرور کنید.','The template has been rebuilt with this clinic’s current information and your CV. Review the letter.'));
  }catch(e){if(mounted.current&&seq===request.current)setError(failure(e.message));}
  finally{if(mounted.current&&seq===request.current){lock.current=false;setBusy('');report(false,false);}}
 }
 return <section className="gp-letter-editor" aria-label={t('ویرایش و ذخیرهٔ نامهٔ همین کلینیک','Edit and save this clinic’s letter')}>
  <div className="gp-letter-editor-heading"><div><strong>{t('متن را مطابق نظر خودتان اصلاح کنید','Make the letter your own')}</strong><small>{t('معرفی، پایان نامه و اطلاعات تماس ثابت‌اند؛ موضوع و بندهای دوم و سوم قابل ویرایش‌اند.','The introduction, closing and contact details stay fixed; you can edit the subject and paragraphs two and three.')}</small></div><button type="button" className="secondary" disabled={disabled||Boolean(busy)||open&&dirty} aria-expanded={open} onClick={()=>open?setOpen(false):edit()}><Edit3 size={15}/>{open?t('بستن ویرایشگر','Close editor'):t('ویرایش متن نامه','Edit letter')}</button></div>
  {pkg?.editedDraftId&&!dirty&&<p className="gp-letter-editor-saved" role="status"><Check size={15}/>{t('نسخهٔ ویرایش‌شدهٔ همین درخواست ذخیره شده است.','An edited version of this application has been saved.')}</p>}
  {open&&<div className="gp-letter-editor-fields">
   <label><span>{t('موضوع ایمیل','Email subject')}</span><input aria-label={t('موضوع ویرایش‌شدهٔ ایمیل','Edited email subject')} dir="ltr" value={draft.subject} maxLength={500} disabled={disabled||Boolean(busy)} onChange={e=>change('subject',e.target.value)}/></label>
   <label><span>{t('بند دوم · چرا این مرکز را انتخاب کرده‌ام؟','Paragraph two · Why do I want to join this practice?')}</span><textarea aria-label={t('ویرایش بند دوم نامه','Edit paragraph two')} dir="ltr" rows={4} value={draft.clinicParagraph} maxLength={1800} disabled={disabled||Boolean(busy)} onChange={e=>change('clinicParagraph',e.target.value)}/></label>
   <label><span>{t('بند سوم · چه چیزی به تیم اضافه می‌کنم؟','Paragraph three · What would I bring to the team?')}</span><textarea aria-label={t('ویرایش بند سوم نامه','Edit paragraph three')} dir="ltr" rows={5} value={draft.valueParagraph} maxLength={2400} disabled={disabled||Boolean(busy)} onChange={e=>change('valueParagraph',e.target.value)}/></label>
   {dirty&&<div className="gp-letter-editor-dirty" role="status"><strong>{t('تغییرات را چطور نگه داریم؟','How would you like to keep these changes?')}</strong><p>{t('پیش از رفتن به ارسال، تغییرات را ذخیره کنید یا کنار بگذارید. نسخه‌های قبلی حفظ می‌شوند.','Save or discard your changes before continuing to send. Earlier versions are preserved.')}</p></div>}
   {!ready&&<p className="section-help">{t('برای ذخیره، ابتدا تیک بررسیِ اطلاعات مرکز و رزومه را بزنید. متنِ در حال ویرایش در همین صفحه حفظ می‌شود.','To save, first confirm the clinic and CV review checkboxes. Your edits remain on this page.')}</p>}
   {error&&<p className="notice" role="alert">{error}</p>}
   <div className="gp-letter-editor-actions"><button type="button" className="primary" disabled={disabled||Boolean(busy)||!dirty||!validText} onClick={()=>save('replace')}>{busy==='replace'?<RefreshCw size={15} className="spin"/>:<Save size={15}/>} {t('ذخیره روی نسخهٔ همین نامه','Save changes to this letter')}</button><button type="button" className="text-button" disabled={disabled||Boolean(busy)||!dirty} onClick={discard}><X size={15}/>{t('کنار گذاشتن تغییرات','Discard changes')}</button></div>
   <details className="gp-letter-template-tools"><summary>{t('ساخت قالب جدید یا استفاده از قالب‌های من','Create a template or use my templates')}</summary>
    <p className="section-help">{t('قالب، لحن و تأکید دلخواه شما را نگه می‌دارد. برای مرکز بعدی، دلیل علاقه و مزیت بالینی از شواهد همان مرکز و رزومه دوباره نوشته می‌شوند؛ متن یا نام مرکز قبلی منتقل نمی‌شود.','A template keeps your preferred tone and focus. For the next clinic, the interest and clinical contribution are rewritten from that clinic’s evidence and your CV; the previous clinic’s name and facts are not reused.')}</p>
    <div className="gp-letter-style-grid"><label>{t('تأکید اصلی قالب','Template focus')}<select aria-label={t('تأکید اصلی قالب نامه','Letter template focus')} value={style.focus} disabled={disabled||Boolean(busy)} onChange={e=>setStyle({...style,focus:e.target.value})}>{focusOptions.map(([value,fa,en])=><option key={value} value={value}>{t(fa,en)}</option>)}</select></label><label>{t('لحن نامه','Letter tone')}<select aria-label={t('لحن قالب نامه','Letter template tone')} value={style.tone} disabled={disabled||Boolean(busy)} onChange={e=>setStyle({...style,tone:e.target.value})}><option value="warm_professional">{t('حرفه‌ای و صمیمی','Warm and professional')}</option><option value="formal">{t('رسمی','Formal')}</option></select></label></div>
    <label>{t('نام قالب جدید','New template name')}<input aria-label={t('نام قالب جدید نامه','New letter template name')} value={templateName} maxLength={120} disabled={disabled||Boolean(busy)} onChange={e=>setTemplateName(e.target.value)}/></label>
    <button type="button" className="secondary" disabled={disabled||Boolean(busy)||!validText||!templateName.trim()} onClick={()=>save('new_template')}>{busy==='new_template'?<RefreshCw size={15} className="spin"/>:<Plus size={15}/>} {t('ساخت قالب جدید از این ویرایش','Create a template from this edit')}</button>
    <label>{t('قالب‌های ذخیره‌شدهٔ خودم','My saved templates')}<select aria-label={t('انتخاب قالب شخصی نامه','Choose a personal letter template')} disabled={disabled||Boolean(busy)} value={templateId} onChange={e=>{setTemplateId(e.target.value);const chosen=templates.find(item=>item.id===e.target.value);if(chosen?.style)setStyle(chosen.style);}}><option value="">{t('قالب را انتخاب کنید','Choose a template')}</option>{templates.map(item=><option key={item.id} value={item.id}>{item.name} · {t('نسخهٔ ','revision ')}{item.revision}</option>)}</select></label>
    {templatesLoaded&&!templates.length&&<p className="section-help">{t('هنوز قالب شخصی ذخیره نشده است.','You have not saved a personal template yet.')}</p>}
    <button type="button" className="secondary" disabled={disabled||Boolean(busy)||dirty||!STYLE.test(templateId)} onClick={applyTemplate}>{busy==='apply'?<RefreshCw size={15} className="spin"/>:<RefreshCw size={15}/>} {t('نوشتن دوباره برای همین مرکز با این قالب','Rewrite for this clinic using this template')}</button>
   </details>
  </div>}
 </section>;
}
