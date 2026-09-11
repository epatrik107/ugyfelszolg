sessionStorage.redirect = location.pathname + location.search + location.hash;
const parts = location.pathname.split("/").filter(Boolean);
const base = parts[0] === "ugyfelszolg" ? "/ugyfelszolg/" : "/";
location.replace(base);
