/* esm.sh - lit-html@3.3.3/directive-helpers */
import{_$LH as m}from"./lit-html_3.3.3_es2022_lit-html.mjs.js";var{I:c}=m,_=e=>e,v=e=>e===null||typeof e!="object"&&typeof e!="function",u={HTML:1,SVG:2,MATHML:3},f=(e,i)=>i===void 0?e?._$litType$!==void 0:e?._$litType$===i,T=e=>e?._$litType$?.h!=null,P=e=>e?._$litDirective$!==void 0,g=e=>e?._$litDirective$,y=e=>e.strings===void 0,o=()=>document.createComment(""),C=(e,i,t)=>{let a=e._$AA.parentNode,l=i===void 0?e._$AB:i._$AA;if(t===void 0){let r=a.insertBefore(o(),l),$=a.insertBefore(o(),l);t=new c(r,$,e,e.options)}else{let r=t._$AB.nextSibling,$=t._$AM,n=$!==e;if(n){let s;t._$AQ?.(e),t._$AM=e,t._$AP!==void 0&&(s=e._$AU)!==$._$AU&&t._$AP(s)}if(r!==l||n){let s=t._$AA;for(;s!==r;){let A=_(s).nextSibling;_(a).insertBefore(s,l),s=A}}}return t},M=(e,i,t=e)=>(e._$AI(i,t),e),p={},R=(e,i=p)=>e._$AH=i,B=e=>e._$AH,H=e=>{e._$AR(),e._$AA.remove()},x=e=>{e._$AR()};export{u as TemplateResultType,x as clearPart,B as getCommittedValue,g as getDirectiveClass,C as insertPart,T as isCompiledTemplateResult,P as isDirectiveResult,v as isPrimitive,y as isSingleExpression,f as isTemplateResult,H as removePart,M as setChildPartValue,R as setCommittedValue};
/*! Bundled license information:

lit-html/directive-helpers.js:
  (**
   * @license
   * Copyright 2020 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)
*/
