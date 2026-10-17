'use client';
import { useContext, createContext, ReactNode } from 'react';

// Shared by the page and the Graph view; app/page.tsx itself may only export the page.
export type Mode='both'|'en'|'ja';
export const Lang=createContext<Mode>('both');
export function pick(mode:Mode,en:string,ja?:string|null){return !ja||mode==='en'?en:mode==='ja'?ja:`${en} · ${ja}`}
export function Bi({en,ja,inline}:{en:ReactNode;ja?:ReactNode|null;inline?:boolean}){const mode=useContext(Lang);if(!ja||mode==='en')return <span lang="en">{en}</span>;if(mode==='ja')return <span lang="ja">{ja}</span>;return <span className={'bi'+(inline?' inline':'')}><span lang="en">{en}</span><span lang="ja">{ja}</span></span>}
