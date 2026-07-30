/* esm.sh - lit-html@3.3.3/static */
import{html as p,svg as S,mathml as v}from"./lit-html_3.3.3_es2022_lit-html.mjs.js";var u=Symbol.for(""),d=t=>{if(t?.r===u)return t?._$litStatic$},_=t=>({_$litStatic$:t,r:u}),w=(t,...a)=>({_$litStatic$:a.reduce((l,i,o)=>l+(e=>{if(e._$litStatic$!==void 0)return e._$litStatic$;throw Error(`Value passed to 'literal' function must be a 'literal' result: ${e}. Use 'unsafeStatic' to pass non-literal values, but
            take care to ensure page security.`)})(i)+t[o+1],t[0]),r:u}),m=new Map,c=t=>(a,...l)=>{let i=l.length,o,e,r=[],$=[],n,s=0,f=!1;for(;s<i;){for(n=a[s];s<i&&(e=l[s],(o=d(e))!==void 0);)n+=o+a[++s],f=!0;s!==i&&$.push(e),r.push(n),s++}if(s===i&&r.push(a[i]),f){let h=r.join("$$lit$$");(a=m.get(h))===void 0&&(r.raw=r,m.set(h,a=r)),l=$}return t(a,...l)},b=c(p),y=c(S),j=c(v);export{b as html,w as literal,j as mathml,y as svg,_ as unsafeStatic,c as withStatic};
/*! Bundled license information:

lit-html/static.js:
  (**
   * @license
   * Copyright 2020 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)
*/
