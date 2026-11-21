import {createServer} from 'node:http';
import Worker from '../worker/index.js';
const snapshot={
  run:{mode:'write',status:'success',at:'2026-11-21T12:00:00Z',runUrl:null,tasks:{created:2}},
  currentCourses:[{id:'demo-cs',name:'示例 · 数据结构'},{id:'demo-lab',name:'示例 · 数字电路'}],
  notices:[
    {courseId:'demo-cs',title:'示例：作业安排',date:'2026-11-21T10:00:00Z',unread:true,detail:'这是一条虚构通知，不代表实际课程安排。'},
    {courseId:'demo-lab',title:'示例：实验要求',date:'2026-11-20T09:00:00Z',unread:true,detail:'这里可展开查看通知正文。'}
  ],
  resources:[
    {course:'示例 · 数据结构',materialId:'demo-text',title:'树结构与遍历.pdf',kind:'PDF',contentText:'示例文字：树的层序遍历可以借助队列。',contentComplete:true},
    {course:'示例 · 数字电路',title:'时钟与计数器.pptx',kind:'PPTX'}
  ]
};
const env={BUCKET:{get:async()=>({json:async()=>snapshot})}};
createServer(async (incoming,outgoing)=>{
  if(incoming.method!=='GET'||(incoming.url??'').startsWith('/api/')){
    outgoing.writeHead(404).end();return;
  }
  const url=new URL(incoming.url,'http://127.0.0.1:4173');
  if(url.origin!=='http://127.0.0.1:4173'){outgoing.writeHead(400).end();return;}
  const r=await Worker.fetch(new Request(url,{headers:{'oai-authenticated-user-id':'local-demo'}}),env);
  outgoing.writeHead(r.status,Object.fromEntries(r.headers));
  outgoing.end(Buffer.from(await r.arrayBuffer()));
}).listen(4173,'127.0.0.1',()=>console.log('Demo: http://127.0.0.1:4173/ (synthetic data only)'));
