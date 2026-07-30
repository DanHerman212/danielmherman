/* esm.sh - @lit/reactive-element@2.1.2/decorators/query-assigned-elements */
import{desc as m}from"./lit_reactive-element_2.1.2_es2022_decorators_base.mjs.js";function u(e){return(n,o)=>{let{slot:t,selector:r}=e??{},c="slot"+(t?`[name=${t}]`:":not([name])");return m(n,o,{get(){let i=this.renderRoot?.querySelector(c),s=i?.assignedElements(e)??[];return r===void 0?s:s.filter(l=>l.matches(r))}})}}export{u as queryAssignedElements};
/*! Bundled license information:

@lit/reactive-element/decorators/query-assigned-elements.js:
  (**
   * @license
   * Copyright 2021 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)
*/
