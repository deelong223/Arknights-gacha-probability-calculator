const path=require("node:path");
const Gacha=require(path.join(__dirname,"..","gacha.js"));
(async()=>{
  await Gacha.init();
  const ex = await Gacha.ready;
  const cases=[[[1],0,120],[[1,1,1,1,1],0,600],[[3,2,1],0,600],[[6,6,6,6,6],0,1000],[[6,6,6,6,6],0,5000]];
  for (const [t,p,b] of cases){
    Gacha.setThreshold(47); ex.statReset();
    const t0=process.hrtime.bigint();
    const v=Gacha.calculate(t,p,b);
    const ms=Number(process.hrtime.bigint()-t0)/1e6;
    console.log(`${JSON.stringify(t).padEnd(20)} b=${String(b).padStart(5)} ${ms.toFixed(1).padStart(7)}ms  states=${ex.statGet(0).toLocaleString().padStart(12)} ops=${ex.statGet(1).toLocaleString().padStart(14)} tables=${ex.statGet(2)}  -> ${(v*100).toFixed(3)}%`);
  }
})();
