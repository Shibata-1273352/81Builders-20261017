'use client';
import { useState, useEffect } from 'react';
import { Presentation } from 'lucide-react';

// Presentation mode: larger type and heavier lines for a projector, set as html[data-present].
// Entered from the header button, the P key or ?present=1; remembered per browser.
export function usePresent():[boolean,()=>void]{
 const [on,setOn]=useState(false);
 useEffect(()=>{
  let v=false;
  try{v=localStorage.getItem('tsumugi-present')==='1'}catch{}
  const q=new URLSearchParams(location.search).get('present');
  if(q!==null)v=q!=='0';
  setOn(v);
 },[]);
 useEffect(()=>{
  const root=document.documentElement;
  if(on)root.dataset.present='';else delete root.dataset.present;
  try{localStorage.setItem('tsumugi-present',on?'1':'0')}catch{}
 },[on]);
 useEffect(()=>{
  function key(e:KeyboardEvent){
   const t=e.target as HTMLElement;
   if(e.key.toLowerCase()!=='p'||e.metaKey||e.ctrlKey||e.altKey||t.closest('input,textarea,select,[contenteditable]'))return;
   setOn(v=>!v);
  }
  window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
 },[]);
 return [on,()=>setOn(v=>!v)];
}

export function PresentButton({on,toggle}:{on:boolean;toggle:()=>void}){
 return <button className={'present-toggle'+(on?' active':'')} aria-pressed={on} onClick={toggle} title="Presentation mode (P)"><Presentation size={15}/>Present</button>;
}
