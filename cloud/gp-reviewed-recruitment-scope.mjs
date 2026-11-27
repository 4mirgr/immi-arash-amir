// Only these reviewed multi-role pages need a specific GP hiring section.
const queenStreet='https://queenstreetfmc.com.au/careers.html';
const ausdocs='https://ausdocsgroup.com.au/careers/';
const punctuate=text=>text.split(/\n+/).map(line=>line.trim()).filter(Boolean).map(line=>/[.!?;]$/.test(line)?line:line+'.').join('\n');

export function reviewedGpRecruitmentText(url,visibleText){
 if(url===queenStreet){
  const section=visibleText.match(/(?:^|\n)(Training Doctors[^\n]*GP Registrars)\s*\n([\s\S]{120,4500}?)(?=\n(?:Space available|Consulting Rooms for Allied Health)\b)/i);
  return section?punctuate(section[1]+'\n'+section[2]):null;
 }
 if(url===ausdocs){
  const heading=visibleText.match(/(?:^|\n)(General Expressions of Interest)\n[^\n]*\n([^\n]{30,500})/i);
  const role=visibleText.match(/(?:^|\n)(General Practitioner[^\n]*International Interest\nAusdocs Group\n[^\n]{2,80})(?=\n|$)/i);
  const contact=visibleText.match(/(?:^|\n)(Career Enquiry\n[A-Z0-9._+-]+@ausdocsgroup\.com\.au)(?=\n|$)/i);
  return heading&&role?punctuate([heading[1],heading[2],role[1],contact?.[1]].filter(Boolean).join('\n')):null;
 }
 return visibleText;
}

export function reviewedGpRecruitmentMarkup(url,html){
 if(url===queenStreet){
  return /<h2\b[^>]*>\s*Training Doctors[^<]*GP Registrars\s*<\/h2>([\s\S]{120,12000}?)<h2\b[^>]*>\s*Consulting Rooms for Allied Health/i.exec(html)?.[1]||'';
 }
 if(url===ausdocs){
  return /<h3\b[^>]*>\s*Career Enquiry\s*<\/h3>([\s\S]{1,600}?<a\b[^>]*href=["']mailto:[^"']+@ausdocsgroup\.com\.au["'][^>]*>[^<]*<\/a>)/i.exec(html)?.[1]||'';
 }
 return html;
}
