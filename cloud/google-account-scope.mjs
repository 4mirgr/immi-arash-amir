import {GoogleError,GOOGLE_SECONDARY_MAILBOX_SUFFIX} from './google-oauth.mjs';

// Only the authenticated router may supply trustedContext. The browser may select
// an authorized slot, never an owner ID or token. Existing primary identities keep
// their exact storage/encryption binding, so this feature needs no migration.
export function googleAccountContext(request,trustedContext){
 if(typeof trustedContext?.userId!=='string'||!trustedContext.userId||!['amir','arash'].includes(trustedContext.profileId)||trustedContext.userId.includes(':'))throw new GoogleError(403,'owner_required','An authenticated workspace owner is required');
 const url=new URL(request.url),values=url.searchParams.getAll('mailbox');
 if(values.length>1||values.length===1&&!['primary','secondary'].includes(values[0]))throw new GoogleError(400,'invalid_mailbox','Select a valid mailbox');
 const mailbox=values[0]||'primary';
 if(mailbox==='secondary'&&trustedContext.profileId!=='amir')throw new GoogleError(403,'mailbox_access_denied','This mailbox is unavailable for this workspace');
 if(mailbox==='secondary'&&url.pathname.startsWith('/api/google/drive/'))throw new GoogleError(403,'mailbox_service_not_enabled','General Drive tools use the primary Google account');
 return {...trustedContext,rootUserId:trustedContext.userId,mailbox,userId:trustedContext.userId+(mailbox==='secondary'?GOOGLE_SECONDARY_MAILBOX_SUFFIX:'')};
}
