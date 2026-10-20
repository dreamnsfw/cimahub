// Only the build process installs an observer; public requests never write.
let observer;
export function observePreparedWorks(callback){observer=callback;}
export function rememberPreparedWork(item){observer?.(item);}
