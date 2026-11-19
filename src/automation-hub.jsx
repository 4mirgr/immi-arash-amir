import React,{useEffect,useState} from 'react';
import {Activity,Bell,Mail,ShieldCheck,Sparkles} from 'lucide-react';
import {useInterfaceLanguage} from './interface-locale.mjs';
import {ToolsSection,ToolsWorkspace} from './tools-workspace';
import {AiAssistant} from './ai-assistant';
import {MailAutomation} from './mail-automation';
import {TelegramSettings} from './telegram-settings';
import {OwnerBackup} from './owner-backup';
import {OperationsPanel} from './operations-panel';
const tabs=[['operations','وضعیت و کنترل'],['ai','دستیار AI'],['mail','آماده‌سازی مکاتبات'],['telegram','اعلان تلگرام'],['backup','پشتیبان خصوصی']];
const validTab=value=>tabs.some(([id])=>id===value)?value:'operations';
export function AutomationHub({person,notify,initialTab='operations',onNavigate}){
 const language=useInterfaceLanguage(),t=(fa,en)=>language==='en'?en:fa;
 const preferred=validTab(initialTab),[view,setView]=useState({person,tab:preferred==='operations'?null:preferred,sequence:0});
 useEffect(()=>{setView(previous=>({person,tab:preferred==='operations'?null:preferred,sequence:previous.sequence+1}));},[person,preferred]);
 const openTab=value=>setView(previous=>({person,tab:validTab(value),sequence:previous.sequence+1}));
 const requested=view.person===person&&view.tab?'automation-'+view.tab:null;
 return <ToolsWorkspace className="automation-workspace" title={t('ابزارهای حساب من','My account tools')} hint={t('فقط ابزار موردنیازتان را باز کنید. وضعیت و تنظیمات هر ابزار در همان بخش است.','Open only the tool you need. Its status and settings stay in that section.')}>
  <ToolsSection id="automation-operations" title={t('وضعیت سرویس‌ها و کارهای منتظر','Status and pending actions')} hint={t('اتصال‌ها، زمان‌بندی‌های ثبت‌شده و کارهایی که به پیگیری نیاز دارند.','Connections, saved schedules and actions that need attention.')} icon={Activity} requestedId={requested} requestSequence={view.sequence}><OperationsPanel person={person} notify={notify}/></ToolsSection>
  <ToolsSection id="automation-telegram" title={t('اعلان‌های تلگرام','Telegram notifications')} hint={t('اتصال بات شخصی، روشن یا خاموش کردن اعلان‌ها و ساعت سکوت.','Connect your own bot chat, manage notifications and set quiet hours.')} icon={Bell} requestedId={requested} requestSequence={view.sequence}><TelegramSettings person={person} notify={notify}/></ToolsSection>
  <ToolsSection id="automation-mail" title={t('پیشنهادها و زمان‌بندی ایمیل','Email suggestions and schedules')} hint={t('آماده‌سازی درخواست‌ها و مدیریت ارسال‌هایی که خودتان تأیید کرده‌اید.','Prepare applications and manage sends that you have approved.')} icon={Mail} requestedId={requested} requestSequence={view.sequence}><MailAutomation person={person} notify={notify} onNavigate={onNavigate}/></ToolsSection>
  <ToolsSection id="automation-ai" title={t('کمک برای تحلیل و نوشتن','Help with analysis and writing')} hint={t('متن یا آگهی مشخصی را برای تحلیل و بهترکردن پیش‌نویس انتخاب کنید.','Choose a specific text or listing to analyse and improve a draft.')} icon={Sparkles} requestedId={requested} requestSequence={view.sequence}><AiAssistant person={person} notify={notify} onOpenTab={openTab}/></ToolsSection>
  <ToolsSection id="automation-backup" title={t('پشتیبان اطلاعات من','Back up my information')} hint={t('دریافت نسخهٔ رمزگذاری‌شده و بررسی فایل پشتیبان همین حساب.','Download an encrypted copy and check this account’s backup file.')} icon={ShieldCheck} requestedId={requested} requestSequence={view.sequence}><OwnerBackup person={person} notify={notify}/></ToolsSection>
 </ToolsWorkspace>;
}
