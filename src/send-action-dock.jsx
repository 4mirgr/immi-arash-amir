import React,{useLayoutEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import './send-action-dock.css';

// A single viewport stack keeps actions out of clipped advertisement rows.
// Each mounted control owns its own slot; closing one cannot remove another.
function acquireSlot(){
 let host=document.getElementById('opportunity-send-action-stack');
 if(!host){
  host=document.createElement('div');host.id='opportunity-send-action-stack';host.className='send-action-stack';
  document.body.appendChild(host);
  const measure=()=>{if(host.isConnected&&host.childElementCount)document.documentElement.style.setProperty('--send-action-stack-height',Math.ceil(host.getBoundingClientRect().height)+'px');};
  host.__sendActionMeasure=measure;
  if(typeof ResizeObserver!=='undefined'){host.__sendActionObserver=new ResizeObserver(measure);host.__sendActionObserver.observe(host);}
 }
 const slot=document.createElement('div');slot.className='send-action-stack-slot';host.appendChild(slot);
 document.documentElement.classList.add('has-send-action-stack');host.__sendActionMeasure?.();
 return {slot,release(){slot.remove();if(host.childElementCount){host.__sendActionMeasure?.();return;}host.__sendActionObserver?.disconnect();host.remove();document.documentElement.classList.remove('has-send-action-stack');document.documentElement.style.removeProperty('--send-action-stack-height');}};
}

export function FloatingSendDock({children}){
 const [target,setTarget]=useState(null);
 useLayoutEffect(()=>{const handle=acquireSlot();setTarget(handle.slot);return()=>handle.release();},[]);
 return target?createPortal(children,target):null;
}
