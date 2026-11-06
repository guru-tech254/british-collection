import express from 'express';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

dotenv.config();
const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(__dirname));
const PORT = process.env.PORT || 3000;
const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null;

const required = ['MPESA_CONSUMER_KEY','MPESA_CONSUMER_SECRET','MPESA_SHORTCODE','MPESA_PASSKEY','MPESA_CALLBACK_URL'];
function configCheck(){ const missing=required.filter(k=>!process.env[k]); if(missing.length) throw new Error('M-Pesa is not configured on the server. Missing: '+missing.join(', ')); }
function normalizePhone(input){
  let p=String(input||'').replace(/\D/g,'');
  if(p.startsWith('0') && p.length===10) p='254'+p.slice(1);
  if(p.startsWith('7')||p.startsWith('1')) p='254'+p;
  if(!/^254[17]\d{8}$/.test(p)) throw new Error('Enter a valid Kenyan Safaricom number, e.g. 0712345678.');
  return p;
}
function timestamp(){const d=new Date();return d.getFullYear()+String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0')+String(d.getHours()).padStart(2,'0')+String(d.getMinutes()).padStart(2,'0')+String(d.getSeconds()).padStart(2,'0')}
async function mpesaToken(){
  configCheck();
  const auth=Buffer.from(process.env.MPESA_CONSUMER_KEY+':'+process.env.MPESA_CONSUMER_SECRET).toString('base64');
  const base=process.env.MPESA_ENV==='production'?'https://api.safaricom.co.ke':'https://sandbox.safaricom.co.ke';
  const r=await fetch(base+'/oauth/v1/generate?grant_type=client_credentials',{headers:{Authorization:'Basic '+auth}});
  const j=await r.json();if(!r.ok||!j.access_token)throw new Error(j.errorMessage||'Could not authenticate with M-Pesa.');
  return {token:j.access_token,base};
}
app.get('/api/health',(req,res)=>res.json({ok:true,mpesaConfigured:required.every(k=>!!process.env[k]),databaseConfigured:!!supabase}));
app.post('/api/mpesa/stkpush',async(req,res)=>{
  try{
    const {name,email,phone,address,items}=req.body||{};
    if(!supabase) return res.status(503).json({error:'Order storage is not configured. Connect Supabase before accepting payments.'});
    if(!name||!email||!address||!Array.isArray(items)||!items.length) return res.status(400).json({error:'Missing required order details.'});
    const msisdn=normalizePhone(phone);
    const catalog={1:7670,2:8320,3:16770,4:12870,5:3770,6:4420,7:8970,8:7020,9:3250,10:5070,11:2860,12:1820};
    const safeItems=items.map(i=>{const unitPrice=catalog[Number(i.id)],quantity=Math.max(1,Math.min(20,Math.floor(Number(i.quantity)||1)));if(!unitPrice)throw new Error('A product in your cart is no longer available.');return {id:Number(i.id),name:String(i.name||'Product').slice(0,120),category:String(i.category||'').slice(0,60),size:String(i.size||'').slice(0,20),quantity,unitPrice};});
    const subtotal=safeItems.reduce((sum,i)=>sum+i.unitPrice*i.quantity,0);
    const delivery=subtotal>=13000?0:350;
    const amount=subtotal+delivery;
    const orderNo='BC-'+crypto.randomInt(100000,999999);
    const {error:saveError}=await supabase.from('orders').insert({order_no:orderNo,customer_name:name,email,phone:msisdn,address,items:safeItems,subtotal,delivery,total:amount,status:0});
    if(saveError){console.error('Order insert error:',saveError.message);return res.status(500).json({error:'Could not save your order. Please try again.'})}
    const {token,base}=await mpesaToken();
    const ts=timestamp(),shortcode=process.env.MPESA_SHORTCODE;
    const password=Buffer.from(shortcode+process.env.MPESA_PASSKEY+ts).toString('base64');
    const payload={BusinessShortCode:shortcode,Password:password,Timestamp:ts,TransactionType:process.env.MPESA_TRANSACTION_TYPE||'CustomerPayBillOnline',Amount:amount,PartyA:msisdn,PartyB:shortcode,PhoneNumber:msisdn,CallBackURL:process.env.MPESA_CALLBACK_URL,AccountReference:orderNo,TransactionDesc:'British Collection order '+orderNo};
    const response=await fetch(base+'/mpesa/stkpush/v1/processrequest',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const result=await response.json();
    if(!response.ok||result.ResponseCode!=='0') {
      await supabase.from('orders').update({status:5,mpesa_result_desc:result.errorMessage||result.ResponseDescription||'M-Pesa rejected the payment request.'}).eq('order_no',orderNo);
      return res.status(502).json({error:result.errorMessage||result.ResponseDescription||'M-Pesa rejected the payment request.'});
    }
    const {error:updateError}=await supabase.from('orders').update({merchant_request_id:result.MerchantRequestID,checkout_request_id:result.CheckoutRequestID}).eq('order_no',orderNo);
    if(updateError) console.error('Order payment-reference update error:',updateError.message);
    res.json({ok:true,orderNo,phone:msisdn,amount,checkoutRequestId:result.CheckoutRequestID,message:result.CustomerMessage||'STK push sent'});
  }catch(e){res.status(400).json({error:e.message||'Unable to start M-Pesa payment.'})}
});
app.post('/api/mpesa/callback',async(req,res)=>{
  try{
    const callback=req.body?.Body?.stkCallback;
    if(!callback) return res.json({ResultCode:0,ResultDesc:'Accepted'});
    const metadata=callback.CallbackMetadata?.Item||[];
    const receipt=metadata.find(x=>x.Name==='MpesaReceiptNumber')?.Value||null;
    const paidAmount=metadata.find(x=>x.Name==='Amount')?.Value||null;
    const phone=metadata.find(x=>x.Name==='PhoneNumber')?.Value||null;
    if(supabase){
      const {error}=await supabase.from('orders').update({status:callback.ResultCode===0?1:5,mpesa_receipt:receipt,paid_amount:paidAmount,paid_phone:phone,mpesa_result_code:callback.ResultCode,mpesa_result_desc:callback.ResultDesc,updated_at:new Date().toISOString()}).eq('checkout_request_id',callback.CheckoutRequestID);
      if(error) console.error('M-Pesa callback update error:',error.message);
    }
    res.json({ResultCode:0,ResultDesc:'Accepted'});
  }catch(e){console.error('Callback error:',e);res.json({ResultCode:0,ResultDesc:'Accepted'})}
});
app.get('/api/orders/:orderNo',async(req,res)=>{
  if(!supabase) return res.status(503).json({error:'Order tracking database is not configured yet.'});
  const {data,error}=await supabase.from('orders').select('order_no,items,total,status,created_at').eq('order_no',req.params.orderNo.toUpperCase()).maybeSingle();
  if(error) return res.status(500).json({error:'Could not retrieve this order.'});
  if(!data) return res.status(404).json({error:'We could not find that order number.'});
  res.json({orderNo:data.order_no,items:data.items,total:data.total,status:data.status,createdAt:data.created_at});
});
app.listen(PORT,()=>console.log(`British Collection running at http://localhost:${PORT}`));
