function e(n){return n.replace(/\D/g,"")}function t(n){const r=e(n);return r.length!==11?n:r.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,"$1.$2.$3-$4")}export{t as f,e as n};
