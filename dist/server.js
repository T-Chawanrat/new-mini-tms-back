import M from"fs";import qe from"https";import h from"express";import ke from"cors";import F from"path";import{fileURLToPath as $e}from"url";import Ne from"express";import we from"mysql2/promise";import Ce from"dotenv";Ce.config({silent:!0});var be=we.createPool({host:process.env.DB_HOST,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,port:process.env.DB_PORT||3306,connectionLimit:10,connectTimeout:6e4,acquireTimeout:6e4}),E=be;var x=async(a,t)=>{let e;try{let{username:s,password:r}=a.body;if(!s||!r)return t.status(400).json({message:"\u0E01\u0E23\u0E38\u0E13\u0E32\u0E01\u0E23\u0E2D\u0E01 username \u0E41\u0E25\u0E30 password"});e=await E.getConnection();let[n]=await e.query(`
      SELECT 
        u.user_id,
        u.username,
        u.password,
        u.first_name,
        u.last_name,
        u.license_plate,
        u.role_id,
        r.role_name, 
        u.dc_id,
        dc.dc_name
      FROM um_users u
      LEFT JOIN mm_user_dc dc ON u.dc_id = dc.id
      LEFT JOIN um_roles r ON u.role_id = r.id 
        WHERE u.username = ?
      LIMIT 1
      `,[s]);if(n.length===0)return t.status(404).json({message:"\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E1A\u0E31\u0E0D\u0E0A\u0E35\u0E1C\u0E39\u0E49\u0E43\u0E0A\u0E49\u0E19\u0E35\u0E49"});let l=n[0];return r!==l.password?t.status(401).json({message:"\u0E23\u0E2B\u0E31\u0E2A\u0E1C\u0E48\u0E32\u0E19\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07"}):t.status(200).json({message:"\u0E40\u0E02\u0E49\u0E32\u0E2A\u0E39\u0E48\u0E23\u0E30\u0E1A\u0E1A\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08",user:{user_id:l.user_id,username:l.username,first_name:l.first_name,last_name:l.last_name,license_plate:l.license_plate,role_id:l.role_id,role_name:l.role_name,dc_id:l.dc_id,dc_name:l.dc_name}})}catch(s){console.error("Login error:",s),t.status(500).json({message:"\u0E40\u0E01\u0E34\u0E14\u0E02\u0E49\u0E2D\u0E1C\u0E34\u0E14\u0E1E\u0E25\u0E32\u0E14",error:s.message})}finally{e&&e.release()}};var q=Ne.Router();q.post("/login",x);var k=q;import ye from"express";import Se from"fs";import he from"path";var $=async(a,t)=>{let e;try{e=await E.getConnection(),await e.beginTransaction();let{user_id:s,REFERENCE:r,name:n,surname:l,license_plate:c,remark:u}=a.body,o=a.files?.signature?a.files.signature[0]:null,i=a.files?.images||[],[[d]]=await e.query("SELECT dc_id FROM um_users WHERE user_id = ?",[s]),g=d?.dc_id||null,[[m]]=await e.query(`
  SELECT COUNT(*) AS cnt
  FROM bills_data
  WHERE REFERENCE = ?
    AND image = 'Y'
    AND sign = 'Y'
  `,[r]);if(m.cnt>0)return await e.rollback(),t.status(409).json({message:"REFERENCE \u0E19\u0E35\u0E49\u0E21\u0E35\u0E01\u0E32\u0E23\u0E2D\u0E31\u0E1B\u0E42\u0E2B\u0E25\u0E14\u0E23\u0E39\u0E1B\u0E41\u0E25\u0E30\u0E40\u0E0B\u0E47\u0E19\u0E41\u0E25\u0E49\u0E27 \u0E44\u0E21\u0E48\u0E2A\u0E32\u0E21\u0E32\u0E23\u0E16\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01\u0E0B\u0E49\u0E33\u0E44\u0E14\u0E49"});let[_]=await e.query(`INSERT INTO bills (user_id, REFERENCE, name, surname, license_plate, dc_id, sign, remark)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,[s,r,n,l,c,g,o?o.path:null,u]),f=_.insertId,[[w]]=await e.query(`
      SELECT COUNT(*) AS cnt
      FROM bills_data
      WHERE REFERENCE = ?
      AND warehouse_accept = 'N'
      AND dc_accept = 'N'
      `,[r]);if(i.length>0){let C=i.map(p=>[f,p.path]);C.length>0&&await e.query("INSERT INTO bill_images (bill_id, image_url) VALUES ?",[C])}return await e.query(`
      UPDATE bills_data
      SET image = 'Y',
          sign = 'Y'
      WHERE REFERENCE = ?
      `,[r]),await e.commit(),t.status(201).json({message:"\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08",id:f,imageCount:i.length,hasSignature:!!o,pendingAcceptCount:w.cnt})}catch(s){return e&&await e.rollback(),console.error("BACKEND ERROR:",s),t.status(500).json({message:"\u0E40\u0E01\u0E34\u0E14\u0E02\u0E49\u0E2D\u0E1C\u0E34\u0E14\u0E1E\u0E25\u0E32\u0E14\u0E43\u0E19\u0E01\u0E32\u0E23\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01 (backend error)",error:s.message})}finally{e&&e.release()}},U=async(a,t)=>{let e;try{let s=Number(a.params.id);if(!s)return t.status(400).json({message:"billId \u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07"});let r=[];if(a.body.deleteImageUrls)try{r=JSON.parse(a.body.deleteImageUrls)}catch{r=String(a.body.deleteImageUrls).split(",").map(o=>o.trim()).filter(Boolean)}let n=a.files?.images||[];e=await E.getConnection(),await e.beginTransaction();let[l]=await e.query("SELECT id, image_url FROM bill_images WHERE bill_id = ?",[s]);if(r.length>0){await e.query("DELETE FROM bill_images WHERE bill_id = ? AND image_url IN (?)",[s,r]);let u=l.filter(o=>r.includes(o.image_url));for(let o of u){let i=he.resolve(o.image_url);try{await Se.promises.unlink(i)}catch{console.warn("\u26A0 \u0E25\u0E1A\u0E44\u0E1F\u0E25\u0E4C\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49 \u0E2B\u0E23\u0E37\u0E2D\u0E44\u0E21\u0E48\u0E21\u0E35\u0E44\u0E1F\u0E25\u0E4C:",i)}}}if(n.length>0){let u=n.map(o=>[s,o.path]);await e.query("INSERT INTO bill_images (bill_id, image_url) VALUES ?",[u])}await e.commit();let[c]=await e.query("SELECT id, image_url FROM bill_images WHERE bill_id = ?",[s]);return t.status(200).json({message:"\u0E2D\u0E31\u0E1B\u0E40\u0E14\u0E15\u0E23\u0E39\u0E1B\u0E02\u0E2D\u0E07\u0E1A\u0E34\u0E25\u0E40\u0E23\u0E35\u0E22\u0E1A\u0E23\u0E49\u0E2D\u0E22",billId:s,deleted:r,addedCount:n.length,images:c})}catch(s){return e&&await e.rollback(),console.error("UPDATE BILL IMAGES ERROR:",s),t.status(500).json({message:"\u0E40\u0E01\u0E34\u0E14\u0E02\u0E49\u0E2D\u0E1C\u0E34\u0E14\u0E1E\u0E25\u0E32\u0E14\u0E43\u0E19\u0E01\u0E32\u0E23\u0E2D\u0E31\u0E1B\u0E40\u0E14\u0E15\u0E23\u0E39\u0E1B\u0E02\u0E2D\u0E07\u0E1A\u0E34\u0E25",error:s.message})}finally{e&&e.release()}},T="https://xsendwork.com",W=async(a,t)=>{let e;try{e=await E.getConnection();let s=a.params.id,[r]=await e.query("SELECT * FROM bills WHERE id = ?",[s]);if(r.length===0)return t.status(404).json({message:"\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E1A\u0E34\u0E25\u0E19\u0E35\u0E49"});let n=r[0],[l]=await e.query("SELECT image_url FROM bill_images WHERE bill_id = ?",[s]);n.images=l.map(c=>c.image_url?`${T}/${c.image_url}`:null),n.sign&&(n.sign=`${T}/${n.sign}`),t.status(200).json({bill:n})}catch(s){console.error("Error getting bill:",s),t.status(500).json({message:"\u0E40\u0E01\u0E34\u0E14\u0E02\u0E49\u0E2D\u0E1C\u0E34\u0E14\u0E1E\u0E25\u0E32\u0E14\u0E43\u0E19\u0E01\u0E32\u0E23\u0E14\u0E36\u0E07\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25",error:s.message})}finally{e&&e.release()}},H=async(a,t)=>{let e;try{e=await E.getConnection();let[s]=await e.query("SELECT * FROM bills ORDER BY id DESC");for(let r of s){let[n]=await e.query("SELECT image_url FROM bill_images WHERE bill_id = ?",[r.id]);r.images=n.map(l=>l.image_url?`${T}/${l.image_url}`:null),r.sign&&(r.sign=`${T}/${r.sign}`)}t.status(200).json({bills:s})}catch(s){console.error("Error getting bills:",s),t.status(500).json({message:"\u0E40\u0E01\u0E34\u0E14\u0E02\u0E49\u0E2D\u0E1C\u0E34\u0E14\u0E1E\u0E25\u0E32\u0E14\u0E43\u0E19\u0E01\u0E32\u0E23\u0E14\u0E36\u0E07\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25",error:s.message})}finally{e&&e.release()}},V=async(a,t)=>{let e;try{e=await E.getConnection();let s=a.params.id,[r]=await e.query("SELECT sign FROM bills WHERE id = ?",[s]);if(r.length===0)return t.status(404).json({message:"\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E1A\u0E34\u0E25\u0E19\u0E35\u0E49"});let n=r[0],[l]=await e.query("SELECT image_url FROM bill_images WHERE bill_id = ?",[s]),c="https://xsendwork.com",u=[];n.sign&&u.push(`${c}/${n.sign}`);for(let o of l)o.image_url&&u.push(`${c}/${o.image_url}`);t.status(200).json({files:u})}catch(s){console.error("Error in downloadImage:",s),t.status(500).json({message:"\u0E40\u0E01\u0E34\u0E14\u0E02\u0E49\u0E2D\u0E1C\u0E34\u0E14\u0E1E\u0E25\u0E32\u0E14\u0E43\u0E19\u0E01\u0E32\u0E23\u0E14\u0E36\u0E07\u0E44\u0E1F\u0E25\u0E4C",error:s.message})}finally{e&&e.release()}},Y=async(a,t)=>{let e;try{e=await E.getConnection();let{SERIAL_NO:s}=a.query;if(!s||!s.trim())return t.status(400).json({success:!1,message:"\u0E01\u0E23\u0E38\u0E13\u0E32\u0E23\u0E30\u0E1A\u0E38 SERIAL_NO"});if(s=s.trim(),s.length<6)return t.status(400).json({success:!1,message:"SERIAL_NO \u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07"});let[r]=await e.query("SELECT * FROM bills_data WHERE SERIAL_NO = ?",[s]);if(r.length===0)return t.status(404).json({success:!1,message:"\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A SERIAL_NO \u0E19\u0E35\u0E49"});if(r.length>1)return t.status(409).json({success:!1,message:"\u0E1E\u0E1A SERIAL_NO \u0E19\u0E35\u0E49\u0E0B\u0E49\u0E33\u0E43\u0E19\u0E23\u0E30\u0E1A\u0E1A"});let n=r[0].REFERENCE,[l]=await e.query(`
      SELECT SERIAL_NO
      FROM bills_data
      WHERE REFERENCE = ?
      ORDER BY SERIAL_NO ASC
      `,[n]),c=l.map(o=>o.SERIAL_NO),u=Array.from(new Set(c));t.status(200).json({success:!0,data:{bill:r[0],REFERENCE:n,SERIALS:u,serialCount:u.length}})}catch(s){console.error("Error getBillsBySerial:",s),t.status(500).json({success:!1,message:"\u0E40\u0E01\u0E34\u0E14\u0E02\u0E49\u0E2D\u0E1C\u0E34\u0E14\u0E1E\u0E25\u0E32\u0E14\u0E20\u0E32\u0E22\u0E43\u0E19\u0E23\u0E30\u0E1A\u0E1A"})}finally{e&&e.release()}};import Z from"multer";import v from"path";import z from"fs";var y={},Te=Z.diskStorage({destination:(a,t,e)=>{let s="uploads";z.existsSync(s)||z.mkdirSync(s),e(null,s)},filename:(a,t,e)=>{let r=(a.body.REFERENCE||"unknown").replace(/[^a-zA-Z0-9_-]/g,"");y[r]||(y[r]=1);let n=String(y[r]).padStart(2,"0");if(y[r]++,t.fieldname==="signature"){e(null,`signature_${r}${v.extname(t.originalname)}`);return}e(null,`image_${r}_${n}${v.extname(t.originalname)}`)}}),D=Z({storage:Te,limits:{files:9}});var b=ye.Router();b.post("/bills",D.fields([{name:"images",maxCount:8},{name:"signature",maxCount:1}]),$);b.put("/bills/:id/images",D.fields([{name:"images",maxCount:9}]),U);b.get("/bills/:id",W);b.get("/bills",H);b.get("/bills/:id/downloadImage",V);b.get("/serial",Y);var G=b;import Oe from"express";var K=(a,t=100,e=200)=>{let s=Math.max(parseInt(a.query.page,10)||1,1),r=parseInt(a.query.pageSize,10),n=Math.min(Math.max(r||t,1),e),l=(s-1)*n;return{page:s,pageSize:n,skip:l}};var P=a=>{if(a==null||a==="")return null;if(typeof a=="string"&&a.includes("-"))return a;let t=typeof a=="number"?a:parseFloat(String(a).trim());return!t||isNaN(t)?null:new Date((t-25569)*86400*1e3).toISOString().split("T")[0]},J=async(a,t)=>{let e;try{e=await E.getConnection();let{SERIAL_NO:s,REFERENCE:r,warehouse_id:n}=a.query,{page:l,pageSize:c,skip:u}=K(a,100),o=`
      FROM bills_data bd
      LEFT JOIN bills b 
        ON b.REFERENCE = bd.REFERENCE
      LEFT JOIN bill_images bi 
        ON bi.bill_id = b.id
      WHERE 1=1
    `,i=[];s?.trim()&&(o+=" AND bd.SERIAL_NO LIKE ?",i.push(`%${s.trim()}%`)),r?.trim()&&(o+=" AND bd.REFERENCE LIKE ?",i.push(`%${r.trim()}%`)),n&&(o+=" AND bd.warehouse_id = ?",i.push(Number(n)));let d=`
  SELECT COUNT(*) AS total
  FROM (
    SELECT bd.id AS bd_id, b.id AS bill_id
    ${o}
    GROUP BY bd.id, b.id
  ) x
`,[[g]]=await e.query(d,i),m=g?.total||0,_=`
      SELECT
        bd.*,
        b.id AS bill_id,
        b.user_id AS bill_user_id,
        b.name AS bill_name,
        b.surname AS bill_surname,
        b.license_plate AS bill_license_plate,
        b.dc_id AS bill_dc_id,
        b.sign AS bill_sign,
        b.remark AS bill_remark,
        b.created_at AS bill_created_at,
        GROUP_CONCAT(bi.image_url ORDER BY bi.id) AS bill_image_urls
      ${o}
      GROUP BY bd.id, b.id
      ORDER BY bd.id DESC
      LIMIT ? OFFSET ?
    `,f=[...i,c,u],[w]=await e.query(_,f),C=w.map(p=>({...p,bill_image_urls:p.bill_image_urls?p.bill_image_urls.split(","):[]}));t.status(200).json({success:!0,data:C,pagination:{page:l,pageSize:c,total:m,totalPages:Math.ceil(m/c)}})}catch(s){console.error("Error getBillsReport:",s),t.status(500).json({success:!1,message:"\u0E44\u0E21\u0E48\u0E2A\u0E32\u0E21\u0E32\u0E23\u0E16\u0E14\u0E36\u0E07\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25 report bills \u0E44\u0E14\u0E49",error:s.message})}finally{e&&e.release()}},Q=async(a,t)=>{let e;try{let s=(a.query.serial||"").toString().trim();if(!s)return t.status(400).json({success:!1,message:"\u0E01\u0E23\u0E38\u0E13\u0E32\u0E23\u0E30\u0E1A\u0E38 SERIAL_NO"});e=await E.getConnection();let[[r]]=await e.query(`
      SELECT REFERENCE
      FROM bills_data
      WHERE SERIAL_NO = ?
      LIMIT 1
      `,[s]);if(!r)return t.status(404).json({success:!1,message:"\u0E44\u0E21\u0E48\u0E1E\u0E1A SERIAL_NO \u0E19\u0E35\u0E49"});let n=r.REFERENCE,[l]=await e.query(`
      SELECT id, SERIAL_NO, REFERENCE, warehouse_accept, dc_accept
      FROM bills_data
      WHERE REFERENCE = ?
      ORDER BY id ASC
      `,[n]);return t.json({success:!0,reference:n,rows:l,count:l.length})}catch(s){return console.error("getBillsDataBySerial ERROR:",s),t.status(500).json({success:!1,message:"backend error",error:s.message})}finally{e&&e.release()}},X=async(a,t)=>{let e;try{let{rows:s,user_id:r,type:n}=a.body;if(!s||!Array.isArray(s)||s.length===0)return t.status(400).json({message:"\u0E44\u0E21\u0E48\u0E21\u0E35\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E19\u0E33\u0E40\u0E02\u0E49\u0E32"});e=await E.getConnection(),await e.beginTransaction();let[l]=await e.query("SELECT warehouse_id, warehouse_name, zip_code FROM master_warehouses"),c={};l.forEach(o=>{c[o.zip_code]={warehouse_id:o.warehouse_id,warehouse_name:o.warehouse_name}});let u=s.map(o=>{let i=c[o.RECIPIENT_ZIPCODE]||{};return[o.NO_BILL||null,o.REFERENCE||null,P(o.SEND_DATE)||null,o.CUSTOMER_NAME||null,o.RECIPIENT_CODE||null,o.RECIPIENT_NAME||null,o.RECIPIENT_TEL||null,o.RECIPIENT_ADDRESS||null,o.RECIPIENT_SUBDISTRICT||null,o.RECIPIENT_DISTRICT||null,o.RECIPIENT_PROVINCE||null,o.RECIPIENT_ZIPCODE||null,o.SERIAL_NO||null,o.PRICE||null,r||null,i.warehouse_name||null,i.warehouse_id||null,n||"IMPORT"]});await e.query(`
      INSERT INTO bills_data 
      (
        NO_BILL, REFERENCE, SEND_DATE, CUSTOMER_NAME, RECIPIENT_CODE,
        RECIPIENT_NAME, RECIPIENT_TEL, RECIPIENT_ADDRESS,
        RECIPIENT_SUBDISTRICT, RECIPIENT_DISTRICT, RECIPIENT_PROVINCE,
        RECIPIENT_ZIPCODE, SERIAL_NO, PRICE, user_id,
        warehouse_name, warehouse_id,
        type
      )
      VALUES ?
      `,[u]),await e.commit(),t.status(200).json({success:!0,message:`\u0E19\u0E33\u0E40\u0E02\u0E49\u0E32\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08 \u0E08\u0E33\u0E19\u0E27\u0E19 ${s.length} \u0E41\u0E16\u0E27`})}catch(s){e&&await e.rollback(),console.error("Error while importing bills_data:",s),t.status(500).json({success:!1,message:"\u0E40\u0E01\u0E34\u0E14\u0E02\u0E49\u0E2D\u0E1C\u0E34\u0E14\u0E1E\u0E25\u0E32\u0E14\u0E23\u0E30\u0E2B\u0E27\u0E48\u0E32\u0E07\u0E19\u0E33\u0E40\u0E02\u0E49\u0E32\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25",error:s.message})}finally{e&&e.release()}},ee=async(a,t)=>{let e;try{let{rows:s,user_id:r,type:n}=a.body;if(!s||!Array.isArray(s)||s.length===0)return t.status(400).json({message:"\u0E44\u0E21\u0E48\u0E21\u0E35\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E19\u0E33\u0E40\u0E02\u0E49\u0E32"});e=await E.getConnection(),await e.beginTransaction();let[l]=await e.query("SELECT warehouse_id, warehouse_name, zip_code FROM master_warehouses"),c={};l.forEach(o=>{c[o.zip_code]={warehouse_id:o.warehouse_id,warehouse_name:o.warehouse_name}});let u=s.map(o=>{let i=c[o.RECIPIENT_ZIPCODE]||{};return[o.NO_BILL||null,o.REFERENCE||null,P(o.SEND_DATE)||null,o.CUSTOMER_NAME||null,o.RECIPIENT_CODE||null,o.RECIPIENT_NAME||null,o.RECIPIENT_TEL||null,o.RECIPIENT_ADDRESS||null,o.RECIPIENT_SUBDISTRICT||null,o.RECIPIENT_DISTRICT||null,o.RECIPIENT_PROVINCE||null,o.RECIPIENT_ZIPCODE||null,o.SERIAL_NO||null,o.PRICE||null,r||null,i.warehouse_name||null,i.warehouse_id||null,n||"IMPORT"]});await e.query(`
      INSERT INTO bills_data 
      (
        NO_BILL, REFERENCE, SEND_DATE, CUSTOMER_NAME, RECIPIENT_CODE,
        RECIPIENT_NAME, RECIPIENT_TEL, RECIPIENT_ADDRESS,
        RECIPIENT_SUBDISTRICT, RECIPIENT_DISTRICT, RECIPIENT_PROVINCE,
        RECIPIENT_ZIPCODE, SERIAL_NO, PRICE, user_id,
        warehouse_name, warehouse_id,
        type
      )
      VALUES ?
      `,[u]),await e.commit(),t.status(200).json({success:!0,message:`\u0E19\u0E33\u0E40\u0E02\u0E49\u0E32\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08 \u0E08\u0E33\u0E19\u0E27\u0E19 ${s.length} \u0E41\u0E16\u0E27`})}catch(s){e&&await e.rollback(),console.error("Error while importing bills_data:",s),t.status(500).json({success:!1,message:"\u0E40\u0E01\u0E34\u0E14\u0E02\u0E49\u0E2D\u0E1C\u0E34\u0E14\u0E1E\u0E25\u0E32\u0E14\u0E23\u0E30\u0E2B\u0E27\u0E48\u0E32\u0E07\u0E19\u0E33\u0E40\u0E02\u0E49\u0E32\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25",error:s.message})}finally{e&&e.release()}},se=async(a,t)=>{let e;try{let{rows:s,user_id:r,type:n}=a.body;if(!s||!Array.isArray(s)||s.length===0)return t.status(400).json({success:!1,message:"\u0E44\u0E21\u0E48\u0E21\u0E35\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E19\u0E33\u0E40\u0E02\u0E49\u0E32"});e=await E.getConnection(),await e.beginTransaction();let[l]=await e.query("SELECT warehouse_id, warehouse_name, dc_code FROM mm_warehouses"),c={};l.forEach(i=>{i.dc_code&&(c[String(i.dc_code).trim()]={warehouse_id:i.warehouse_id,warehouse_name:i.warehouse_name})});let u=i=>i?String(i).trim().split(/\s+/)[0]:"",o=s.map(i=>{let d=u(i.TO_DC),g=c[d]||{};return[i.NO_BILL||null,i.REFERENCE||null,P(i.SEND_DATE)||null,i.CUSTOMER_NAME||null,i.RECIPIENT_CODE||null,i.RECIPIENT_NAME||null,i.RECIPIENT_TEL||null,i.RECIPIENT_ADDRESS||null,i.RECIPIENT_SUBDISTRICT||null,i.RECIPIENT_DISTRICT||null,i.RECIPIENT_PROVINCE||null,i.RECIPIENT_ZIPCODE||null,i.SERIAL_NO||null,i.PRICE||null,r||null,g.warehouse_name||null,g.warehouse_id||null,n||"IMPORT"]});await e.query(`
      INSERT INTO bills_data 
      (
        NO_BILL, REFERENCE, SEND_DATE, CUSTOMER_NAME, RECIPIENT_CODE,
        RECIPIENT_NAME, RECIPIENT_TEL, RECIPIENT_ADDRESS,
        RECIPIENT_SUBDISTRICT, RECIPIENT_DISTRICT, RECIPIENT_PROVINCE,
        RECIPIENT_ZIPCODE, SERIAL_NO, PRICE, user_id,
        warehouse_name, warehouse_id,
        type
      )
      VALUES ?
      `,[o]),await e.commit(),t.status(200).json({success:!0,message:`\u0E19\u0E33\u0E40\u0E02\u0E49\u0E32\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25 VGT \u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08 \u0E08\u0E33\u0E19\u0E27\u0E19 ${s.length} \u0E41\u0E16\u0E27`})}catch(s){e&&await e.rollback(),console.error("Error while importing bills_data VGT:",s),t.status(500).json({success:!1,message:"\u0E40\u0E01\u0E34\u0E14\u0E02\u0E49\u0E2D\u0E1C\u0E34\u0E14\u0E1E\u0E25\u0E32\u0E14\u0E23\u0E30\u0E2B\u0E27\u0E48\u0E32\u0E07\u0E19\u0E33\u0E40\u0E02\u0E49\u0E32\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25 VGT",error:s.message})}finally{e&&e.release()}},te=async(a,t)=>{let e;try{let{warehouse_accept:s="N"}=a.query;e=await E.getConnection();let[r]=await e.query(`
      SELECT
        id,
        NO_BILL,
        SERIAL_NO,
        CUSTOMER_NAME,
        warehouse_name
      FROM bills_data
      WHERE warehouse_accept = ?
      ORDER BY id ASC
      `,[s]);t.status(200).json({success:!0,data:r})}catch(s){console.error("Error getBillsWarehouse:",s),t.status(500).json({success:!1,message:"\u0E44\u0E21\u0E48\u0E2A\u0E32\u0E21\u0E32\u0E23\u0E16\u0E14\u0E36\u0E07\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25 bills_data \u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A Warehouse \u0E44\u0E14\u0E49",error:s.message})}finally{e&&e.release()}},ae=async(a,t)=>{let e;try{let{serials:s,accept_flag:r="Y"}=a.body;if(!s||!Array.isArray(s)||s.length===0)return t.status(400).json({success:!1,message:"\u0E01\u0E23\u0E38\u0E13\u0E32\u0E23\u0E30\u0E1A\u0E38 serials \u0E40\u0E1B\u0E47\u0E19 array"});e=await E.getConnection(),await e.beginTransaction(),await e.query(`
      UPDATE bills_data
      SET warehouse_accept = ?
      WHERE SERIAL_NO IN (?)
      `,[r,s]),await e.commit(),t.status(200).json({success:!0,message:`\u0E2D\u0E31\u0E1B\u0E40\u0E14\u0E15\u0E2A\u0E16\u0E32\u0E19\u0E30 warehouse_accept = '${r}' \u0E43\u0E2B\u0E49 ${s.length} \u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E40\u0E23\u0E35\u0E22\u0E1A\u0E23\u0E49\u0E2D\u0E22`})}catch(s){e&&await e.rollback(),console.error("Error updateBillsWarehouseAccept:",s),t.status(500).json({success:!1,message:"\u0E40\u0E01\u0E34\u0E14\u0E02\u0E49\u0E2D\u0E1C\u0E34\u0E14\u0E1E\u0E25\u0E32\u0E14\u0E43\u0E19\u0E01\u0E32\u0E23\u0E2D\u0E31\u0E1B\u0E40\u0E14\u0E15 warehouse_accept",error:s.message})}finally{e&&e.release()}},re=async(a,t)=>{let e;try{let{warehouse_accept:s="Y",dc_accept:r="N"}=a.query,n=a.user?.user_id||a.query.user_id;if(!n)return t.status(400).json({success:!1,message:"\u0E15\u0E49\u0E2D\u0E07\u0E23\u0E30\u0E1A\u0E38 user_id \u0E2B\u0E23\u0E37\u0E2D login \u0E01\u0E48\u0E2D\u0E19"});e=await E.getConnection();let[l]=await e.query(`
      SELECT 
        b.id,
        b.NO_BILL,
        b.SERIAL_NO,
        b.CUSTOMER_NAME,
        b.warehouse_name
      FROM bills_data b
      JOIN mm_user_dc d
        ON d.warehouse_id = b.warehouse_id   
      JOIN um_users u
        ON u.dc_id = d.id                    
      WHERE u.user_id = ?   
        AND u.role_id = 4
        AND b.dc_accept = ?
        AND b.warehouse_accept = ?
      ORDER BY b.id ASC
      `,[n,r,s]);t.status(200).json({success:!0,data:l})}catch(s){console.error("Error getBillsDC:",s),t.status(500).json({success:!1,message:"\u0E44\u0E21\u0E48\u0E2A\u0E32\u0E21\u0E32\u0E23\u0E16\u0E14\u0E36\u0E07\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25 bills_data \u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A DC \u0E44\u0E14\u0E49",error:s.message})}finally{e&&e.release()}},oe=async(a,t)=>{let e;try{let{serials:s,accept_flag:r="Y"}=a.body;if(!s||!Array.isArray(s)||s.length===0)return t.status(400).json({success:!1,message:"\u0E01\u0E23\u0E38\u0E13\u0E32\u0E23\u0E30\u0E1A\u0E38 serials \u0E40\u0E1B\u0E47\u0E19 array"});e=await E.getConnection(),await e.beginTransaction(),await e.query(`
      UPDATE bills_data
      SET dc_accept = ?
      WHERE SERIAL_NO IN (?)
      `,[r,s]),await e.commit(),t.status(200).json({success:!0,message:`\u0E2D\u0E31\u0E1B\u0E40\u0E14\u0E15\u0E2A\u0E16\u0E32\u0E19\u0E30 dc_accept = '${r}' \u0E43\u0E2B\u0E49 ${s.length} \u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E40\u0E23\u0E35\u0E22\u0E1A\u0E23\u0E49\u0E2D\u0E22`})}catch(s){e&&await e.rollback(),console.error("Error updateBillsDCAccept:",s),t.status(500).json({success:!1,message:"\u0E40\u0E01\u0E34\u0E14\u0E02\u0E49\u0E2D\u0E1C\u0E34\u0E14\u0E1E\u0E25\u0E32\u0E14\u0E43\u0E19\u0E01\u0E32\u0E23\u0E2D\u0E31\u0E1B\u0E40\u0E14\u0E15 dc_accept",error:s.message})}finally{e&&e.release()}};var I=Oe.Router();I.get("/bills-data",J);I.get("/bills-data/by-serial",Q);I.post("/import-bills",X);I.post("/import-adv",ee);I.post("/import-vgt",se);I.get("/bills-warehouse",te);I.post("/bills-warehouse/accept",ae);I.get("/bills-dc",re);I.post("/bills-dc/accept",oe);var ne=I;import Ae from"express";var ie=async(a,t)=>{try{let e=`
      SELECT *
      FROM xsendwork_mini_tms.um_customers 
      ORDER BY customer_name ASC
    `,[s]=await E.query(e);t.json({data:s,count:s.length})}catch(e){console.error("getCustomers error:",e),t.status(500).json({message:"An error occurred"})}},le=async(a,t)=>{try{let e=`
      SELECT *
      FROM xsendwork_mini_tms.mm_warehouses
      `,[s]=await E.query(e);t.json({data:s,count:s.length})}catch(e){console.error("getDropdownWarehouse error:",e),t.status(500).json({message:"An error occurred"})}},ce=async(a,t)=>{try{let{zip_code:e}=a.query,s=`
      SELECT *
      FROM xsendwork_mini_tms.master_warehouses
    `,r=[];e&&(s+=" WHERE zip_code = ?",r.push(e));let[n]=await E.query(s,r);t.json({data:n,count:n.length})}catch(e){console.error("getWarehouses error:",e),t.status(500).json({message:"An error occurred"})}},ue=async(a,t)=>{try{let{keyword:e}=a.query;if(!e||String(e).trim().length<2)return t.json({data:[],count:0});let s=`%${e.trim()}%`,r=`
      SELECT
        id,
        tambon_id,
        tambon_name_th,
        ampur_id,
        ampur_name_th,
        province_id,
        province_name_th,
        zip_code,
        warehouse_id,
        warehouse_code,
        warehouse_name
      FROM xsendwork_mini_tms.master_warehouses
      WHERE
        tambon_name_th LIKE ?
        OR ampur_name_th LIKE ?
        OR province_name_th LIKE ?
        OR zip_code LIKE ?
      LIMIT 50
    `,n=[s,s,s,s],[l]=await E.query(r,n);t.json({data:l,count:l.length})}catch(e){console.error("searchAddress error:",e),t.status(500).json({message:"An error occurred"})}};var N=Ae.Router();N.get("/customers",ie);N.get("/select-warehouse",le);N.get("/warehouses",ce);N.get("/address-search",ue);var Ee=N;import xe from"express";import S from"fs";import O from"path";import Le from"bwip-js";import De from"qrcode";import{fileURLToPath as Pe}from"url";var Be=Pe(import.meta.url),je=O.dirname(Be),A=O.join(je,"..","labels"),me=a=>String(a||"").replace(/[^a-zA-Z0-9_-]/g,"_"),_e=async a=>{let e=`barcode_${me(a)}.png`,s=O.join(A,e);if(!S.existsSync(s)){let r=await Le.toBuffer({bcid:"code128",text:String(a),scale:3,height:10,includetext:!1});await S.promises.writeFile(s,r)}return e},de=async a=>{let e=`qr_${me(a)}.png`,s=O.join(A,e);return S.existsSync(s)||await De.toFile(s,String(a),{width:200,margin:1}),e},Me=async(a,t)=>{let e;try{let s=a.user?.user_id||a.query.user_id;if(!s)return t.status(400).json({success:!1,message:"\u0E01\u0E23\u0E38\u0E13\u0E32\u0E23\u0E30\u0E1A\u0E38 user_id \u0E2B\u0E23\u0E37\u0E2D login \u0E43\u0E2B\u0E49\u0E40\u0E23\u0E35\u0E22\u0E1A\u0E23\u0E49\u0E2D\u0E22"});await S.promises.mkdir(A,{recursive:!0}),e=await E.getConnection();let[[r]]=await e.query("SELECT role_id FROM um_users WHERE user_id = ? LIMIT 1",[s]);if(!r)return t.status(404).json({success:!1,message:"\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E1C\u0E39\u0E49\u0E43\u0E0A\u0E49\u0E07\u0E32\u0E19 (user_id) \u0E43\u0E19\u0E23\u0E30\u0E1A\u0E1A"});let n=Number(r.role_id),l=[1,5,7].includes(n),c=n===2;if(!l&&!c)return t.status(403).json({success:!1,message:"\u0E04\u0E38\u0E13\u0E44\u0E21\u0E48\u0E21\u0E35\u0E2A\u0E34\u0E17\u0E18\u0E34\u0E4C\u0E40\u0E02\u0E49\u0E32\u0E16\u0E36\u0E07\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E2A\u0E48\u0E27\u0E19\u0E19\u0E35\u0E49"});let u=`
      SELECT *
      FROM bills_data
      WHERE customer_input = 'Y'
      AND created_at >= (NOW() - INTERVAL 1 DAY)
    `,o=[];c&&(u+=" AND user_id = ? ",o.push(s)),u+=" ORDER BY id DESC ";let[i]=await e.query(u,o),d=`${a.protocol}://${a.get("host")}`,g=await Promise.all(i.map(async m=>{let _=m.SERIAL_NO;if(!_)return{...m,barcode_url:null,qr_url:null};let f=await _e(_),w=await de(_);return{...m,barcode_url:`${d}/labels/${f}`,qr_url:`${d}/labels/${w}`}}));return t.status(200).json({success:!0,count:g.length,data:g})}catch(s){return console.error("Error getPrintLabels:",s),t.status(500).json({success:!1,message:"\u0E40\u0E01\u0E34\u0E14\u0E02\u0E49\u0E2D\u0E1C\u0E34\u0E14\u0E1E\u0E25\u0E32\u0E14\u0E43\u0E19\u0E01\u0E32\u0E23\u0E14\u0E36\u0E07\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25/\u0E2A\u0E23\u0E49\u0E32\u0E07 Label",error:s.message})}finally{e&&e.release()}},Fe=async(a,t)=>{let e;try{let s=a.user?.user_id||a.query.user_id;if(!s)return t.status(400).json({success:!1,message:"\u0E01\u0E23\u0E38\u0E13\u0E32\u0E23\u0E30\u0E1A\u0E38 user_id \u0E2B\u0E23\u0E37\u0E2D login \u0E43\u0E2B\u0E49\u0E40\u0E23\u0E35\u0E22\u0E1A\u0E23\u0E49\u0E2D\u0E22"});await S.promises.mkdir(A,{recursive:!0}),e=await E.getConnection();let[[r]]=await e.query("SELECT role_id FROM um_users WHERE user_id = ? LIMIT 1",[s]);if(!r)return t.status(404).json({success:!1,message:"\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E1C\u0E39\u0E49\u0E43\u0E0A\u0E49\u0E07\u0E32\u0E19 (user_id) \u0E43\u0E19\u0E23\u0E30\u0E1A\u0E1A"});let n=Number(r.role_id),l=[1,5,7].includes(n),c=n===2;if(!l&&!c)return t.status(403).json({success:!1,message:"\u0E04\u0E38\u0E13\u0E44\u0E21\u0E48\u0E21\u0E35\u0E2A\u0E34\u0E17\u0E18\u0E34\u0E4C\u0E40\u0E02\u0E49\u0E32\u0E16\u0E36\u0E07\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E2A\u0E48\u0E27\u0E19\u0E19\u0E35\u0E49"});let u=(a.query.serial||"").toString().trim(),o=(a.query.reference||"").toString().trim(),i=(a.query.date||"").toString().trim(),d=(a.query.customer_name||"").toString().trim(),g=(a.query.warehouse_name||"").toString().trim(),m=`
      SELECT *
      FROM bills_data
      WHERE customer_input = 'Y'
    `,_=[];c&&(m+=" AND user_id = ? ",_.push(s)),u&&(m+=" AND SERIAL_NO LIKE ? ",_.push(`%${u}%`)),o&&(m+=" AND REFERENCE LIKE ? ",_.push(`%${o}%`)),i||(i=new Date(new Date().toLocaleString("en-US",{timeZone:"Asia/Bangkok"})).toISOString().slice(0,10)),d&&(m+=" AND CUSTOMER_NAME = ? ",_.push(d)),g&&(m+=" AND warehouse_name = ? ",_.push(g)),m+=" ORDER BY id DESC ";let[f]=await e.query(m,_),w=`${a.protocol}://${a.get("host")}`,C=await Promise.all(f.map(async p=>{let L=p.SERIAL_NO;if(!L)return{...p,barcode_url:null,qr_url:null};let Ie=await _e(L),fe=await de(L);return{...p,barcode_url:`${w}/labels/${Ie}`,qr_url:`${w}/labels/${fe}`}}));return t.status(200).json({success:!0,count:C.length,data:C})}catch(s){return console.error("Error getPrintLabels:",s),t.status(500).json({success:!1,message:"\u0E40\u0E01\u0E34\u0E14\u0E02\u0E49\u0E2D\u0E1C\u0E34\u0E14\u0E1E\u0E25\u0E32\u0E14\u0E43\u0E19\u0E01\u0E32\u0E23\u0E14\u0E36\u0E07\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25/\u0E2A\u0E23\u0E49\u0E32\u0E07 Label",error:s.message})}finally{e&&e.release()}},B={getPrintLabels:Me,getReprintLabels:Fe};var j=xe.Router();j.get("/print-labels",B.getPrintLabels);j.get("/reprint-labels",B.getReprintLabels);var ge=j;var Ue=$e(import.meta.url),pe=F.dirname(Ue),R=h();R.use(ke());R.use(h.json({limit:"10mb"}));R.use(h.urlencoded({extended:!0,limit:"10mb"}));R.use("/uploads",h.static(F.join(pe,"uploads")));R.use("/labels",h.static(F.join(pe,"labels")));R.use("/",k);R.use("/",G);R.use("/",ne);R.use("/",Ee);R.use("/",ge);R.get("/test",(a,t)=>{t.send("Backend is working!")});var We={key:M.readFileSync("/home/xsendwork/conf/web/xsendwork.com/ssl/xsendwork.com.key"),cert:M.readFileSync("/home/xsendwork/conf/web/xsendwork.com/ssl/xsendwork.com.crt"),ca:M.readFileSync("/home/xsendwork/conf/web/xsendwork.com/ssl/xsendwork.com.ca")},Re=process.env.PORT||8001;qe.createServer(We,R).listen(Re,()=>{console.log(`\u{1F680} Server running on https://localhost:${Re}`)});
