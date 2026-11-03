import React from 'react';
import {mixedTextParts} from './mixed-text-utils.mjs';
export {mixedTextParts} from './mixed-text-utils.mjs';
export function MixedText({children,text}){const value=text===undefined?children:text;if(typeof value!=='string'&&typeof value!=='number')return <>{value}</>;return <>{mixedTextParts(value).map((part,i)=>part.latin?<bdi key={i} dir="ltr" style={{unicodeBidi:'isolate'}}>{part.text}</bdi>:<React.Fragment key={i}>{part.text}</React.Fragment>)}</>;}
