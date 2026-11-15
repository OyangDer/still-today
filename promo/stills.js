const { chromium } = require('playwright');
const path=require('path');
(async()=>{
  const times=process.argv.slice(3).map(Number); const out=process.argv[2];
  const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});
  p.on('console',m=>console.log('console:',m.text())); p.on('pageerror',e=>console.log('ERR',e.message));
  await p.goto('file://'+path.resolve(__dirname,'index.html'));
  await p.evaluate(()=>document.fonts.ready);
  await p.waitForTimeout(500);
  for(const t of times){ await p.evaluate(t=>render(t),t); await p.evaluate(()=>document.fonts.ready); await p.screenshot({path:`${out}/s_${t.toFixed(2)}.jpg`,type:'jpeg',quality:85}); }
  await b.close();
})();
