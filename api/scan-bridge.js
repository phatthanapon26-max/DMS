import {createHash,timingSafeEqual} from 'node:crypto';

const target='https://vault.freshywater.in.th/v1/sources/docs_scan/';
const source='docs_scan', maxBytes=850000;
const idFormat=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const keyFormat=/^[A-Za-z0-9_-]{43,128}$/;
const hashed=value=>createHash('sha256').update(value).digest();
const compare=(a,b)=>keyFormat.test(a)&&keyFormat.test(b)&&timingSafeEqual(hashed(a),hashed(b));

function cleanSnapshot(body) {
  if (!Number.isSafeInteger(body?.cursor)||body.cursor<=0||body.complete!==true||
      !Array.isArray(body.records)||body.records.length>6000||body.count!==body.records.length) return null;
  const identifiers=new Set(),records=[];
  for (const record of body.records) {
    const {id,data}=record??{};
    if(typeof id!=='string'||!idFormat.test(id)||identifiers.has(id.toLowerCase())||!data||
       !['draft','registered'].includes(data.state)||!['image/jpeg','application/pdf'].includes(data.media_type)||
       !Number.isSafeInteger(data.byte_count)||data.byte_count<1||data.byte_count>25_000_000||
       typeof data.updated_at!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(data.updated_at)||
       !Number.isFinite(Date.parse(data.updated_at))||
       Object.keys(data).sort().join()!=='byte_count,media_type,state,updated_at'||
       Object.keys(record).sort().join()!=='data,id') return null;
    identifiers.add(id.toLowerCase());
    records.push({id:id.toLowerCase(),data:{state:data.state,media_type:data.media_type,
      byte_count:data.byte_count,updated_at:data.updated_at}});
  }
  const result=JSON.stringify({source,cursor:body.cursor,complete:true,count:records.length,records});
  return Buffer.byteLength(result)<=maxBytes?result:null;
}

export const createHandler = (env=process.env,call=fetch) => async (req,res) => {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'method_not_allowed'});}
  if(req.headers.origin||req.headers['sec-fetch-site'])return res.status(403).json({error:'server_only'});
  const publisher=env.SCAN_BRIDGE_PUBLISHER_KEY||'',ingest=env.SCAN_BRIDGE_VAULT_INGEST_KEY||'';
  if(env.SCAN_BRIDGE_ENABLED!=='1'||!keyFormat.test(publisher)||!keyFormat.test(ingest)||compare(publisher,ingest))
    return res.status(503).json({error:'bridge_not_configured'});
  const key=(typeof req.headers.authorization==='string'&&req.headers.authorization.match(/^Bearer ([A-Za-z0-9_-]{43,128})$/)?.[1])||'';
  if(!compare(key,publisher))return res.status(401).json({error:'invalid_key'});
  if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))return res.status(415).json({error:'json_required'});
  const body=cleanSnapshot(req.body);
  if(!body)return res.status(400).json({error:'invalid_registry_snapshot'});
  const options=()=>({cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000)});
  const headers={Authorization:'Bearer '+ingest,Accept:'application/json'};
  try {
    // Permission check carries no record data. A denied or unavailable check sends no snapshot.
    const check=await call(target+'ingest-status',{...options(),headers});
    if(check.status===423||check.status===409)return res.status(423).json({error:'transfer_disabled'});
    if(!check.ok)return res.status(503).json({error:'vault_status_unavailable'});
    const {revision,generation}=await check.json();
    if(!Number.isSafeInteger(revision)||revision<0||typeof generation!=='string'||!idFormat.test(generation))
      return res.status(503).json({error:'vault_status_unavailable'});
    const result=await call(target+'ingest',{...options(),method:'POST',headers:{...headers,
      'Content-Type':'application/json','X-Freshy-Source-Generation':generation,'X-Freshy-Gate-Revision':String(revision)},body});
    if(result.status===423||result.status===409)return res.status(423).json({error:'transfer_stopped'});
    if(result.status!==202)return res.status(502).json({error:'vault_rejected_snapshot'});
    const {state}=await result.json();
    if(!['pending','unchanged','quarantined','retry'].includes(state))return res.status(502).json({error:'vault_rejected_snapshot'});
    return res.status(202).json({state});
  }catch{return res.status(503).json({error:'vault_unavailable'});}
};
export default createHandler();
