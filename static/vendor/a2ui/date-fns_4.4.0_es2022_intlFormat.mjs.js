/* esm.sh - date-fns@4.4.0/intlFormat */
import{toDate as o}from"./date-fns_4.4.0_es2022_toDate.mjs.js";function r(t,e,n){let i;return f(e)?i=e:n=e,new Intl.DateTimeFormat(n?.locale,i).format(o(t))}function f(t){return t!==void 0&&!("locale"in t)}var u=r;export{u as default,r as intlFormat};
