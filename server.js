require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const Database = require("better-sqlite3");
const crypto = require("crypto");
const Razorpay = require("razorpay");
const path = require("path");

const app = express();
const db = new Database("uzran.db");
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, phone TEXT UNIQUE, name TEXT, role TEXT DEFAULT 'customer', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sellers(id INTEGER PRIMARY KEY, user_id INTEGER UNIQUE, store_name TEXT, status TEXT DEFAULT 'pending', FOREIGN KEY(user_id) REFERENCES users(id));
CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY, seller_id INTEGER, name TEXT NOT NULL, description TEXT DEFAULT '', category TEXT DEFAULT 'Other', price INTEGER NOT NULL, stock INTEGER DEFAULT 0, image TEXT DEFAULT '', active INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(seller_id) REFERENCES sellers(id));
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY, user_id INTEGER, total INTEGER NOT NULL, address TEXT NOT NULL, phone TEXT NOT NULL, status TEXT DEFAULT 'placed', payment_method TEXT DEFAULT 'COD', payment_status TEXT DEFAULT 'pending', razorpay_order_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS order_items(id INTEGER PRIMARY KEY, order_id INTEGER, product_id INTEGER, seller_id INTEGER, name TEXT, price INTEGER, qty INTEGER, FOREIGN KEY(order_id) REFERENCES orders(id));
CREATE TABLE IF NOT EXISTS otps(phone TEXT PRIMARY KEY, code_hash TEXT, expires INTEGER, attempts INTEGER DEFAULT 0);
`);
const PORT = Number(process.env.PORT || 3000);
const sessions = new Map(); // In-memory sessions; use Redis/shared session store for production.
const otpLimiter = rateLimit({windowMs: 15*60*1000, limit: 5, standardHeaders: true, legacyHeaders: false});
const apiLimiter = rateLimit({windowMs: 60*1000, limit: 120, standardHeaders: true, legacyHeaders: false});
const allowedOrigins = new Set((process.env.CORS_ORIGINS || "capacitor://localhost,http://localhost,https://localhost").split(",").map(x=>x.trim()).filter(Boolean));
app.use((req,res,next)=>{
  const origin=req.headers.origin;
  if(origin && allowedOrigins.has(origin)){
    res.setHeader("Access-Control-Allow-Origin",origin);
    res.setHeader("Vary","Origin");
    res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods","GET, POST, PATCH, DELETE, OPTIONS");
  }
  if(req.method==="OPTIONS") return res.sendStatus(204);
  next();
});
app.use(helmet({contentSecurityPolicy: false}));
app.use(express.json({limit:"200kb"}));
app.use("/api", apiLimiter);
app.use(express.static(path.join(__dirname,"public")));

function token(){ return crypto.randomBytes(32).toString("hex"); }
function auth(req,res,next){
  const t=(req.headers.authorization||"").replace(/^Bearer\s+/i,"");
  const s=sessions.get(t);
  if(!s || s.expires<Date.now()){ if(t)sessions.delete(t); return res.status(401).json({error:"Login आवश्यक है"}); }
  req.user=s.user; req.token=t; next();
}
function role(...roles){ return (req,res,next)=> roles.includes(req.user.role)?next():res.status(403).json({error:"अनुमति नहीं है"}); }
function validPhone(p){return /^[6-9]\d{9}$/.test(String(p||""));}
function clean(v,max=180){return String(v??"").trim().slice(0,max);}
function razorpay(){
  if(!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) return null;
  return new Razorpay({key_id:process.env.RAZORPAY_KEY_ID,key_secret:process.env.RAZORPAY_KEY_SECRET});
}
app.get("/api/health",(req,res)=>res.json({ok:true,app:"UZRAN",mode:process.env.NODE_ENV||"development"}));

app.post("/api/auth/otp/request",otpLimiter,(req,res)=>{
  const phone=clean(req.body.phone,10);
  if(!validPhone(phone)) return res.status(400).json({error:"सही 10 अंकों का मोबाइल नंबर डालें"});
  const code=String(crypto.randomInt(100000,1000000));
  const hash=crypto.createHash("sha256").update(code+(process.env.SESSION_SECRET||"local")).digest("hex");
  db.prepare("INSERT OR REPLACE INTO otps(phone,code_hash,expires,attempts) VALUES(?,?,?,0)").run(phone,hash,Date.now()+5*60*1000);
  if(process.env.DEV_OTP==="true" && process.env.NODE_ENV!=="production") console.log(`[UZRAN DEV OTP] ${phone}: ${code}`);
  res.json({message:"OTP अनुरोध स्वीकार हुआ। SMS सेवा कॉन्फ़िगर होने पर OTP भेजा जाएगा।"});
});
app.post("/api/auth/otp/verify",(req,res)=>{
  const phone=clean(req.body.phone,10), code=clean(req.body.code,6);
  const row=db.prepare("SELECT * FROM otps WHERE phone=?").get(phone);
  if(!row || row.expires<Date.now() || row.attempts>=5) return res.status(400).json({error:"OTP समाप्त या अमान्य है"});
  const hash=crypto.createHash("sha256").update(code+(process.env.SESSION_SECRET||"local")).digest("hex");
  if(hash!==row.code_hash){db.prepare("UPDATE otps SET attempts=attempts+1 WHERE phone=?").run(phone);return res.status(400).json({error:"गलत OTP"});}
  db.prepare("DELETE FROM otps WHERE phone=?").run(phone);
  let user=db.prepare("SELECT * FROM users WHERE phone=?").get(phone);
  if(!user){const id=db.prepare("INSERT INTO users(phone) VALUES(?)").run(phone).lastInsertRowid;user=db.prepare("SELECT * FROM users WHERE id=?").get(id);}
  const t=token();sessions.set(t,{user:{id:user.id,phone:user.phone,role:user.role,name:user.name},expires:Date.now()+7*24*60*60*1000});
  res.json({token:t,user:sessions.get(t).user});
});
app.post("/api/auth/admin",(req,res)=>{
  const email=clean(req.body.email,120), password=String(req.body.password||"");
  if(!process.env.ADMIN_PASSWORD || password!==process.env.ADMIN_PASSWORD || email!== (process.env.ADMIN_EMAIL||"owner@uzran.in")) return res.status(401).json({error:"Admin credentials गलत हैं"});
  const t=token();sessions.set(t,{user:{id:0,phone:"",role:"admin",name:"UZRAN Owner"},expires:Date.now()+8*60*60*1000});
  res.json({token:t,user:sessions.get(t).user});
});
app.get("/api/me",auth,(req,res)=>res.json({user:req.user}));
app.post("/api/auth/logout",auth,(req,res)=>{sessions.delete(req.token);res.json({ok:true});});

app.get("/api/products",(req,res)=>{
  const rows=db.prepare(`SELECT p.id,p.name,p.description,p.category,p.price,p.stock,p.image,s.store_name
    FROM products p LEFT JOIN sellers s ON s.id=p.seller_id WHERE p.active=1 AND p.stock>0 AND (s.status='approved' OR p.seller_id IS NULL) ORDER BY p.id DESC`).all();
  res.json({products:rows});
});
app.post("/api/sellers/register",auth,(req,res)=>{
  const store=clean(req.body.storeName,100);
  if(!store) return res.status(400).json({error:"दुकान का नाम जरूरी है"});
  const exists=db.prepare("SELECT id FROM sellers WHERE user_id=?").get(req.user.id);
  if(exists) return res.status(409).json({error:"आपका Seller आवेदन पहले से मौजूद है"});
  const id=db.prepare("INSERT INTO sellers(user_id,store_name) VALUES(?,?)").run(req.user.id,store).lastInsertRowid;
  res.json({message:"Seller आवेदन जमा हुआ। Admin approval के बाद बिक्री शुरू होगी।",sellerId:id});
});
function sellerIdFor(userId){return db.prepare("SELECT id,status,store_name FROM sellers WHERE user_id=?").get(userId);}
app.get("/api/seller/me",auth,(req,res)=>{
  const s=sellerIdFor(req.user.id); if(!s)return res.status(404).json({error:"Seller profile नहीं मिला"});
  res.json({seller:s});
});
app.get("/api/seller/products",auth,role("seller","customer"),(req,res)=>{
  const s=sellerIdFor(req.user.id);if(!s)return res.status(404).json({error:"Seller profile नहीं मिला"});
  res.json({products:db.prepare("SELECT * FROM products WHERE seller_id=? ORDER BY id DESC").all(s.id),seller:s});
});
app.post("/api/seller/products",auth,(req,res)=>{
  const s=sellerIdFor(req.user.id);if(!s)return res.status(403).json({error:"पहले Seller registration करें"});
  if(s.status!=="approved")return res.status(403).json({error:"Admin approval के बाद ही product जोड़ सकते हैं"});
  const name=clean(req.body.name,120),category=clean(req.body.category,60),description=clean(req.body.description,500);
  const price=Number(req.body.price),stock=Number(req.body.stock||0),image=clean(req.body.image,500);
  if(!name||!Number.isInteger(price)||price<1||price>10000000||!Number.isInteger(stock)||stock<0||stock>100000)return res.status(400).json({error:"Product विवरण/कीमत/स्टॉक सही भरें"});
  const id=db.prepare("INSERT INTO products(seller_id,name,description,category,price,stock,image) VALUES(?,?,?,?,?,?,?)").run(s.id,name,description,category||"Other",price,stock,image).lastInsertRowid;
  res.json({id,message:"Product जोड़ा गया"});
});
app.delete("/api/seller/products/:id",auth,(req,res)=>{
  const s=sellerIdFor(req.user.id);if(!s)return res.status(403).json({error:"Seller profile नहीं मिला"});
  const result=db.prepare("DELETE FROM products WHERE id=? AND seller_id=?").run(Number(req.params.id),s.id);
  if(!result.changes)return res.status(404).json({error:"Product नहीं मिला"});
  res.json({ok:true});
});

function createOrder(req,res,method){
  const items=Array.isArray(req.body.items)?req.body.items:[],address=clean(req.body.address,600),phone=clean(req.body.phone,10);
  if(!items.length||items.length>30||!address||!validPhone(phone))return res.status(400).json({error:"Cart, पूरा पता और सही मोबाइल नंबर जरूरी है"});
  const normalized=[];
  let total=0;
  for(const item of items){
    const id=Number(item.productId),qty=Number(item.qty);
    if(!Number.isInteger(id)||!Number.isInteger(qty)||qty<1||qty>20)return res.status(400).json({error:"Cart item गलत है"});
    const p=db.prepare("SELECT * FROM products WHERE id=? AND active=1").get(id);
    if(!p||p.stock<qty)return res.status(400).json({error:`${p?.name||"Product"} का stock उपलब्ध नहीं`});
    normalized.push({...p,qty});total+=p.price*qty;
  }
  if(total>10000000)return res.status(400).json({error:"Order सीमा से अधिक है"});
  const tx=db.transaction(()=>{
    const oid=db.prepare("INSERT INTO orders(user_id,total,address,phone,payment_method,payment_status) VALUES(?,?,?,?,?,?)").run(req.user.id,total,address,phone,method,method==="COD"?"pending":"created").lastInsertRowid;
    for(const p of normalized){
      db.prepare("INSERT INTO order_items(order_id,product_id,seller_id,name,price,qty) VALUES(?,?,?,?,?,?)").run(oid,p.id,p.seller_id,p.name,p.price,p.qty);
      db.prepare("UPDATE products SET stock=stock-? WHERE id=?").run(p.qty,p.id);
    }
    return oid;
  });
  return {id:tx(),total};
}
app.post("/api/orders",auth,(req,res)=>{
  try{const o=createOrder(req,res,"COD");res.json({orderId:o.id,total:o.total,message:"आपका COD order दर्ज हो गया"});}
  catch(e){res.status(400).json({error:e.message||"Order नहीं बन पाया"});}
});
app.post("/api/payments/create-order",auth,async(req,res)=>{
  const rp=razorpay();if(!rp)return res.status(503).json({error:"Razorpay keys server .env में सेट नहीं हैं"});
  try{
    const o=createOrder(req,res,"ONLINE");
    const r=await rp.orders.create({amount:o.total*100,currency:"INR",receipt:`uzran_${o.id}`});
    db.prepare("UPDATE orders SET razorpay_order_id=? WHERE id=?").run(r.id,o.id);
    res.json({orderId:o.id,razorpayOrderId:r.id,amount:r.amount,currency:r.currency,keyId:process.env.RAZORPAY_KEY_ID});
  }catch(e){res.status(400).json({error:e.message||"Payment order नहीं बन पाया"});}
});
app.post("/api/payments/verify",auth,(req,res)=>{
  const {orderId,razorpay_order_id,razorpay_payment_id,razorpay_signature}=req.body;
  const order=db.prepare("SELECT * FROM orders WHERE id=? AND user_id=?").get(Number(orderId),req.user.id);
  if(!order||!order.razorpay_order_id||order.razorpay_order_id!==razorpay_order_id)return res.status(400).json({error:"Order mismatch"});
  const expected=crypto.createHmac("sha256",process.env.RAZORPAY_KEY_SECRET||"").update(`${razorpay_order_id}|${razorpay_payment_id}`).digest("hex");
  if(!process.env.RAZORPAY_KEY_SECRET||!crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(String(razorpay_signature||""))))return res.status(400).json({error:"Payment signature गलत है"});
  db.prepare("UPDATE orders SET payment_status='paid',status='confirmed' WHERE id=?").run(order.id);
  res.json({ok:true,message:"Payment verified"});
});
app.get("/api/orders",auth,(req,res)=>{
  const orders=db.prepare("SELECT * FROM orders WHERE user_id=? ORDER BY id DESC").all(req.user.id);
  res.json({orders:orders.map(o=>({...o,items:db.prepare("SELECT name,price,qty FROM order_items WHERE order_id=?").all(o.id)}))});
});
app.get("/api/seller/orders",auth,(req,res)=>{
  const s=sellerIdFor(req.user.id);if(!s)return res.status(404).json({error:"Seller profile नहीं मिला"});
  const orders=db.prepare(`SELECT DISTINCT o.id,o.total,o.status,o.payment_status,o.created_at,o.address,o.phone
    FROM orders o JOIN order_items i ON i.order_id=o.id WHERE i.seller_id=? ORDER BY o.id DESC`).all(s.id);
  res.json({orders});
});
app.get("/api/admin/summary",auth,role("admin"),(req,res)=>{
  res.json({products:db.prepare("SELECT COUNT(*) n FROM products").get().n,sellers:db.prepare("SELECT COUNT(*) n FROM sellers").get().n,pendingSellers:db.prepare("SELECT COUNT(*) n FROM sellers WHERE status='pending'").get().n,orders:db.prepare("SELECT COUNT(*) n FROM orders").get().n,sales:db.prepare("SELECT COALESCE(SUM(total),0) n FROM orders WHERE payment_status='paid' OR payment_method='COD'").get().n});
});
app.get("/api/admin/sellers",auth,role("admin"),(req,res)=>res.json({sellers:db.prepare("SELECT s.*,u.phone FROM sellers s JOIN users u ON u.id=s.user_id ORDER BY s.id DESC").all()}));
app.patch("/api/admin/sellers/:id",auth,role("admin"),(req,res)=>{
  const status=clean(req.body.status,20);if(!["approved","rejected","pending"].includes(status))return res.status(400).json({error:"Status गलत है"});
  const r=db.prepare("UPDATE sellers SET status=? WHERE id=?").run(status,Number(req.params.id));
  if(!r.changes)return res.status(404).json({error:"Seller नहीं मिला"});res.json({ok:true});
});
app.get("/api/admin/orders",auth,role("admin"),(req,res)=>res.json({orders:db.prepare("SELECT * FROM orders ORDER BY id DESC LIMIT 200").all()}));
app.patch("/api/admin/orders/:id",auth,role("admin"),(req,res)=>{
  const status=clean(req.body.status,30);if(!["confirmed","packed","shipped","delivered","cancelled"].includes(status))return res.status(400).json({error:"Status गलत है"});
  const r=db.prepare("UPDATE orders SET status=? WHERE id=?").run(status,Number(req.params.id));if(!r.changes)return res.status(404).json({error:"Order नहीं मिला"});res.json({ok:true});
});
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT,()=>console.log(`UZRAN running: http://localhost:${PORT}`));
