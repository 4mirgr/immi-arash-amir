// Display labels only. Authorization, mailbox IDs and token scopes never depend
// on these names; connected email is supplied by the owner-scoped API.
export function googleAccountLabel(person,mailbox='primary',email){
 if(typeof email==='string'&&/^[^\s@<>]{1,64}@[^\s@<>]+$/.test(email))return email.split('@')[0];
 if(person==='amir')return mailbox==='secondary'?'amirgr20':'dr.gerami.md';
 return mailbox==='secondary'?'حساب Google دیگر آرش':'Google آرش';
}
