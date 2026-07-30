/* esm.sh - date-fns@4.4.0/_lib/getTimezoneOffsetInMilliseconds */
import{toDate as o}from"./date-fns_4.4.0_es2022_toDate.mjs.js";function l(t){let e=o(t),n=new Date(Date.UTC(e.getFullYear(),e.getMonth(),e.getDate(),e.getHours(),e.getMinutes(),e.getSeconds(),e.getMilliseconds()));return n.setUTCFullYear(e.getFullYear()),+t-+n}export{l as getTimezoneOffsetInMilliseconds};
