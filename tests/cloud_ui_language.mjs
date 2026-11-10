import test from 'node:test';
import assert from 'node:assert/strict';
import {UI_TRANSLATIONS,translateUIString} from '../src/ui-translations.mjs';
test('English catalog values contain complete English rather than Persian placeholders',()=>{
 const entries=Object.entries(UI_TRANSLATIONS);assert(entries.length>0);
 for(const [key,value]of entries){assert.equal(typeof value,'string',key);assert(value.trim(),key);assert.equal(/[\u0600-\u06ff]/.test(value),false,key+' -> '+value);}
});
test('dynamic UI counts and mixed-script fragments retain values in English',()=>{
 assert.equal(translateUIString('۳ از ۱۲ مورد'),'3 of 12 items');
 assert.equal(/[\u0600-\u06ff]/.test(translateUIString('تناسب با شواهد موجود: ۳ از ۵ ستاره')),false);
 assert.equal(translateUIString('۱۲ نتیجه با فیلتر فعلی'),'12 results with the current filters');
 assert.equal(translateUIString(' ۱۲ ',{}),' 12 ');
 assert.equal(translateUIString('دکتر امیر هوشنگ گرامی'),'Dr Amir Houshang Gerami');
});
test('whole phrases win over word fragments and fragments never split Persian words',()=>{
 const dictionary={'موضوع':'Subject','موضوع ایمیل':'Email subject',' نسخه':' version'};
 assert.equal(translateUIString('موضوع ایمیل',dictionary),'Email subject');
 assert.equal(translateUIString('۲ نسخه',dictionary),'2 version');
 assert.equal(translateUIString('موضوعی',dictionary),'موضوعی');
 assert.equal(translateUIString('https://example.invalid/subject',dictionary),'https://example.invalid/subject');
});
test('the translator preserves formatting boundaries and has no side effects on application values',()=>{
 const original={recipient:'owner@example.invalid',body:'متن کاربر',count:2};const json=JSON.stringify(original);
 assert.equal(translateUIString('  نام قالب  ',{'نام قالب':'Template name'}),'  Template name  ');
 assert.equal(translateUIString(null),null);assert.equal(translateUIString(12),12);assert.equal(JSON.stringify(original),json);
});
