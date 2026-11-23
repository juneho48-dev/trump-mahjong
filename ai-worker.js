import {chooseDiscard,chooseClaim} from './engine.js';
self.onmessage=({data})=>{
  try {
    const result=data.kind==='claim'?chooseClaim(data.view,data.offered,data.options):chooseDiscard(data.view);
    self.postMessage({id:data.id,result});
  } catch(error){self.postMessage({id:data.id,error:error.message});}
};
